/**
 * Term and cumulative averages — specs/03 §4, amendment A1.
 *
 * Both are **credit-weighted** and both **exclude CR/NCR**, which is the non-negotiable
 * correctness rule from specs/README.md. Neither ever stores a result: the dashboard calls
 * these on every render, which is why nothing here can be stale.
 */

import type {
  Course,
  CumulativeAverage,
  ExclusionReason,
  Term,
  TermAverage,
} from '@/lib/types';

import { computeCourse } from './computeCourse';

/**
 * Credit-weighted mean of each course's currentGrade.
 *
 * A course is excluded when it is CR/NCR (never in a UW average) or when it has no graded
 * work yet (there is no number to average). The `exclusions` array carries the reason so the
 * UI can distinguish "PD 11 excluded" from "STAT 230 has no marks yet".
 */
export function computeTermAverage(courses: Course[]): TermAverage {
  const exclusions: Array<{ courseId: string; reason: ExclusionReason }> = [];

  let weightedCurrent = 0;
  let weightedProjected = 0;
  let includedCredits = 0;
  let projectedCredits = 0;

  for (const course of courses) {
    if (course.gradeBasis === 'cr_ncr') {
      exclusions.push({ courseId: course.id, reason: 'cr_ncr' });
      continue;
    }

    const result = computeCourse(course);

    if (result.currentGrade == null) {
      exclusions.push({ courseId: course.id, reason: 'no_graded_work' });
      continue;
    }

    weightedCurrent += course.creditWeight * result.currentGrade;
    includedCredits += course.creditWeight;

    if (result.projectedGrade != null) {
      weightedProjected += course.creditWeight * result.projectedGrade;
      projectedCredits += course.creditWeight;
    }
  }

  return {
    average: includedCredits > 0 ? weightedCurrent / includedCredits : null,
    projectedAverage: projectedCredits > 0 ? weightedProjected / projectedCredits : null,
    includedCredits,
    excludedCourseIds: exclusions.map((e) => e.courseId),
    exclusions,
  };
}

/**
 * Credit-weighted average across every term — the dashboard's "Cumulative" stat.
 *
 * Requires terms with `courses` populated; see lib/api `listTerms({ populate: true })`.
 * Note this recomputes historical terms from stored assessments rather than reading a frozen
 * figure — snapshot-lock was deliberately cut (design §4 G6), so an engine fix does change a
 * past term's average.
 */
export function computeCumulative(terms: Term[]): CumulativeAverage {
  // Oldest first, so "previous term" is unambiguous regardless of caller order.
  const ordered = [...terms].sort((a, b) => a.termDate.localeCompare(b.termDate));

  let weighted = 0;
  let includedCredits = 0;

  const perTerm = ordered.map((term) => {
    const termAvg = computeTermAverage(term.courses);

    if (termAvg.average != null) {
      weighted += termAvg.average * termAvg.includedCredits;
      includedCredits += termAvg.includedCredits;
    }

    return {
      termId: term.id,
      termLabel: term.termLabel,
      average: termAvg.average,
      credits: termAvg.includedCredits,
    };
  });

  // Delta compares the latest term that has an average against the most recent one before it.
  const withAverages = perTerm.filter((t) => t.average != null);
  const latest = withAverages.at(-1);
  const previous = withAverages.at(-2);

  return {
    average: includedCredits > 0 ? weighted / includedCredits : null,
    includedCredits,
    deltaVsPreviousTerm:
      latest && previous ? latest.average! - previous.average! : null,
    perTerm,
  };
}
