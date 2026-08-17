/**
 * Mock implementation of the data-access contract — specs/04 §0.
 *
 * Fully in-memory and mutable, so the whole app is genuinely usable before the backend exists:
 * entering a grade updates the dashboard, adding a course changes the term average, toggling a
 * rule changes the math. That is what lets the frontend session build every screen against the
 * frozen contract instead of waiting.
 *
 * State is per-module, so a page reload resets it. That is intentional for a mock.
 */

import { computeCourse } from '@/lib/engine';
import type { Assessment, Course, Term } from '@/lib/types';

import { ApiError, API_ERROR_CODES } from '../errors';
import { harvestCourseCodes, inferTerm, normalizeCode, termForDate } from '../parseSchedule';
import type {
  AssessmentPatch,
  CatalogCourseDetail,
  CatalogCourseSummary,
  CoursePatch,
  DistributionResult,
  GooseGradeApi,
  NewAssessmentInput,
  NewCourseInput,
  Profile,
  ScheduleMatch,
} from '../types';
import { CATALOG, CURRENT_TERM, PAST_TERM, PROFILE } from './data';

/** Simulated latency, so loading and skeleton states are actually visible in development. */
const LATENCY_MS = 120;
const wait = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));

// Deep clone so mutations do not write back into the fixture module.
const clone = <T>(value: T): T => structuredClone(value);

interface MockState {
  session: { userId: string; email: string } | null;
  profile: Profile;
  terms: Term[];
}

const state: MockState = {
  session: { userId: PROFILE.id, email: PROFILE.email },
  profile: clone(PROFILE),
  terms: [clone(CURRENT_TERM), clone(PAST_TERM)],
};

/** Reset between tests or Storybook stories. */
export function resetMockState(): void {
  state.session = { userId: PROFILE.id, email: PROFILE.email };
  state.profile = clone(PROFILE);
  state.terms = [clone(CURRENT_TERM), clone(PAST_TERM)];
}

function requireSession(): { userId: string; email: string } {
  if (!state.session) {
    throw new ApiError(API_ERROR_CODES.unauthorized, 'You are not signed in.');
  }
  return state.session;
}

function findCourse(courseId: string): { term: Term; course: Course } {
  for (const term of state.terms) {
    const course = term.courses.find((c) => c.id === courseId);
    if (course) return { term, course };
  }
  throw new ApiError(API_ERROR_CODES.notFound, `No course with id ${courseId}.`);
}

function findAssessment(assessmentId: string): { course: Course; assessment: Assessment } {
  for (const term of state.terms) {
    for (const course of term.courses) {
      const assessment = course.assessments.find((a) => a.id === assessmentId);
      if (assessment) return { course, assessment };
    }
  }
  throw new ApiError(API_ERROR_CODES.notFound, `No assessment with id ${assessmentId}.`);
}

let idCounter = 1000;
const nextId = (prefix: string) => `${prefix}-mock-${(idCounter += 1)}`;

function toSummary(row: (typeof CATALOG)[number]): CatalogCourseSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    term: row.term,
    section: row.section,
    creditWeight: row.creditWeight,
    schemeConfidence: row.schemeConfidence,
  };
}

/** Slugify a user-typed assessment name, de-duplicated within its course. */
function slugFor(course: Course, name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'item';

  if (!course.assessments.some((a) => a.slug === base)) return base;

  let n = 2;
  while (course.assessments.some((a) => a.slug === `${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export const mockApi: GooseGradeApi = {
  // ---- Auth & profile ------------------------------------------------------
  async signUp(email) {
    if (!email.endsWith('@uwaterloo.ca')) {
      throw new ApiError(
        API_ERROR_CODES.invalidEmail,
        'Sign up with your @uwaterloo.ca email address.',
      );
    }
    state.session = { userId: PROFILE.id, email };
    await wait(null);
  },

  async signIn(email) {
    if (!email.endsWith('@uwaterloo.ca')) {
      throw new ApiError(
        API_ERROR_CODES.invalidEmail,
        'Sign in with your @uwaterloo.ca email address.',
      );
    }
    state.session = { userId: PROFILE.id, email };
    await wait(null);
  },

  async signOut() {
    state.session = null;
    await wait(null);
  },

  async sendPasswordReset() {
    await wait(null);
  },

  async getSession() {
    return wait(state.session);
  },

  async getProfile() {
    requireSession();
    return wait(clone(state.profile));
  },

  async updateProfile(patch) {
    requireSession();
    state.profile = { ...state.profile, ...patch };
    return wait(clone(state.profile));
  },

  async deleteAccount() {
    state.session = null;
    state.terms = [];
    await wait(null);
  },

  async exportMyData() {
    requireSession();
    const payload = JSON.stringify({ profile: state.profile, terms: state.terms }, null, 2);
    return wait(new Blob([payload], { type: 'application/json' }));
  },

  // ---- Catalog ------------------------------------------------------------
  async searchCatalog(query, limit = 10) {
    const q = normalizeCode(query);
    const loose = query.trim().toUpperCase();
    if (loose.length < 2) return wait([]);

    const matches = CATALOG.filter(
      (row) => row.code.includes(q) || row.code.includes(loose) || row.name.toUpperCase().includes(loose),
    ).slice(0, limit);

    return wait(matches.map(toSummary));
  },

  async getCatalogCourse(code, term) {
    const wanted = normalizeCode(code);
    const rows = CATALOG.filter(
      (row) => row.code === wanted && (term == null || row.term === term),
    );

    // The mock has no per-section assessment data, so it reuses the forked course's shape
    // where one exists. Enough to drive the section picker and the confidence badge.
    const details: CatalogCourseDetail[] = rows.map((row) => {
      const forked = CURRENT_TERM.courses.find((c) => c.catalogCourseId === row.id);
      return {
        ...toSummary(row),
        gradeBasis: forked?.gradeBasis ?? 'numeric',
        gradingRules: forked?.gradingRules ?? [],
        assessments: forked ? clone(forked.assessments) : [],
        outlineUrl: `https://outline.uwaterloo.ca/view/${row.id}`,
      };
    });

    return wait(details);
  },

  async matchPastedSchedule(pastedText, term) {
    const candidates = harvestCourseCodes(pastedText);

    const inferred = inferTerm(pastedText);
    const resolvedTerm = term ?? inferred ?? termForDate(new Date());
    const termInferredFrom: ScheduleMatch['termInferredFrom'] = term
      ? 'caller'
      : inferred
        ? 'pasted_text'
        : 'current_date';

    const matched: ScheduleMatch['matched'] = [];
    const unmatched: string[] = [];

    for (const candidate of candidates) {
      const sections = CATALOG.filter(
        (row) => row.code === candidate.code && row.term === resolvedTerm,
      );

      if (sections.length === 0) {
        // Code-shaped but not in the catalog. Offered as a custom course rather than dropped,
        // because the student clearly is enrolled in it.
        unmatched.push(candidate.code);
        continue;
      }

      // A section hint from the paste puts the right section first, so the common case needs
      // no interaction at all.
      const ordered = candidate.sectionHint
        ? [...sections].sort((a, b) =>
            a.section === candidate.sectionHint ? -1 : b.section === candidate.sectionHint ? 1 : 0,
          )
        : sections;

      matched.push({ code: candidate.code, sections: ordered.map(toSummary) });
    }

    return wait({ term: resolvedTerm, termInferredFrom, matched, unmatched });
  },

  async getOutlineSource(catalogCourseId) {
    const row = CATALOG.find((c) => c.id === catalogCourseId);
    if (!row) return wait(null);
    return wait({
      url: `https://outline.uwaterloo.ca/view/${row.id}`,
      scrapedAt: '2026-05-04T12:00:00Z',
    });
  },

  // ---- Terms --------------------------------------------------------------
  async listTerms(opts) {
    requireSession();
    const ordered = [...state.terms].sort((a, b) => b.termDate.localeCompare(a.termDate));
    // populate: false returns shells, which is all a term picker needs. computeCumulative
    // needs the courses, so the record view asks for true.
    return wait(
      ordered.map((t) => (opts?.populate ? clone(t) : { ...clone(t), courses: [] })),
    );
  },

  async getCurrentTerm() {
    requireSession();
    const current = state.terms.find((t) => t.isCurrent) ?? null;
    return wait(current ? clone(current) : null);
  },

  async createTerm(label, termDate) {
    requireSession();
    for (const t of state.terms) t.isCurrent = false;

    const term: Term = {
      id: nextId('term'),
      termLabel: label,
      termDate,
      isCurrent: true,
      courses: [],
    };
    state.terms.push(term);
    return wait(clone(term));
  },

  async setCurrentTerm(termId) {
    requireSession();
    if (!state.terms.some((t) => t.id === termId)) {
      throw new ApiError(API_ERROR_CODES.notFound, `No term with id ${termId}.`);
    }
    for (const t of state.terms) t.isCurrent = t.id === termId;
    await wait(null);
  },

  async rolloverTerm(fromTermId, newLabel, newTermDate, cloneCourses) {
    requireSession();
    const from = state.terms.find((t) => t.id === fromTermId);
    for (const t of state.terms) t.isCurrent = false;

    const term: Term = {
      id: nextId('term'),
      termLabel: newLabel,
      termDate: newTermDate,
      isCurrent: true,
      // Shells only: carrying marks forward would corrupt the new term's average.
      courses:
        cloneCourses && from
          ? from.courses.map((c) => ({
              ...clone(c),
              id: nextId('course'),
              assessments: c.assessments.map((a) => ({
                ...clone(a),
                id: nextId('ua'),
                grade: null,
                status: 'upcoming' as const,
              })),
            }))
          : [],
    };

    state.terms.push(term);
    return wait(clone(term));
  },

  // ---- Courses ------------------------------------------------------------
  async addCourseFromCatalog(catalogCourseId, termId) {
    requireSession();
    const term = state.terms.find((t) => t.id === termId);
    if (!term) throw new ApiError(API_ERROR_CODES.notFound, `No term with id ${termId}.`);

    if (term.courses.some((c) => c.catalogCourseId === catalogCourseId)) {
      throw new ApiError(API_ERROR_CODES.alreadyAdded, 'That course is already in this term.');
    }

    const row = CATALOG.find((c) => c.id === catalogCourseId);
    if (!row) {
      throw new ApiError(API_ERROR_CODES.notFound, `No catalog course ${catalogCourseId}.`);
    }

    // Fork: a copy the student owns. The catalog is never mutated by a user action.
    const template = CURRENT_TERM.courses.find((c) => c.catalogCourseId === catalogCourseId);
    const course: Course = {
      id: nextId('course'),
      catalogCourseId,
      code: row.code,
      name: row.name,
      section: row.section,
      creditWeight: row.creditWeight,
      gradeBasis: template?.gradeBasis ?? 'numeric',
      gradingRules: template ? clone(template.gradingRules) : [],
      rulesOverridden: false,
      targetGrade: null,
      assessments: template
        ? template.assessments.map((a) => ({
            ...clone(a),
            id: nextId('ua'),
            grade: null,
            status: 'upcoming' as const,
          }))
        : [],
    };

    term.courses.push(course);
    return wait(clone(course));
  },

  async addCustomCourse(termId, input: NewCourseInput) {
    requireSession();
    const term = state.terms.find((t) => t.id === termId);
    if (!term) throw new ApiError(API_ERROR_CODES.notFound, `No term with id ${termId}.`);

    const course: Course = {
      id: nextId('course'),
      catalogCourseId: null,
      code: normalizeCode(input.code),
      name: input.name,
      section: input.section ?? null,
      creditWeight: input.creditWeight ?? 0.5,
      gradeBasis: input.gradeBasis ?? 'numeric',
      gradingRules: input.gradingRules ?? [],
      rulesOverridden: false,
      targetGrade: null,
      assessments: [],
    };

    term.courses.push(course);
    return wait(clone(course));
  },

  async getCourse(courseId) {
    requireSession();
    return wait(clone(findCourse(courseId).course));
  },

  async updateCourse(courseId, patch: CoursePatch) {
    requireSession();
    const { course } = findCourse(courseId);

    Object.assign(course, patch);
    // Editing rules is what sets the override flag, which is what "reset to official" keys on.
    if (patch.gradingRules) course.rulesOverridden = true;

    return wait(clone(course));
  },

  async resetCourseToCatalog(courseId) {
    requireSession();
    const { course } = findCourse(courseId);

    if (!course.catalogCourseId) {
      throw new ApiError(API_ERROR_CODES.invalidInput, 'This course has no catalog source.');
    }

    const template = CURRENT_TERM.courses.find(
      (c) => c.catalogCourseId === course.catalogCourseId,
    );
    if (template) {
      course.gradingRules = clone(template.gradingRules);
      course.rulesOverridden = false;

      // Marks are preserved by slug. Losing a student's grades to a "reset rules" action
      // would be unforgivable, so nothing here touches grade or status.
      const marks = new Map(course.assessments.map((a) => [a.slug, a]));
      course.assessments = template.assessments.map((t) => {
        const existing = marks.get(t.slug);
        return {
          ...clone(t),
          id: existing?.id ?? nextId('ua'),
          grade: existing?.grade ?? null,
          status: existing?.status ?? 'upcoming',
          isRemoved: false,
        };
      });
    }

    return wait(clone(course));
  },

  async removeCourse(courseId) {
    requireSession();
    const { term } = findCourse(courseId);
    term.courses = term.courses.filter((c) => c.id !== courseId);
    await wait(null);
  },

  // ---- Assessments --------------------------------------------------------
  async addAssessment(courseId, input: NewAssessmentInput) {
    requireSession();
    const { course } = findCourse(courseId);

    const assessment: Assessment = {
      id: nextId('ua'),
      slug: slugFor(course, input.name),
      name: input.name,
      category: input.category ?? null,
      assessmentType: input.assessmentType ?? input.category ?? 'Other',
      weight: input.weight,
      orderIndex: input.orderIndex ?? course.assessments.length + 1,
      grade: null,
      status: 'upcoming',
      isCustom: true,
      isRemoved: false,
    };

    course.assessments.push(assessment);
    return wait(clone(assessment));
  },

  async updateAssessment(assessmentId, patch: AssessmentPatch) {
    requireSession();
    const { assessment } = findAssessment(assessmentId);
    Object.assign(assessment, patch);
    return wait(clone(assessment));
  },

  async reorderAssessments(courseId, orderedIds) {
    requireSession();
    const { course } = findCourse(courseId);
    orderedIds.forEach((id, index) => {
      const a = course.assessments.find((x) => x.id === id);
      if (a) a.orderIndex = index + 1;
    });
    await wait(null);
  },

  async removeAssessment(assessmentId) {
    requireSession();
    // Soft-remove: keeps the slug and catalog reference so reset-to-official can restore it.
    const { assessment } = findAssessment(assessmentId);
    assessment.isRemoved = true;
    await wait(null);
  },

  async setGrade(assessmentId, grade) {
    requireSession();
    const { course, assessment } = findAssessment(assessmentId);

    if (grade != null && (grade < 0 || grade > 150)) {
      throw new ApiError(API_ERROR_CODES.invalidInput, 'Enter a mark between 0 and 150.');
    }

    assessment.grade = grade;
    // Clearing a mark returns the item to upcoming rather than leaving a graded-with-no-mark
    // row, which the engine would have to warn about.
    assessment.status = grade == null ? 'upcoming' : 'graded';

    return wait({
      assessment: clone(assessment),
      result: computeCourse(course),
    });
  },

  // ---- Distributions ------------------------------------------------------
  async contributeGrades(courseId) {
    requireSession();
    if (!state.profile.settings.contributeDistributions) {
      throw new ApiError(
        API_ERROR_CODES.notOptedIn,
        'Turn on contributing in Settings to see class distributions.',
      );
    }

    const { course } = findCourse(courseId);
    const skipped: Array<{
      slug: string;
      reason: 'custom' | 'slug_not_in_catalog' | 'not_graded';
    }> = [];
    let contributed = 0;

    for (const a of course.assessments) {
      if (a.isCustom) {
        skipped.push({ slug: a.slug, reason: 'custom' });
      } else if (a.status !== 'graded' || a.grade == null) {
        skipped.push({ slug: a.slug, reason: 'not_graded' });
      } else {
        contributed += 1;
      }
    }

    return wait({ contributed, skipped });
  },

  async getCourseDistribution(catalogCourseId, term) {
    // Below the minimum-sample floor by default, so developers build the empty state first —
    // which is what every user will actually see until adoption.
    return wait<DistributionResult>({
      available: false,
      count: 0,
      mean: 0,
      median: 0,
      buckets: [],
      myPercentile: null,
      term,
    });
  },

  async getAssessmentDistribution(catalogCourseId, slug, term) {
    // One populated example, so the histogram itself is developable.
    if (slug === 'midterm') {
      return wait<DistributionResult>({
        available: true,
        count: 34,
        mean: 71.2,
        median: 72.5,
        buckets: [
          { rangeLow: 40, rangeHigh: 50, count: 2 },
          { rangeLow: 50, rangeHigh: 60, count: 5 },
          { rangeLow: 60, rangeHigh: 70, count: 9 },
          { rangeLow: 70, rangeHigh: 80, count: 11 },
          { rangeLow: 80, rangeHigh: 90, count: 5 },
          { rangeLow: 90, rangeHigh: 100, count: 2 },
        ],
        myPercentile: 38.2,
        term,
      });
    }

    return wait<DistributionResult>({
      available: false,
      count: 0,
      mean: 0,
      median: 0,
      buckets: [],
      myPercentile: null,
      term,
    });
  },

  // ---- Feedback -----------------------------------------------------------
  async submitFeedback(input) {
    if (input.message.trim().length === 0) {
      throw new ApiError(API_ERROR_CODES.invalidInput, 'Add a message before submitting.');
    }
    await wait(null);
  },
};
