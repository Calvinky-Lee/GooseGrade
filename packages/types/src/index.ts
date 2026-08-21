/**
 * Domain types — the contract from specs/03-domain-types.md §1–2 (as amended 2026-08-17).
 *
 * These mirror the Postgres schema in specs/02-data-model.md field-for-field, with camelCase
 * names. Nothing in this file imports React, Supabase, or anything else: it is shared by the
 * engine, the data-access layer, the UI, and the QA runner.
 */

export type GradeBasis = 'numeric' | 'cr_ncr';
export type AssessmentStatus = 'upcoming' | 'graded' | 'excused' | 'missed';
export type SchemeConfidence = 'unconfirmed' | 'review' | 'verified';

export type AssessmentCategory =
  | 'Assignment'
  | 'Quiz'
  | 'Lab'
  | 'Midterm'
  | 'Final Exam'
  | 'Participation'
  | 'Project'
  | 'Other';

export interface Assessment {
  id: string;
  /** Stable key, unique within a course. Survives re-scrapes and the catalog→user fork. */
  slug: string;
  name: string;
  category: AssessmentCategory | null;
  assessmentType: string;
  /** Base individual weight, as a percentage of the course. */
  weight: number;
  orderIndex: number;
  /** The student's mark as a percentage. `null` means not entered. */
  grade: number | null;
  status: AssessmentStatus;
  isCustom: boolean;
  isRemoved: boolean;
}

export interface Course {
  /** The `user_courses` id — never the catalog id. */
  id: string;
  catalogCourseId: string | null;
  code: string;
  name: string;
  section: string | null;
  /** UW credit value: 0.50, 1.00, 0.25, … Drives credit-weighted averages. */
  creditWeight: number;
  gradeBasis: GradeBasis;
  gradingRules: GradingRule[];
  rulesOverridden: boolean;
  targetGrade: number | null;
  assessments: Assessment[];
}

export interface Term {
  id: string;
  termLabel: string;
  /** ISO date — the first day of term, used for ordering. */
  termDate: string;
  isCurrent: boolean;
  courses: Course[];
}

// ---------------------------------------------------------------------------
// Grading rules (specs/03 §2)
// ---------------------------------------------------------------------------

interface RuleBase {
  id: string;
  /** User-toggleable. A disabled rule is ignored entirely by the engine. */
  enabled: boolean;
  /** Provenance, for the "reset to official" flow. */
  source: 'scraped' | 'user';
  /** Human text shown in the rules panel and in "show the math". */
  description: string;
}

/** Which assessments a rule applies to. At least one field must be set. */
export interface RuleGroup {
  category?: AssessmentCategory;
  slugs?: string[];
}

/** "Best 10 of 12 quizzes" — keep the highest `take` of the group. */
export interface BestNOfMRule extends RuleBase {
  type: 'bestNofM';
  group: RuleGroup;
  take: number;
}

/** "Drop your lowest 2 assignments" — the convenience form of bestNofM. */
export interface DropLowestRule extends RuleBase {
  type: 'dropLowest';
  group: RuleGroup;
  drop: number;
}

export interface WeightOverride {
  slug: string;
  weight: number;
}

/**
 * "Final counts 40%, or 60% if it improves your grade."
 * The engine evaluates every variant and picks whichever MAXIMIZES the course grade.
 */
export interface MaxOfRule extends RuleBase {
  type: 'maxOf';
  variants: WeightOverride[][];
}

/** "Must score >= min% on the final to pass, regardless of the weighted average." */
export interface PassGateRule extends RuleBase {
  type: 'passGate';
  target: { slug?: string; category?: AssessmentCategory };
  min: number;
  coursePassMark: number;
}

/** "A missed assessment's weight is added to <target>" — commonly the final exam. */
export interface RedistributeRule extends RuleBase {
  type: 'redistribute';
  from: { slug?: string; category?: AssessmentCategory };
  to: { slug?: string; category?: AssessmentCategory };
}

/** Bonus marks add on top of the computed grade. */
export interface BonusRule extends RuleBase {
  type: 'bonus';
  slug: string;
}

/** Hard cap on the final course grade — almost always 100. */
export interface CapRule extends RuleBase {
  type: 'cap';
  capAt: number;
}

export type GradingRule =
  | BestNOfMRule
  | DropLowestRule
  | MaxOfRule
  | PassGateRule
  | RedistributeRule
  | BonusRule
  | CapRule;

export type GradingRuleType = GradingRule['type'];

// ---------------------------------------------------------------------------
// Engine outputs (specs/03 §3, as amended)
// ---------------------------------------------------------------------------

export type PassGateStatus = 'ok' | 'at_risk' | 'failed' | 'n/a';

export interface AppliedRule {
  ruleId: string;
  type: GradingRuleType;
  /** e.g. "Best 10 of 11 applied — Quiz 4 dropped" */
  description: string;
  /** Human summary of what it changed. */
  effect: string;
}

export interface CourseResult {
  /**
   * Average over GRADED work only: earnedWeight / completedWeight × 100.
   * `null` when nothing is graded yet — amendment A2. Renders as "—", never 0.
   */
  currentGrade: number | null;
  /** Assumes remaining work scores `currentGrade`. `null` when there is no pace to project. */
  projectedGrade: number | null;
  /** Percent of the course already graded — the denominator of `currentGrade`. */
  completedWeight: number;
  /** Percent still outstanding. */
  remainingWeight: number;
  /** Final grade if every remaining item scores 0. Never null — 0-graded is real information. */
  floor: number;
  /** Final grade if every remaining item scores 100. Never null. */
  ceiling: number;
  /**
   * A separate flag. The pass gate NEVER mutates the numeric average — the UI shows both
   * side by side, so a passing grade can never be hidden behind a gate.
   */
  passGateStatus: PassGateStatus;
  appliedRules: AppliedRule[];
  /** Unresolved references, weights ≠ 100, etc. Surfaced as a quiet inline note. */
  warnings: string[];
}

export interface RequiredResult {
  feasible: boolean;
  /** Average needed across remaining weight to hit the target. */
  requiredAverage: number | null;
  /** The ceiling, for "not reachable" messaging. */
  maxAchievable: number;
  /** Neutral and factual — no coaching. */
  message: string;
}

export type ExclusionReason = 'cr_ncr' | 'no_graded_work';

export interface TermAverage {
  average: number | null;
  projectedAverage: number | null;
  includedCredits: number;
  excludedCourseIds: string[];
  /** Amendment A1 — the UI must be able to say *why* a course is excluded. */
  exclusions: Array<{ courseId: string; reason: ExclusionReason }>;
}

export interface CumulativeAverage {
  average: number | null;
  includedCredits: number;
  /** Versus the most recent prior term with a computable average; null for a first term. */
  deltaVsPreviousTerm: number | null;
  perTerm: Array<{
    termId: string;
    termLabel: string;
    average: number | null;
    credits: number;
  }>;
}

export interface RequiredAcrossCourses {
  feasible: boolean;
  /**
   * The single headline figure for the dashboard: the credit-weighted average needed across
   * ALL remaining work to hit the target term average. `null` when nothing is outstanding.
   *
   * Amendment A9 — the per-course breakdown alone cannot fill the mockup's "average 84.6% on
   * what's left" line, and a message that references a list the screen does not render is
   * worse than no message.
   */
  requiredAverageOnRemaining: number | null;
  perCourse: Array<{
    courseId: string;
    requiredAverage: number | null;
    feasible: boolean;
  }>;
  message: string;
}

// ---------------------------------------------------------------------------
// Display grouping (specs/03 §1, amendment A3)
// ---------------------------------------------------------------------------

/**
 * The unit the UI renders. `groupAssessments` collapses Quiz 1/2/3 into one "Quizzes" row.
 * Both the course page and the calculator render DisplayItem[], which is what lets them
 * share one implementation instead of the legacy duplication.
 */
export type DisplayItem =
  | { isGroup: false; id: string; assessment: Assessment }
  | {
      isGroup: true;
      /** Stable synthetic id, e.g. "group:Quiz". */
      id: string;
      name: string;
      category: AssessmentCategory | null;
      /** Sum of the non-removed children's weights. */
      weight: number;
      children: Assessment[];
    };
