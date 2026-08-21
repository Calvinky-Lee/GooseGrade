/**
 * Rule application — specs/03 §2.
 *
 * Every function here is total: a rule that cannot be resolved is SKIPPED with a warning,
 * never thrown and never guessed at. The binding fallback is the plain weighted sum, because
 * a missed special rule is safe while a wrongly-applied one is not.
 */

import type {
  AppliedRule,
  BestNOfMRule,
  BonusRule,
  CapRule,
  Course,
  DropLowestRule,
  GradingRule,
  MaxOfRule,
  PassGateRule,
  PassGateStatus,
  RedistributeRule,
  RuleGroup,
} from '@goosegrade/types';

import { effectiveGrade, type WorkingItem } from './computeCourse';

export interface RuleContext {
  items: WorkingItem[];
  applied: AppliedRule[];
  warnings: string[];
}

const label = (r: GradingRule) => r.description || r.type;

/** Resolve a group to the working items it names. Empty result ⇒ caller must skip the rule. */
function resolveGroup(items: WorkingItem[], group: RuleGroup): WorkingItem[] {
  const bySlug = group.slugs
    ? items.filter((i) => group.slugs!.includes(i.assessment.slug))
    : [];
  const byCategory = group.category
    ? items.filter((i) => i.assessment.category === group.category)
    : [];

  // Union, de-duplicated, preserving item order.
  const chosen = new Set([...bySlug, ...byCategory]);
  return items.filter((i) => chosen.has(i));
}

function resolveTarget(
  items: WorkingItem[],
  target: { slug?: string; category?: AssessmentCategoryLike },
): WorkingItem[] {
  return resolveGroup(items, { slugs: target.slug ? [target.slug] : undefined, category: target.category });
}

type AssessmentCategoryLike = RuleGroup['category'];

// ---------------------------------------------------------------------------
// redistribute — runs first, because it changes the weights everything else sees
// ---------------------------------------------------------------------------

export function applyRedistribute(ctx: RuleContext, r: RedistributeRule): void {
  const from = resolveTarget(ctx.items, r.from);
  const to = resolveTarget(ctx.items, r.to);

  if (from.length === 0 || to.length === 0) {
    ctx.warnings.push(
      `Rule "${label(r)}" references assessments that don't exist in this course — skipped.`,
    );
    return;
  }

  // Only MISSED work redistributes. Upcoming work still has its own weight, and excused work
  // has already left the denominator — moving either would be inventing a scheme change.
  const missed = from.filter((i) => i.assessment.status === 'missed' && i.droppedBy === null);
  if (missed.length === 0) return;

  const moved = missed.reduce((sum, i) => sum + i.weight, 0);
  if (moved <= 0) return;

  for (const item of missed) {
    item.droppedBy = r.id;
    item.weight = 0;
  }

  // Split across the destination proportionally to existing weight, so "→ Final Exam" and
  // "→ remaining Assignments" both behave sensibly.
  const destTotal = to.reduce((sum, i) => sum + i.weight, 0);
  for (const dest of to) {
    dest.weight += destTotal > 0 ? (moved * dest.weight) / destTotal : moved / to.length;
  }

  ctx.applied.push({
    ruleId: r.id,
    type: 'redistribute',
    description: label(r),
    effect:
      `${moved}% from ${missed.map((i) => i.assessment.name).join(', ')} ` +
      `moved to ${to.map((i) => i.assessment.name).join(', ')}`,
  });
}

// ---------------------------------------------------------------------------
// bestNofM / dropLowest
// ---------------------------------------------------------------------------

export function applyBestNofM(ctx: RuleContext, r: BestNOfMRule | DropLowestRule): void {
  const group = resolveGroup(ctx.items, r.group).filter((i) => i.droppedBy === null);

  if (group.length === 0) {
    ctx.warnings.push(
      `Rule "${label(r)}" matched no assessments in this course — skipped.`,
    );
    return;
  }

  const take = r.type === 'bestNofM' ? r.take : Math.max(0, group.length - r.drop);
  if (take >= group.length) return;

  // Only graded items can be dropped: with 3 of 12 quizzes marked you cannot yet know which
  // 10 will count, and dropping an unmarked item would silently shrink the course.
  const gradedItems = group.filter((i) => i.isGraded);
  const dropCount = gradedItems.length - take;
  if (dropCount <= 0) return;

  // Lowest marks first — dropping those is what raises the average, which is what the rule
  // exists to do.
  const ordered = [...gradedItems].sort((a, b) => effectiveGrade(a) - effectiveGrade(b));
  const dropped = ordered.slice(0, dropCount);

  for (const item of dropped) {
    item.droppedBy = r.id;
  }

  ctx.applied.push({
    ruleId: r.id,
    type: r.type,
    description: label(r),
    // Display names, never slugs: this string is rendered in the rules panel and in
    // "show the math", where "dropped quiz-5" reads as a leaked database key.
    effect: `Best ${take} of ${gradedItems.length} applied — dropped ${dropped
      .map((i) => i.assessment.name)
      .join(', ')}`,
  });
}

// ---------------------------------------------------------------------------
// maxOf — evaluated against a scoring callback so it can compare whole outcomes
// ---------------------------------------------------------------------------

export function applyMaxOf(
  ctx: RuleContext,
  r: MaxOfRule,
  score: (items: WorkingItem[]) => number | null,
): void {
  const baseline = score(ctx.items);
  if (baseline == null) return;

  let bestScore = baseline;
  let bestVariant: number | null = null;
  let bestWeights: number[] | null = null;

  r.variants.forEach((variant, index) => {
    const unresolved = variant.filter(
      (o) => !ctx.items.some((i) => i.assessment.slug === o.slug),
    );
    if (unresolved.length > 0) {
      ctx.warnings.push(
        `Rule "${label(r)}" references ${unresolved
          .map((u) => `"${u.slug}"`)
          .join(', ')}, which this course doesn't have — that variant was skipped.`,
      );
      return;
    }

    const snapshot = ctx.items.map((i) => i.weight);
    for (const override of variant) {
      const item = ctx.items.find((i) => i.assessment.slug === override.slug)!;
      item.weight = override.weight;
    }

    const candidate = score(ctx.items);
    if (candidate != null && candidate > bestScore) {
      bestScore = candidate;
      bestVariant = index;
      bestWeights = ctx.items.map((i) => i.weight);
    }

    ctx.items.forEach((item, i) => {
      item.weight = snapshot[i];
    });
  });

  if (bestVariant == null || bestWeights == null) return;

  ctx.items.forEach((item, i) => {
    item.weight = bestWeights![i];
  });

  ctx.applied.push({
    ruleId: r.id,
    type: 'maxOf',
    description: label(r),
    effect:
      `Alternative weighting applied because it improves the grade ` +
      `(${round2(baseline)}% → ${round2(bestScore)}%)`,
  });
}

// ---------------------------------------------------------------------------
// bonus / cap / passGate — applied after the weighted sum
// ---------------------------------------------------------------------------

/** Bonus items add on top of the computed grade and never enter the denominator. */
export function bonusPoints(ctx: RuleContext, rules: BonusRule[]): number {
  let points = 0;

  for (const r of rules) {
    const item = ctx.items.find((i) => i.assessment.slug === r.slug);
    if (!item) {
      ctx.warnings.push(
        `Bonus rule "${label(r)}" references "${r.slug}", which this course doesn't have — skipped.`,
      );
      continue;
    }

    item.droppedBy = r.id; // keep it out of the denominator
    if (!item.isGraded) continue;

    const earned = (item.weight * effectiveGrade(item)) / 100;
    points += earned;

    ctx.applied.push({
      ruleId: r.id,
      type: 'bonus',
      description: label(r),
      effect: `+${round2(earned)} bonus marks from ${item.assessment.name}`,
    });
  }

  return points;
}

export function applyCap(
  ctx: RuleContext,
  rules: CapRule[],
  grade: number | null,
): number | null {
  if (grade == null) return null;

  let capped = grade;
  for (const r of rules) {
    if (capped > r.capAt) {
      capped = r.capAt;
      ctx.applied.push({
        ruleId: r.id,
        type: 'cap',
        description: label(r),
        effect: `Grade capped at ${r.capAt}%`,
      });
    }
  }
  return capped;
}

/**
 * Evaluate pass gates. This NEVER touches the numeric grade — it only returns a flag, so the
 * UI can show the average and the gate side by side and a pass can never be hidden.
 */
export function evaluatePassGates(ctx: RuleContext, rules: PassGateRule[]): PassGateStatus {
  let status: PassGateStatus = 'n/a';

  for (const r of rules) {
    const targets = resolveTarget(ctx.items, r.target).filter((i) => i.droppedBy === null);

    if (targets.length === 0) {
      // An unresolved gate must not fail anybody. Fall back to no gate and say why.
      ctx.warnings.push(
        `Pass-gate rule "${label(r)}" references an assessment this course doesn't have — ` +
          `the gate is not being applied.`,
      );
      continue;
    }

    const gradedTargets = targets.filter((i) => i.isGraded);
    const allGraded = gradedTargets.length === targets.length;

    if (!allGraded) {
      // Still outstanding: the gate could bite, so surface it — but it has not been failed.
      status = worst(status, 'at_risk');
      ctx.applied.push({
        ruleId: r.id,
        type: 'passGate',
        description: label(r),
        effect: `Requires at least ${r.min}% on ${targets
          .map((i) => i.assessment.name)
          .join(', ')} — not yet marked`,
      });
      continue;
    }

    const weight = gradedTargets.reduce((sum, i) => sum + i.weight, 0);
    const earned = gradedTargets.reduce(
      (sum, i) => sum + (i.weight * effectiveGrade(i)) / 100,
      0,
    );
    const componentGrade = weight > 0 ? (earned / weight) * 100 : 0;

    if (componentGrade + 1e-9 < r.min) {
      status = worst(status, 'failed');
      ctx.applied.push({
        ruleId: r.id,
        type: 'passGate',
        description: label(r),
        effect: `${round2(componentGrade)}% on ${targets
          .map((i) => i.assessment.name)
          .join(', ')} is below the required ${r.min}%`,
      });
    } else {
      status = worst(status, 'ok');
      ctx.applied.push({
        ruleId: r.id,
        type: 'passGate',
        description: label(r),
        effect: `${round2(componentGrade)}% meets the required ${r.min}%`,
      });
    }
  }

  return status;
}

const SEVERITY: Record<PassGateStatus, number> = {
  'n/a': 0,
  ok: 1,
  at_risk: 2,
  failed: 3,
};

function worst(a: PassGateStatus, b: PassGateStatus): PassGateStatus {
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Partition a course's rules by type, dropping disabled ones up front. */
export function partitionRules(course: Course) {
  const enabled = course.gradingRules.filter((r) => r.enabled);
  return {
    redistribute: enabled.filter((r): r is RedistributeRule => r.type === 'redistribute'),
    grouping: enabled.filter(
      (r): r is BestNOfMRule | DropLowestRule =>
        r.type === 'bestNofM' || r.type === 'dropLowest',
    ),
    maxOf: enabled.filter((r): r is MaxOfRule => r.type === 'maxOf'),
    bonus: enabled.filter((r): r is BonusRule => r.type === 'bonus'),
    cap: enabled.filter((r): r is CapRule => r.type === 'cap'),
    passGate: enabled.filter((r): r is PassGateRule => r.type === 'passGate'),
  };
}
