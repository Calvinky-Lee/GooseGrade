/**
 * "What do I need on the rest?" — specs/03 §4.
 *
 * Tone is a binding constraint here, not a preference: specs/00 says GooseGrade is a neutral
 * data tool. These messages state numbers and feasibility. No encouragement, no warnings, no
 * judgement.
 */

import type { Course, RequiredAcrossCourses, RequiredResult } from '@/lib/types';

import { computeCourse } from './computeCourse';
import { computeTermAverage } from './aggregate';

const EPSILON = 1e-9;

export function requiredForCourse(course: Course, target: number): RequiredResult {
  const result = computeCourse(course);
  const maxAchievable = result.ceiling;

  // Nothing outstanding: the grade is whatever it is.
  if (result.remainingWeight <= EPSILON) {
    const finalGrade = result.currentGrade;
    const reached = finalGrade != null && finalGrade + EPSILON >= target;
    return {
      feasible: reached,
      requiredAverage: null,
      maxAchievable,
      message: reached
        ? `Target of ${fmt(target)}% reached — no remaining work in this course.`
        : `No remaining work in this course. Final grade is ${fmt(finalGrade ?? 0)}%.`,
    };
  }

  // How many weight-points of the total course are already banked, and how many the target
  // needs. Both are expressed against the active (non-excused) weight so an excused item
  // does not distort the requirement.
  const active = result.completedWeight + result.remainingWeight;
  const earnedPoints = (result.floor / 100) * active;
  const neededPoints = (target / 100) * active;
  const shortfall = neededPoints - earnedPoints;

  const requiredAverage = Math.max(0, (shortfall / result.remainingWeight) * 100);
  const feasible = requiredAverage <= 100 + EPSILON;

  if (requiredAverage <= EPSILON) {
    return {
      feasible: true,
      requiredAverage: 0,
      maxAchievable,
      message: `Target of ${fmt(target)}% is already secured regardless of remaining work.`,
    };
  }

  return {
    feasible,
    requiredAverage,
    maxAchievable,
    message: feasible
      ? `Average ${fmt(requiredAverage)}% on the remaining ${fmt(
          result.remainingWeight,
        )}% to reach ${fmt(target)}%.`
      : `${fmt(target)}% is not reachable — the maximum achievable is ${fmt(maxAchievable)}%.`,
  };
}

/**
 * What each course needs for a target TERM average.
 *
 * Distributes the shortfall across courses that still have remaining weight, proportional to
 * their remaining credit-weighted capacity — a course with a 60% final left absorbs more of
 * the lift than one with a single 5% quiz left.
 */
export function requiredAcrossCourses(
  courses: Course[],
  targetTermAvg: number,
): RequiredAcrossCourses {
  // CR/NCR courses are not in the average, so they cannot contribute to reaching a target.
  const numeric = courses.filter((c) => c.gradeBasis === 'numeric');

  const rows = numeric.map((course) => {
    const result = computeCourse(course);
    return {
      course,
      result,
      // Credit-weighted headroom: how much this course can still move the term average.
      capacity: course.creditWeight * result.remainingWeight,
    };
  });

  const totalCredits = rows.reduce((sum, r) => sum + r.course.creditWeight, 0);

  if (totalCredits <= EPSILON) {
    return {
      feasible: false,
      perCourse: [],
      message: 'No numeric-basis courses in this term.',
    };
  }

  // Feasibility is decided by ceilings: if every course scoring 100 on everything left still
  // misses the target, no distribution can reach it.
  const bestPossible =
    rows.reduce((sum, r) => sum + r.course.creditWeight * r.result.ceiling, 0) / totalCredits;

  if (bestPossible + EPSILON < targetTermAvg) {
    return {
      feasible: false,
      perCourse: rows.map((r) => ({
        courseId: r.course.id,
        requiredAverage: null,
        feasible: false,
      })),
      message:
        `A term average of ${fmt(targetTermAvg)}% is not reachable — ` +
        `the maximum achievable is ${fmt(bestPossible)}%.`,
    };
  }

  const totalCapacity = rows.reduce((sum, r) => sum + r.capacity, 0);
  const currentFloorAvg =
    rows.reduce((sum, r) => sum + r.course.creditWeight * r.result.floor, 0) / totalCredits;

  // Credit-weighted points of term average still needed.
  const shortfallPoints = Math.max(0, (targetTermAvg - currentFloorAvg) * totalCredits);

  const perCourse = rows.map((r) => {
    if (r.result.remainingWeight <= EPSILON) {
      // Locked in — nothing this course can do either way.
      return { courseId: r.course.id, requiredAverage: null, feasible: true };
    }

    // This course's share of the lift, proportional to its capacity.
    const share = totalCapacity > EPSILON ? r.capacity / totalCapacity : 0;
    const pointsHere = shortfallPoints * share;

    // Convert credit-weighted points back into a percentage on this course's remaining work.
    const requiredAverage = Math.max(
      0,
      (pointsHere / (r.course.creditWeight * r.result.remainingWeight)) * 100,
    );

    return {
      courseId: r.course.id,
      requiredAverage,
      feasible: requiredAverage <= 100 + EPSILON,
    };
  });

  const allFeasible = perCourse.every((p) => p.feasible);

  return {
    feasible: allFeasible,
    perCourse,
    message: allFeasible
      ? `Reaching ${fmt(targetTermAvg)}% requires the per-course averages listed.`
      : `${fmt(targetTermAvg)}% requires over 100% in at least one course as distributed; ` +
        `a different distribution may still reach it.`,
  };
}

/** Term-average helper the dashboard uses alongside the above. */
export { computeTermAverage };

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}
