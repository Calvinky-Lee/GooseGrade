/**
 * Row <-> domain mapping.
 *
 * Postgres is snake_case, the domain is camelCase, and numerics arrive as strings from
 * PostgREST when they exceed JS-safe precision. Every conversion lives here so a missed
 * `Number()` cannot silently turn a weight into a string concatenation somewhere in the UI.
 */

import type {
  Assessment,
  AssessmentCategory,
  AssessmentStatus,
  Course,
  GradeBasis,
  GradingRule,
  SchemeConfidence,
  Term,
} from '@goosegrade/types';

import type { CatalogCourseSummary, Profile } from '../types';

/** PostgREST returns numeric(20,10) as a string to avoid precision loss. */
export const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
export const numOrNull = (v: unknown): number | null =>
  v == null || v === '' ? null : Number(v);

export interface AssessmentRow {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  assessment_type: string;
  weight: number | string;
  order_index: number;
  grade: number | string | null;
  status: string;
  is_custom: boolean;
  is_removed: boolean;
}

export function toAssessment(row: AssessmentRow): Assessment {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: (row.category ?? null) as AssessmentCategory | null,
    assessmentType: row.assessment_type,
    weight: num(row.weight),
    orderIndex: row.order_index,
    grade: numOrNull(row.grade),
    status: row.status as AssessmentStatus,
    isCustom: row.is_custom,
    isRemoved: row.is_removed,
  };
}

export interface CourseRow {
  id: string;
  catalog_course_id: string | null;
  code: string;
  name: string;
  section: string | null;
  credit_weight: number | string;
  grade_basis: string;
  grading_rules: GradingRule[] | null;
  rules_overridden: boolean;
  target_grade: number | string | null;
  user_assessments?: AssessmentRow[] | null;
}

export function toCourse(row: CourseRow, assessments?: AssessmentRow[]): Course {
  const rows = assessments ?? row.user_assessments ?? [];
  return {
    id: row.id,
    catalogCourseId: row.catalog_course_id,
    code: row.code,
    name: row.name,
    section: row.section,
    creditWeight: num(row.credit_weight),
    gradeBasis: row.grade_basis as GradeBasis,
    // JSONB comes back parsed, but a null column must become [] rather than crashing the engine.
    gradingRules: row.grading_rules ?? [],
    rulesOverridden: row.rules_overridden,
    targetGrade: numOrNull(row.target_grade),
    assessments: rows.map(toAssessment).sort((a, b) => a.orderIndex - b.orderIndex),
  };
}

export interface TermRow {
  id: string;
  term_label: string;
  term_date: string;
  is_current: boolean;
  user_courses?: CourseRow[] | null;
}

export function toTerm(row: TermRow): Term {
  return {
    id: row.id,
    termLabel: row.term_label,
    termDate: row.term_date,
    isCurrent: row.is_current,
    courses: (row.user_courses ?? []).map((c) => toCourse(c)),
  };
}

export interface CatalogCourseRow {
  id: string;
  code: string;
  name: string;
  term: string;
  section: string | null;
  credit_weight: number | string;
  scheme_confidence: string;
}

export function toCatalogSummary(row: CatalogCourseRow): CatalogCourseSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    term: row.term,
    section: row.section,
    creditWeight: num(row.credit_weight),
    schemeConfidence: row.scheme_confidence as SchemeConfidence,
  };
}

export interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  faculty: string | null;
  program: string | null;
  current_level: string | null;
  settings: Record<string, unknown> | null;
}

export function toProfile(row: ProfileRow): Profile {
  const settings = row.settings ?? {};
  return {
    id: row.id,
    email: row.email ?? '',
    displayName: row.display_name,
    faculty: row.faculty,
    program: row.program,
    currentLevel: row.current_level,
    settings: {
      // Defaults matter: a profile row created by the signup trigger has settings = {}, and
      // contributing must be OFF unless the user explicitly opted in (give-to-get).
      contributeDistributions: settings.contributeDistributions === true,
      theme: settings.theme === 'dark' ? 'dark' : 'light',
    },
  };
}

/** The columns needed to build a Course, including its assessments in one round trip. */
export const COURSE_SELECT = `
  id, catalog_course_id, code, name, section, credit_weight, grade_basis,
  grading_rules, rules_overridden, target_grade,
  user_assessments (
    id, slug, name, category, assessment_type, weight, order_index,
    grade, status, is_custom, is_removed
  )
`;

/**
 * getCurrentTerm returns the term with courses AND assessments fully populated, so the
 * dashboard computes locally with no N+1 (specs/01 §Performance).
 */
export const TERM_SELECT = `
  id, term_label, term_date, is_current,
  user_courses ( ${COURSE_SELECT} )
`;
