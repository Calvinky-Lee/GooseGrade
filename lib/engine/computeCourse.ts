/**
 * The grade engine core — specs/03 §2–3.
 *
 * Pure and synchronous by design: no React, no Supabase, no fetch. That is what lets the UI
 * recompute on every keystroke (the sub-5s grade-back loop is free rather than engineered),
 * and lets the QA runner execute it over all ~1,600 catalog courses in seconds.
 *
 * Deterministic rule order (specs/03 §2):
 *   excused removal → redistribute → bestNofM/dropLowest → maxOf → weighted sum
 *   → bonus → cap → passGate check
 */

import type { Assessment, Course, CourseResult } from '@/lib/types';

/** Weights are stored to 10 decimal places; shared weights like 35/11 never sum exactly. */
const WEIGHT_EPSILON = 1e-6;

/** An assessment plus the engine's working state for this evaluation. */
export interface WorkingItem {
  assessment: Assessment;
  /** Weight after redistribution and maxOf overrides. */
  weight: number;
  /** Set when a rule removed this item from consideration (dropped, excused, redistributed away). */
  droppedBy: string | null;
  /** True when this item contributes to the graded numerator/denominator. */
  isGraded: boolean;
  /** True when the weight is still outstanding (upcoming). */
  isRemaining: boolean;
}

/**
 * Build the initial working set. Applies only the two things that are not rules:
 * soft-removal and the excused/missed/graded status semantics.
 */
export function buildWorkingSet(course: Course): {
  items: WorkingItem[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const items: WorkingItem[] = [];

  for (const assessment of course.assessments) {
    if (assessment.isRemoved) continue;

    // `excused` removes the weight from every denominator — it is not a zero. This single
    // distinction is what prevents the engine from displaying a passing student as failing.
    if (assessment.status === 'excused') {
      items.push({
        assessment,
        weight: assessment.weight,
        droppedBy: 'excused',
        isGraded: false,
        isRemaining: false,
      });
      continue;
    }

    // Defensive: `graded` with no mark is inconsistent data. Scoring it 0 would invent a
    // failing mark out of a database inconsistency, so treat it as outstanding and say so.
    let isGraded = assessment.status === 'graded' || assessment.status === 'missed';
    if (assessment.status === 'graded' && assessment.grade == null) {
      warnings.push(
        `"${assessment.name}" is marked graded but has no mark — treating it as upcoming.`,
      );
      isGraded = false;
    }

    items.push({
      assessment,
      weight: assessment.weight,
      droppedBy: null,
      isGraded,
      isRemaining: !isGraded,
    });
  }

  return { items, warnings };
}

/** The mark an item contributes. `missed` is a real zero; anything else uses its grade. */
export function effectiveGrade(item: WorkingItem): number {
  if (item.assessment.status === 'missed') return 0;
  return item.assessment.grade ?? 0;
}

export interface Totals {
  earnedWeight: number;
  completedWeight: number;
  remainingWeight: number;
  /** Denominator for scaling: completed + remaining, excluding excused/dropped weight. */
  activeWeight: number;
}

export function sumTotals(items: WorkingItem[]): Totals {
  let earnedWeight = 0;
  let completedWeight = 0;
  let remainingWeight = 0;

  for (const item of items) {
    if (item.droppedBy !== null) continue;

    if (item.isGraded) {
      completedWeight += item.weight;
      earnedWeight += (item.weight * effectiveGrade(item)) / 100;
    } else if (item.isRemaining) {
      remainingWeight += item.weight;
    }
  }

  return {
    earnedWeight,
    completedWeight,
    remainingWeight,
    activeWeight: completedWeight + remainingWeight,
  };
}

/** Total declared weight of everything not soft-removed — used for the ≠100 warning. */
function declaredWeight(course: Course): number {
  return course.assessments
    .filter((a) => !a.isRemoved)
    .reduce((sum, a) => sum + a.weight, 0);
}

export function computeCourse(course: Course): CourseResult {
  const { items, warnings } = buildWorkingSet(course);

  const declared = declaredWeight(course);
  if (course.assessments.some((a) => !a.isRemoved) && Math.abs(declared - 100) > WEIGHT_EPSILON) {
    warnings.push(
      `Weights sum to ${round(declared, 4)}%, not 100% — ` +
        `${round(Math.abs(100 - declared), 4)}% is unaccounted for.`,
    );
  }

  const totals = sumTotals(items);

  const hasExcused = items.some((i) => i.droppedBy === 'excused');
  if (totals.activeWeight <= WEIGHT_EPSILON && hasExcused) {
    warnings.push('Every assessment is excused — there is no grade to compute.');
  }

  // Scale to the active weight so an excused item genuinely leaves the denominator rather
  // than silently capping the achievable maximum below 100.
  const scale = totals.activeWeight > WEIGHT_EPSILON ? 100 / totals.activeWeight : 0;

  const currentGrade =
    totals.completedWeight > WEIGHT_EPSILON
      ? (totals.earnedWeight / totals.completedWeight) * 100
      : null;

  const projectedGrade =
    currentGrade == null
      ? null
      : (totals.earnedWeight + (totals.remainingWeight * currentGrade) / 100) * scale;

  // floor/ceiling are never null: before anything is graded, 0–100 is still real information.
  const floor = totals.activeWeight > WEIGHT_EPSILON ? totals.earnedWeight * scale : 0;
  const ceiling =
    totals.activeWeight > WEIGHT_EPSILON
      ? (totals.earnedWeight + totals.remainingWeight) * scale
      : 100;

  return {
    currentGrade,
    projectedGrade,
    completedWeight: round(totals.completedWeight, 10),
    remainingWeight: round(totals.remainingWeight, 10),
    floor,
    ceiling,
    passGateStatus: 'n/a',
    appliedRules: [],
    warnings,
  };
}

export function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
