# 04 — API Contract (typed data-access layer)

**Status: contract.** The frontend codes **only** against the typed functions in this doc
(`lib/api/`). The backend implements them on top of Supabase (queries, RPCs, Edge Functions).
Neither session imports the Supabase client directly into UI code — this indirection is what
lets the frontend run on **mock fixtures** until the backend is live.

```
app/ components/  ──imports──▶  lib/api/*  ──implemented by backend──▶  Supabase
        (frontend owns)            (contract)                         (backend owns)
```

Every function is `async` and returns a typed result. Errors are thrown as `ApiError`
(`{ code, message }`); the UI surfaces a neutral message. All functions operate as the current
authed user (RLS enforces ownership) unless marked **public**.

---

## 0. Conventions

```ts
export class ApiError extends Error { constructor(public code: string, message: string) { super(message); } }
// Types (Course, Term, Assessment, CourseResult, ...) come from lib/types (see 03).
```

Mock mode: each function has a fixture in `lib/api/__mocks__/` so the frontend can build every
screen before the backend exists. Flip via `NEXT_PUBLIC_API_MODE=mock|live`.

---

## 1. Auth & profile

```ts
// Supabase Auth wrappers. UW-email gating enforced here + by an Auth hook.
signUp(email: string, password: string): Promise<void>;          // requires @uwaterloo.ca
signIn(email: string, password: string): Promise<void>;
signOut(): Promise<void>;
sendPasswordReset(email: string): Promise<void>;
getSession(): Promise<{ userId: string; email: string } | null>;

getProfile(): Promise<Profile>;
updateProfile(patch: Partial<Pick<Profile,
  'displayName'|'faculty'|'program'|'currentLevel'|'settings'>>): Promise<Profile>;

// Privacy requirement — wraps the delete_account() RPC; cascades all user data + shared_grades.
deleteAccount(): Promise<void>;
exportMyData(): Promise<Blob>;   // JSON export of all the caller's rows
```

```ts
export interface Profile {
  id: string; email: string; displayName: string | null;
  faculty: string | null; program: string | null; currentLevel: string | null;
  settings: { contributeDistributions: boolean; theme: 'light'|'dark' };
}
```

---

## 2. Catalog (public, read-only)

Backs search, smart-manual-add, and term/level auto-suggest.

```ts
// Course-code autocomplete (replaces today's direct supabase .or(ilike) call in the search box).
searchCatalog(query: string, limit?: number): Promise<CatalogCourseSummary[]>;

// All sections of a code in the latest (or given) term — for the section picker.
getCatalogCourse(code: string, term?: string): Promise<CatalogCourseDetail[]>;

// Term/level auto-suggest: typical course set for a program + level.
suggestCourses(program: string, level: string): Promise<CatalogCourseSummary[]>;

// The downloadable source outline (signed URL to Storage) + provenance.
getOutlineSource(catalogCourseId: string): Promise<{ url: string; scrapedAt: string } | null>;
```

```ts
export interface CatalogCourseSummary {
  id: string; code: string; name: string; term: string; section: string | null;
  creditWeight: number; schemeConfidence: SchemeConfidence;
}
export interface CatalogCourseDetail extends CatalogCourseSummary {
  gradeBasis: GradeBasis; gradingRules: GradingRule[]; assessments: Assessment[];
  outlineUrl: string | null;
}
```

---

## 3. Terms & dashboard

```ts
listTerms(): Promise<Term[]>;                                  // newest first
getCurrentTerm(): Promise<Term | null>;                       // the dashboard payload
createTerm(label: string, termDate: string): Promise<Term>;
setCurrentTerm(termId: string): Promise<void>;
rolloverTerm(fromTermId: string, newLabel: string,
             newTermDate: string, cloneCourses: boolean): Promise<Term>; // wraps rollover_term RPC
```

`getCurrentTerm()` returns the term **with its courses and their assessments fully populated**,
so the dashboard can call `computeTermAverage(term.courses)` (from `03`) with no extra round-trips.

---

## 4. Courses (forked, editable) — the grade-back loop

```ts
// Fork a catalog course into a term (wraps fork_catalog_course RPC). Returns the new user Course.
addCourseFromCatalog(catalogCourseId: string, termId: string): Promise<Course>;

// Create a fully custom course (catalogCourseId = null).
addCustomCourse(termId: string, input: NewCourseInput): Promise<Course>;

getCourse(courseId: string): Promise<Course>;
updateCourse(courseId: string, patch: Partial<Pick<Course,
  'name'|'code'|'section'|'creditWeight'|'gradeBasis'|'targetGrade'|'color'|'gradingRules'>>
): Promise<Course>;                                            // editing gradingRules sets rules_overridden
resetCourseToCatalog(courseId: string): Promise<Course>;       // wraps reset_course_to_catalog RPC
removeCourse(courseId: string): Promise<void>;

// Assessments
addAssessment(courseId: string, input: NewAssessmentInput): Promise<Assessment>;
updateAssessment(assessmentId: string, patch: Partial<Pick<Assessment,
  'name'|'category'|'assessmentType'|'weight'|'orderIndex'|'grade'|'status'|'isRemoved'>>
): Promise<Assessment>;
reorderAssessments(courseId: string, orderedIds: string[]): Promise<void>;
removeAssessment(assessmentId: string): Promise<void>;

// The grade-back loop's hot path: set a mark and flip status to 'graded' in one call.
// Designed to be the 5-second interaction; returns the recomputed CourseResult for instant UI.
setGrade(assessmentId: string, grade: number | null): Promise<{ assessment: Assessment; result: CourseResult }>;
```

```ts
export interface NewCourseInput {
  code: string; name: string; section?: string; creditWeight?: number;
  gradeBasis?: GradeBasis; gradingRules?: GradingRule[];
}
export interface NewAssessmentInput {
  name: string; category?: AssessmentCategory; assessmentType?: string;
  weight: number; orderIndex?: number;
}
```

> **Engine runs client-side.** `setGrade` returns the saved row; the UI recomputes via the pure
> `computeCourse` engine for zero-latency feedback. The server-returned `result` is for
> verification/SSR. There is no server "calculate" endpoint — the engine is shared code (`03`).

---

## 5. Distributions (privacy-gated)

```ts
// Opt-in contribution (give-to-get). Gated on profile.settings.contributeDistributions.
// Upserts into shared_grades for the caller. No-op + throws if user hasn't opted in.
contributeGrades(courseId: string): Promise<{ contributed: number }>; // pushes the course's graded marks

// Read aggregates ONLY. Returns { available:false } if below MIN_SAMPLE (default 5).
getCourseDistribution(catalogCourseId: string, term: string): Promise<DistributionResult>;
getAssessmentDistribution(catalogAssessmentId: string, term: string): Promise<DistributionResult>;
```

```ts
export interface DistributionResult {
  available: boolean;            // false when below the minimum-sample privacy floor
  count: number;                 // n contributors (only when available)
  mean: number; median: number;
  buckets: Array<{ rangeLow: number; rangeHigh: number; count: number }>;
  myPercentile: number | null;   // caller's standing, if they have a matching grade
  term: string;
}
```

Implemented via the `get_distribution()` SECURITY DEFINER RPC (`02 §E`), which enforces the
floor and trims outliers server-side. The frontend can render the histogram with `recharts`
(already a dependency).

---

## 6. Feedback

```ts
submitFeedback(input: {
  category: 'bug'|'suggestion'|'course_data'|'other';
  message: string; pageUrl?: string;
}): Promise<void>;               // insert-only; no read path for clients
```

---

## 7. Error codes (shared vocabulary)

| code | meaning | typical UI |
|---|---|---|
| `auth/invalid-email` | not a `@uwaterloo.ca` address | inline form error |
| `auth/unauthorized` | no session | redirect to sign-in |
| `course/already-added` | course already in that term | toast |
| `distribution/below-threshold` | not enough samples | "not enough data yet" empty state |
| `distribution/not-opted-in` | user must enable contribution | prompt opt-in |
| `validation/*` | bad input | inline |
| `server/unknown` | unexpected | generic neutral error |

---

## 8. What each screen needs (so frontend can start immediately on mocks)

| Screen | Calls |
|---|---|
| Landing / search | `searchCatalog` |
| Sign up / in | `signUp`, `signIn`, `sendPasswordReset` |
| Onboarding | `updateProfile`, `suggestCourses`, `createTerm` |
| **My Term dashboard** | `getCurrentTerm` → `computeTermAverage`, `requiredAcrossCourses` |
| Add course | `searchCatalog`/`suggestCourses` → `addCourseFromCatalog` / `addCustomCourse` |
| **Course detail** (grade-back loop) | `getCourse` → `computeCourse`, `setGrade`, assessment CRUD, `updateCourse`, `resetCourseToCatalog`, `getOutlineSource` |
| Calculator (anon-friendly) | shared engine only; optionally `addCustomCourse` if signed in |
| Distributions panel | `getCourseDistribution`, `getAssessmentDistribution`, `contributeGrades` |
| Past terms | `listTerms`, `rolloverTerm` |
| Settings / privacy | `getProfile`, `updateProfile`, `exportMyData`, `deleteAccount`, `submitFeedback` |
