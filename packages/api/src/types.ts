/**
 * The data-access contract — specs/04-api-contract.md.
 *
 * UI code imports ONLY from lib/api. It never touches the Supabase client directly: that
 * indirection is what lets the frontend run entirely on mock fixtures before the backend
 * exists, and what makes `NEXT_PUBLIC_API_MODE=mock|live` a one-line switch.
 */

import type {
  Assessment,
  AssessmentCategory,
  Course,
  CourseResult,
  GradeBasis,
  GradingRule,
  SchemeConfidence,
  Term,
} from '@goosegrade/types';

export interface Profile {
  id: string;
  email: string;
  displayName: string | null;
  faculty: string | null;
  program: string | null;
  currentLevel: string | null;
  settings: {
    contributeDistributions: boolean;
    theme: 'light' | 'dark';
  };
}

export interface CatalogCourseSummary {
  id: string;
  code: string;
  name: string;
  term: string;
  section: string | null;
  creditWeight: number;
  schemeConfidence: SchemeConfidence;
}

export interface CatalogCourseDetail extends CatalogCourseSummary {
  gradeBasis: GradeBasis;
  gradingRules: GradingRule[];
  assessments: Assessment[];
  outlineUrl: string | null;
}

/** Amendment A2b — the paste-first intake result. */
export interface ScheduleMatch {
  term: string;
  termInferredFrom: 'pasted_text' | 'current_date' | 'caller';
  matched: Array<{
    code: string;
    /** More than one section ⇒ the UI shows an inline picker. */
    sections: CatalogCourseSummary[];
  }>;
  /** Code-shaped but absent from the catalog — offer these as custom courses. */
  unmatched: string[];
}

export interface DistributionResult {
  available: boolean;
  count: number;
  mean: number;
  median: number;
  buckets: Array<{ rangeLow: number; rangeHigh: number; count: number }>;
  myPercentile: number | null;
  term: string;
}

export interface NewCourseInput {
  code: string;
  name: string;
  section?: string;
  creditWeight?: number;
  gradeBasis?: GradeBasis;
  gradingRules?: GradingRule[];
}

export interface NewAssessmentInput {
  name: string;
  category?: AssessmentCategory;
  assessmentType?: string;
  weight: number;
  orderIndex?: number;
}

export type CoursePatch = Partial<
  Pick<
    Course,
    'name' | 'code' | 'section' | 'creditWeight' | 'gradeBasis' | 'targetGrade' | 'gradingRules'
  >
>;

export type AssessmentPatch = Partial<
  Pick<
    Assessment,
    'name' | 'category' | 'assessmentType' | 'weight' | 'orderIndex' | 'grade' | 'status' | 'isRemoved'
  >
>;

/**
 * The full surface. Both the mock and the live implementation satisfy this interface, so a
 * screen cannot accidentally depend on something only the mock provides.
 */
export interface GooseGradeApi {
  // Auth & profile
  signUp(email: string, password: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  getSession(): Promise<{ userId: string; email: string } | null>;
  getProfile(): Promise<Profile>;
  updateProfile(
    patch: Partial<Pick<Profile, 'displayName' | 'faculty' | 'program' | 'currentLevel' | 'settings'>>,
  ): Promise<Profile>;
  deleteAccount(): Promise<void>;
  exportMyData(): Promise<Blob>;

  // Catalog (public, read-only)
  searchCatalog(query: string, limit?: number): Promise<CatalogCourseSummary[]>;
  getCatalogCourse(code: string, term?: string): Promise<CatalogCourseDetail[]>;
  matchPastedSchedule(pastedText: string, term?: string): Promise<ScheduleMatch>;
  getOutlineSource(
    catalogCourseId: string,
  ): Promise<{ url: string; scrapedAt: string } | null>;

  // Terms
  listTerms(opts?: { populate?: boolean }): Promise<Term[]>;
  getCurrentTerm(): Promise<Term | null>;
  createTerm(label: string, termDate: string): Promise<Term>;
  setCurrentTerm(termId: string): Promise<void>;
  rolloverTerm(
    fromTermId: string,
    newLabel: string,
    newTermDate: string,
    cloneCourses: boolean,
  ): Promise<Term>;

  // Courses
  addCourseFromCatalog(catalogCourseId: string, termId: string): Promise<Course>;
  addCustomCourse(termId: string, input: NewCourseInput): Promise<Course>;
  getCourse(courseId: string): Promise<Course>;
  updateCourse(courseId: string, patch: CoursePatch): Promise<Course>;
  resetCourseToCatalog(courseId: string): Promise<Course>;
  removeCourse(courseId: string): Promise<void>;

  // Assessments
  addAssessment(courseId: string, input: NewAssessmentInput): Promise<Assessment>;
  updateAssessment(assessmentId: string, patch: AssessmentPatch): Promise<Assessment>;
  reorderAssessments(courseId: string, orderedIds: string[]): Promise<void>;
  removeAssessment(assessmentId: string): Promise<void>;
  /** The grade-back loop's hot path. Returns the recomputed result for SSR/verification. */
  setGrade(
    assessmentId: string,
    grade: number | null,
  ): Promise<{ assessment: Assessment; result: CourseResult }>;

  // Distributions
  contributeGrades(courseId: string): Promise<{
    contributed: number;
    skipped: Array<{ slug: string; reason: 'custom' | 'slug_not_in_catalog' | 'not_graded' }>;
  }>;
  getCourseDistribution(catalogCourseId: string, term: string): Promise<DistributionResult>;
  getAssessmentDistribution(
    catalogCourseId: string,
    slug: string,
    term: string,
  ): Promise<DistributionResult>;

  // Feedback
  submitFeedback(input: {
    category: 'bug' | 'suggestion' | 'course_data' | 'other';
    message: string;
    pageUrl?: string;
  }): Promise<void>;
}
