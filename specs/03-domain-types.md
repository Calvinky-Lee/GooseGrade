# 03 — Domain Types & Grade-Engine Semantics

**Status: contract.** These TypeScript types mirror `02-data-model.md` exactly and define the
**pure grade engine**. They live in `lib/types/` (types) and `lib/engine/` (engine). The engine
has **zero dependencies** (no React, no Supabase, no fetch) so it is trivially unit-testable and
shared by every screen and by the multi-agent QA runner.

> Assign the engine to **one** session (recommend backend) to avoid double-implementation.

---

## 1. Core types (mirror the DB)

```ts
export type GradeBasis = 'numeric' | 'cr_ncr';
export type AssessmentStatus = 'upcoming' | 'graded' | 'excused' | 'missed';
export type SchemeConfidence = 'unconfirmed' | 'review' | 'verified';

export type AssessmentCategory =
  | 'Assignment' | 'Quiz' | 'Lab' | 'Midterm'
  | 'Final Exam' | 'Participation' | 'Project' | 'Other';

export interface Assessment {
  id: string;
  slug: string;                 // stable key, unique within course
  name: string;
  category: AssessmentCategory | null;
  assessmentType: string;
  weight: number;               // base individual weight, % of course
  orderIndex: number;
  grade: number | null;         // student mark %, null = not entered
  status: AssessmentStatus;
  isCustom: boolean;
  isRemoved: boolean;
}

export interface Course {
  id: string;                   // user_course id
  catalogCourseId: string | null;
  code: string;
  name: string;
  section: string | null;
  creditWeight: number;         // 0.50, 1.00, ...
  gradeBasis: GradeBasis;
  gradingRules: GradingRule[];
  rulesOverridden: boolean;
  targetGrade: number | null;
  assessments: Assessment[];
}

export interface Term {
  id: string;
  termLabel: string;
  termDate: string;             // ISO date
  isCurrent: boolean;
  courses: Course[];
}
```

---

## 2. The grading-rule taxonomy (the heart of the product)

A course's scheme is an **ordered array of declarative rules**. The engine applies them in a
defined order (below). Every rule references assessments by `slug` or `category`. The scraper
emits these; users may toggle/edit them (layered override); the QA runner validates them.

```ts
export type GradingRule =
  | BestNOfMRule
  | DropLowestRule
  | MaxOfRule
  | PassGateRule
  | RedistributeRule
  | BonusRule
  | CapRule;

interface RuleBase {
  id: string;
  enabled: boolean;             // user-toggleable; disabled => engine ignores it
  source: 'scraped' | 'user';  // provenance, for the "reset to official" flow
  description: string;          // human text shown in "show the math" + the toggle UI
}

// "Best 10 of 12 quizzes" — keep the highest `take` by contribution among the group.
export interface BestNOfMRule extends RuleBase {
  type: 'bestNofM';
  group: { category?: AssessmentCategory; slugs?: string[] }; // which items form the pool
  take: number;                 // how many count
}

// "Drop your lowest 2 assignments" — convenience form of bestNofM.
export interface DropLowestRule extends RuleBase {
  type: 'dropLowest';
  group: { category?: AssessmentCategory; slugs?: string[] };
  drop: number;
}

// "Final counts 40%, or 60% if it improves your grade" / "midterm replaced by final if higher".
// Engine evaluates each variant and picks the one that MAXIMIZES the course grade.
export interface MaxOfRule extends RuleBase {
  type: 'maxOf';
  variants: WeightOverride[][];  // each variant = a set of weight overrides to try
}
export interface WeightOverride { slug: string; weight: number }

// "Must score >= min% on this to pass the course, regardless of weighted average."
export interface PassGateRule extends RuleBase {
  type: 'passGate';
  target: { slug?: string; category?: AssessmentCategory };
  min: number;                  // threshold % on that component
  coursePassMark: number;       // default 50
}

// "A missed assessment's weight is added to <target>."
export interface RedistributeRule extends RuleBase {
  type: 'redistribute';
  from: { slug?: string; category?: AssessmentCategory };
  to: { slug?: string; category?: AssessmentCategory }; // commonly the final exam
}

// Bonus marks add on top of the computed grade.
export interface BonusRule extends RuleBase {
  type: 'bonus';
  slug: string;                 // the bonus item
}

// Hard cap on the final course grade (almost always 100).
export interface CapRule extends RuleBase {
  type: 'cap';
  capAt: number;                // default 100
}
```

**Application order (deterministic):**
`excused` removal → `redistribute` (missed work) → `bestNofM`/`dropLowest` → `maxOf` (replacement) →
weighted sum → `bonus` → `cap` → `passGate` check.

**Safety contract (binding):**
- An `enabled: false` rule is ignored entirely.
- If a rule references slugs/categories that don't resolve, the engine **skips that rule and
  records a warning** — it never throws and never silently produces a wrong number.
- `passGate` **never mutates the numeric average**; it only sets a separate `passGateStatus`
  flag. The UI shows the average AND the gate status side by side, so a pass is never hidden.
- When confidence is low or rules conflict, the correct fallback is **plain weighted sum** with
  the special rules left advisory. (Enforced by `07` scraper + QA, surfaced here as warnings.)

---

## 3. Engine outputs

```ts
export interface CourseResult {
  currentGrade: number;          // earned / completedWeight  (avg on GRADED work only)
  projectedGrade: number;        // earned + assumedRemaining; see assumption below
  completedWeight: number;       // % of course already graded (denominator of currentGrade)
  remainingWeight: number;       // % still outstanding
  floor: number;                 // final grade if you score 0 on everything remaining
  ceiling: number;               // final grade if you score 100 on everything remaining
  passGateStatus: 'ok' | 'at_risk' | 'failed' | 'n/a';
  appliedRules: AppliedRule[];   // what fired, for "show the math"
  warnings: string[];            // unresolved refs, weights != 100, etc.
}

export interface AppliedRule {
  ruleId: string;
  type: GradingRule['type'];
  description: string;           // e.g. "Best 10 of 11 applied — Quiz 4 dropped"
  effect: string;                // human summary of what it changed
}

export interface RequiredResult {
  feasible: boolean;
  requiredAverage: number | null; // avg needed on remaining weight to hit target
  maxAchievable: number;          // ceiling, for "impossible" messaging
  message: string;                // neutral, factual (no coaching)
}
```

**Definitions (must be implemented exactly):**
- `currentGrade` = `earnedWeight / completedWeight × 100`, where only `status === 'graded'`
  items (and the resolved group/rule outcomes) contribute. If `completedWeight === 0` → `0`.
- `projectedGrade` = assumes remaining work scores the student's **current average**
  (`currentGrade`). It is labeled as an assumption in the UI. (Neutral tool: no optimistic bias.)
- `floor`/`ceiling` use 0% / 100% on all `upcoming` weight respectively — the **achievable
  range**. `excused` weight is excluded from all denominators; `missed` counts as 0 unless a
  `redistribute` rule moves its weight.
- A `cr_ncr` course returns grades for display but is **flagged so term-average code excludes it.**

---

## 4. Engine API (pure functions)

```ts
// Single course.
export function computeCourse(course: Course): CourseResult;

// "What do I need on the rest of this course to hit `target`?"
export function requiredForCourse(course: Course, target: number): RequiredResult;

// Credit-weighted term average over numeric-basis courses only (CR/NCR excluded).
export function computeTermAverage(courses: Course[]): {
  average: number;               // credit-weighted mean of each course's currentGrade
  projectedAverage: number;      // using each course's projectedGrade
  includedCredits: number;       // sum of creditWeight of included courses
  excludedCourseIds: string[];   // CR/NCR or no-grade courses left out
};

// "What term average do I need / what does each course need to reach `targetTermAvg`?"
export function requiredAcrossCourses(
  courses: Course[],
  targetTermAvg: number,
): {
  feasible: boolean;
  perCourse: Array<{ courseId: string; requiredAverage: number | null; feasible: boolean }>;
  message: string;
};

// Grouping helper used by the UI (Quiz 1/2/3 -> "Quizzes"). Extracted from the legacy pages
// so both the course view and calculator share ONE implementation (kills the 1,800-line dupe).
export function groupAssessments(assessments: Assessment[]): DisplayItem[];
```

`requiredAcrossCourses` distributes the needed lift across courses with remaining weight,
proportional to remaining credit-weighted capacity; flags `feasible: false` when even ceilings
can't reach the target.

---

## 5. Testing contract (feeds the multi-agent QA in `07`)

- The engine ships with a fixture format: `{ course: Course, expected: CourseResult }`.
- Each `GradingRule` type has hand-written unit cases covering: rule on/off, unresolved refs,
  all-upcoming, all-graded, mixed, excused vs missed, and the **"passing grade must not display
  as fail"** invariant.
- The QA runner (post-build) generates fixtures **per real catalog course** and asserts:
  (a) engine never throws, (b) `0 ≤ currentGrade ≤ ceiling ≤ 100+bonus`, (c) disabling all
  special rules reproduces the plain weighted sum, (d) no course's rules reference another
  course's slugs. Any violation flags the course to `scheme_confidence='review'`.
