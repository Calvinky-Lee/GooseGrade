/**
 * The safety contract, as executable assertions — specs/03 §5, specs/07 §7.
 *
 * WRITE ONCE, USED TWICE. This module is consumed by:
 *   1. Vitest, over hand-written fixtures (lib/engine/invariants.test.ts)
 *   2. the deterministic QA tier, over every real catalog course, in GitHub Actions
 *
 * Design decision D4: two implementations of the safety contract is how the safety contract
 * drifts, so there is exactly one. It returns violations rather than throwing, because the QA
 * runner needs to record all of them per course (into `qa_findings`) rather than stop at the
 * first.
 */

import type { Course, CourseResult } from '@/lib/types';

import { computeCourse } from './computeCourse';

/** Stable keys — these are written to `qa_findings.invariant` and must not be renamed lightly. */
export type InvariantKey =
  | 'engine_throws'
  | 'current_grade_out_of_range'
  | 'floor_exceeds_ceiling'
  | 'current_grade_exceeds_ceiling'
  | 'current_grade_below_floor'
  | 'rules_off_diverges_from_weighted_sum'
  | 'cross_course_slug_reference'
  | 'passing_average_reported_as_fail';

export interface Violation {
  invariant: InvariantKey;
  severity: 'warn' | 'violation';
  message: string;
  detail?: Record<string, unknown>;
}

/** Tolerance for accumulated floating-point error across a long weighted sum. */
const TOLERANCE = 1e-6;

/**
 * Run every invariant against one course.
 *
 * `severity: 'violation'` is what flags a catalog course to `scheme_confidence='review'`.
 * `'warn'` is recorded but does not gate.
 */
export function checkInvariants(course: Course): Violation[] {
  const violations: Violation[] = [];

  let result: CourseResult;
  try {
    result = computeCourse(course);
  } catch (error) {
    // The engine must be total. A throw is the most severe failure there is: it means a real
    // student's page would have crashed.
    return [
      {
        invariant: 'engine_throws',
        severity: 'violation',
        message: `computeCourse threw: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }

  violations.push(...checkRanges(course, result));
  violations.push(...checkRulesOffMatchesWeightedSum(course, result));
  violations.push(...checkSlugsResolveWithinCourse(course));
  violations.push(...checkPassingNotReportedAsFail(course, result));

  return violations;
}

function checkRanges(course: Course, result: CourseResult): Violation[] {
  const out: Violation[] = [];
  const maxGrade = 100 + bonusHeadroom(course);

  if (result.currentGrade != null) {
    if (result.currentGrade < -TOLERANCE || result.currentGrade > maxGrade + TOLERANCE) {
      out.push({
        invariant: 'current_grade_out_of_range',
        severity: 'violation',
        message: `currentGrade ${result.currentGrade} is outside 0–${maxGrade}`,
        detail: { currentGrade: result.currentGrade, maxGrade },
      });
    }

    if (result.currentGrade > result.ceiling + TOLERANCE) {
      out.push({
        invariant: 'current_grade_exceeds_ceiling',
        severity: 'violation',
        message: `currentGrade ${result.currentGrade} exceeds ceiling ${result.ceiling}`,
        detail: { currentGrade: result.currentGrade, ceiling: result.ceiling },
      });
    }

    // Only meaningful once everything is graded — mid-term, the current average is an average
    // over completed work and can legitimately sit above the floor of the whole course.
    if (result.remainingWeight <= TOLERANCE && result.currentGrade < result.floor - TOLERANCE) {
      out.push({
        invariant: 'current_grade_below_floor',
        severity: 'violation',
        message: `currentGrade ${result.currentGrade} is below floor ${result.floor}`,
        detail: { currentGrade: result.currentGrade, floor: result.floor },
      });
    }
  }

  if (result.floor > result.ceiling + TOLERANCE) {
    out.push({
      invariant: 'floor_exceeds_ceiling',
      severity: 'violation',
      message: `floor ${result.floor} exceeds ceiling ${result.ceiling}`,
      detail: { floor: result.floor, ceiling: result.ceiling },
    });
  }

  return out;
}

/** Bonus rules can legitimately push a grade over 100 before a cap applies. */
function bonusHeadroom(course: Course): number {
  return course.gradingRules
    .filter((r) => r.enabled && r.type === 'bonus')
    .reduce((sum, r) => {
      const item = course.assessments.find(
        (a) => a.slug === (r as { slug: string }).slug,
      );
      return sum + (item?.weight ?? 0);
    }, 0);
}

/**
 * The binding fallback: with every special rule disabled, the engine must reproduce the plain
 * weighted sum exactly. If it does not, a rule is leaking into the base calculation — the
 * failure mode that would silently change grades for every course carrying that rule.
 */
export function checkRulesOffMatchesWeightedSum(
  course: Course,
  _result: CourseResult,
): Violation[] {
  const rulesOff: Course = {
    ...course,
    gradingRules: course.gradingRules.map((r) => ({ ...r, enabled: false })),
  };

  const actual = computeCourse(rulesOff).currentGrade;
  const expected = plainWeightedSum(course);

  if (actual == null && expected == null) return [];

  if (actual == null || expected == null || Math.abs(actual - expected) > TOLERANCE) {
    return [
      {
        invariant: 'rules_off_diverges_from_weighted_sum',
        severity: 'violation',
        message:
          `With all rules disabled the engine returned ${actual}, ` +
          `but the plain weighted sum is ${expected}`,
        detail: { actual, expected },
      },
    ];
  }

  return [];
}

/** Independent reference implementation — deliberately does not share code with the engine. */
export function plainWeightedSum(course: Course): number | null {
  let earned = 0;
  let completed = 0;

  for (const a of course.assessments) {
    if (a.isRemoved) continue;
    if (a.status === 'excused') continue;
    if (a.status === 'missed') {
      completed += a.weight;
      continue; // scores zero
    }
    if (a.status === 'graded' && a.grade != null) {
      completed += a.weight;
      earned += (a.weight * a.grade) / 100;
    }
  }

  return completed > 0 ? (earned / completed) * 100 : null;
}

/**
 * No rule may reference a slug this course does not have. A cross-course reference is the
 * legacy multi-tenant bug in a new costume: one course's rules silently altering another's.
 */
export function checkSlugsResolveWithinCourse(course: Course): Violation[] {
  const own = new Set(course.assessments.map((a) => a.slug));
  const out: Violation[] = [];

  const flag = (slug: string, ruleId: string) => {
    if (own.has(slug)) return;
    out.push({
      invariant: 'cross_course_slug_reference',
      severity: 'warn',
      message: `Rule ${ruleId} references "${slug}", which is not an assessment in ${course.code}`,
      detail: { ruleId, slug, courseCode: course.code },
    });
  };

  for (const r of course.gradingRules) {
    switch (r.type) {
      case 'bestNofM':
      case 'dropLowest':
        r.group.slugs?.forEach((s) => flag(s, r.id));
        break;
      case 'maxOf':
        r.variants.flat().forEach((o) => flag(o.slug, r.id));
        break;
      case 'redistribute':
        if (r.from.slug) flag(r.from.slug, r.id);
        if (r.to.slug) flag(r.to.slug, r.id);
        break;
      case 'passGate':
        if (r.target.slug) flag(r.target.slug, r.id);
        break;
      case 'bonus':
        flag(r.slug, r.id);
        break;
      case 'cap':
        break;
    }
  }

  return out;
}

/**
 * The headline rule from specs/README.md: a conditional grading rule must never turn a
 * genuinely passing grade into a displayed fail.
 *
 * `passGateStatus: 'failed'` is only legitimate when an explicit, RESOLVED passGate rule says
 * so — and even then the numeric average must still be present so the UI can show both.
 */
export function checkPassingNotReportedAsFail(
  course: Course,
  result: CourseResult,
): Violation[] {
  if (result.passGateStatus !== 'failed') return [];

  const gates = course.gradingRules.filter((r) => r.enabled && r.type === 'passGate');

  if (gates.length === 0) {
    return [
      {
        invariant: 'passing_average_reported_as_fail',
        severity: 'violation',
        message: 'passGateStatus is "failed" but the course has no enabled passGate rule',
      },
    ];
  }

  if (result.currentGrade == null) {
    return [
      {
        invariant: 'passing_average_reported_as_fail',
        severity: 'violation',
        message:
          'passGateStatus is "failed" but currentGrade is null — the UI cannot show the ' +
          'average alongside the gate, so a passing grade would be hidden',
      },
    ];
  }

  return [];
}

/** Convenience for the QA runner: true when nothing should gate this course. */
export function isClean(violations: Violation[]): boolean {
  return !violations.some((v) => v.severity === 'violation');
}
