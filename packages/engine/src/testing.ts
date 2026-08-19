/**
 * Fixture builders for engine tests and for the QA runner's generated fixtures.
 *
 * Lives in the engine (not in a __tests__ folder) because specs/07 §7 has the containerized
 * QA runner synthesize fixtures for every real catalog course using these same builders.
 */

import type {
  Assessment,
  AssessmentCategory,
  AssessmentStatus,
  Course,
  GradeBasis,
  GradingRule,
  Term,
} from '@goosegrade/types';

let seq = 0;

/** Reset ids so a test's expected ids are stable. Call in `beforeEach` if you assert on ids. */
export function resetIds(): void {
  seq = 0;
}

export function makeAssessment(partial: Partial<Assessment> & { weight: number }): Assessment {
  seq += 1;
  const slug = partial.slug ?? `item-${seq}`;
  return {
    id: partial.id ?? `a${seq}`,
    slug,
    name: partial.name ?? slug,
    category: partial.category ?? null,
    assessmentType: partial.assessmentType ?? partial.category ?? 'Other',
    weight: partial.weight,
    orderIndex: partial.orderIndex ?? seq,
    grade: partial.grade ?? null,
    status: partial.status ?? (partial.grade == null ? 'upcoming' : 'graded'),
    isCustom: partial.isCustom ?? false,
    isRemoved: partial.isRemoved ?? false,
  };
}

/**
 * Shorthand: `graded('final-exam', 40, 85)` — a 40%-weight item scored 85.
 * `upcoming('final-exam', 40)` — the same item, not yet marked.
 */
export function graded(
  slug: string,
  weight: number,
  grade: number,
  category?: AssessmentCategory,
): Assessment {
  return makeAssessment({ slug, weight, grade, status: 'graded', category });
}

export function upcoming(slug: string, weight: number, category?: AssessmentCategory): Assessment {
  return makeAssessment({ slug, weight, status: 'upcoming', category });
}

export function withStatus(
  slug: string,
  weight: number,
  status: AssessmentStatus,
  grade: number | null = null,
  category?: AssessmentCategory,
): Assessment {
  return makeAssessment({ slug, weight, status, grade, category });
}

export function makeCourse(partial: Partial<Course> & { assessments: Assessment[] }): Course {
  seq += 1;
  return {
    id: partial.id ?? `c${seq}`,
    catalogCourseId: partial.catalogCourseId ?? null,
    code: partial.code ?? 'CS 240',
    name: partial.name ?? 'Data Structures & Data Management',
    section: partial.section ?? null,
    creditWeight: partial.creditWeight ?? 0.5,
    gradeBasis: partial.gradeBasis ?? 'numeric',
    gradingRules: partial.gradingRules ?? [],
    rulesOverridden: partial.rulesOverridden ?? false,
    targetGrade: partial.targetGrade ?? null,
    assessments: partial.assessments,
  };
}

export function makeTerm(partial: Partial<Term> & { courses: Course[] }): Term {
  seq += 1;
  return {
    id: partial.id ?? `t${seq}`,
    termLabel: partial.termLabel ?? 'Spring 2026',
    termDate: partial.termDate ?? '2026-05-01',
    isCurrent: partial.isCurrent ?? true,
    courses: partial.courses,
  };
}

/** Rule builders — `enabled` and `source` default to the common case so tests stay readable. */
export function rule<T extends GradingRule>(
  r: Omit<T, 'id' | 'enabled' | 'source' | 'description'> &
    Partial<Pick<T, 'id' | 'enabled' | 'source' | 'description'>>,
): T {
  seq += 1;
  return {
    id: `r${seq}`,
    enabled: true,
    source: 'scraped',
    description: '',
    ...r,
  } as T;
}

export const CR_NCR: GradeBasis = 'cr_ncr';
