/**
 * Turns an extracted scheme into rules the engine can safely run — specs/07 §2 safety tie-in.
 *
 * The binding principle: **a missed special rule is safe; a wrong one is not.** So anything that
 * cannot be proven usable is dropped and the course is downgraded to `review`, which makes the
 * UI fall back to a plain weighted sum. Nothing here guesses.
 */

import { checkInvariants } from '@goosegrade/engine';
import type { Course, GradingRule, SchemeConfidence } from '@goosegrade/types';

import type { ExtractedRule, ExtractedScheme } from './schema';

export interface SanitizedScheme {
  assessments: ExtractedScheme['assessments'];
  rules: GradingRule[];
  confidence: SchemeConfidence;
  /** Human-readable reasons a rule was dropped or the confidence downgraded. */
  notes: string[];
}

const WEIGHT_TOLERANCE = 0.01;

/** Attach the fields the domain type needs but the model does not produce. */
function materialize(rule: ExtractedRule, index: number): GradingRule {
  return {
    ...rule,
    id: `scraped-${rule.type}-${index}`,
    enabled: true,
    source: 'scraped',
  } as GradingRule;
}

/** Every slug a rule references, so unresolvable rules can be dropped before they ship. */
function referencedSlugs(rule: ExtractedRule): string[] {
  switch (rule.type) {
    case 'bestNofM':
    case 'dropLowest':
      return rule.group.slugs ?? [];
    case 'maxOf':
      return rule.variants.flat().map((v) => v.slug);
    case 'redistribute':
      return [rule.from.slug, rule.to.slug].filter((s): s is string => !!s);
    case 'passGate':
      return rule.target.slug ? [rule.target.slug] : [];
    case 'bonus':
      return [rule.slug];
    case 'cap':
      return [];
  }
}

function referencedCategories(rule: ExtractedRule): readonly string[] {
  switch (rule.type) {
    case 'bestNofM':
    case 'dropLowest':
      return rule.group.category ? [rule.group.category] : [];
    case 'redistribute':
      return [rule.from.category, rule.to.category].filter(
        (c): c is NonNullable<typeof c> => c != null,
      );
    case 'passGate':
      return rule.target.category ? [rule.target.category] : [];
    default:
      return [];
  }
}

export function sanitizeScheme(scheme: ExtractedScheme, courseCode: string): SanitizedScheme {
  const notes: string[] = [];
  if (scheme.notes.trim()) notes.push(scheme.notes.trim());

  const slugs = new Set(scheme.assessments.map((a) => a.slug));
  const categories = new Set(scheme.assessments.map((a) => a.category));

  // Duplicate slugs would violate the (course_id, slug) unique index AND silently make rule
  // references ambiguous, so this is a hard downgrade rather than a dropped rule.
  const dupes = scheme.assessments
    .map((a) => a.slug)
    .filter((s, i, arr) => arr.indexOf(s) !== i);
  if (dupes.length > 0) {
    notes.push(`Duplicate slugs from extraction: ${[...new Set(dupes)].join(', ')}.`);
  }

  const total = scheme.assessments.reduce((sum, a) => sum + a.weight, 0);
  const weightsOk = Math.abs(total - 100) <= WEIGHT_TOLERANCE;
  if (!weightsOk) {
    notes.push(`Extracted weights sum to ${total.toFixed(4)}%, not 100%.`);
  }

  const kept: GradingRule[] = [];

  scheme.rules.forEach((rule, index) => {
    const missingSlugs = referencedSlugs(rule).filter((s) => !slugs.has(s));
    const missingCats = referencedCategories(rule).filter((c) => !categories.has(c as never));

    if (missingSlugs.length > 0 || missingCats.length > 0) {
      // Dropped rather than kept-and-warned. A rule that cannot resolve is dead weight in the
      // UI at best, and at worst the model invented an assessment that does not exist.
      notes.push(
        `Dropped ${rule.type} rule referencing ` +
          [...missingSlugs, ...missingCats].map((x) => `"${x}"`).join(', ') +
          ` (not in ${courseCode}).`,
      );
      return;
    }

    // A bestNofM that keeps everything, or a dropLowest that drops nothing, is a no-op the
    // model produced from prose like "all quizzes count". Keeping it clutters the rules panel.
    if (rule.type === 'bestNofM') {
      const poolSize = rule.group.slugs
        ? rule.group.slugs.length
        : scheme.assessments.filter((a) => a.category === rule.group.category).length;
      if (rule.take >= poolSize) {
        notes.push(`Dropped no-op bestNofM (take ${rule.take} of ${poolSize}).`);
        return;
      }
    }
    if (rule.type === 'dropLowest' && rule.drop <= 0) {
      notes.push('Dropped no-op dropLowest (drop 0).');
      return;
    }

    kept.push(materialize(rule, index));
  });

  // Confidence: the model's own label is a ceiling, never a promotion. Anything the checks
  // above flagged is forced down to `review`, which makes the UI fall back to plain weighted
  // sum with the special rules left advisory.
  let confidence: SchemeConfidence = scheme.confidence;
  if (!weightsOk || dupes.length > 0 || kept.length !== scheme.rules.length) {
    confidence = 'review';
  }

  return { assessments: scheme.assessments, rules: kept, confidence, notes };
}

/**
 * Final gate before writing: run the engine's own safety invariants over the extracted scheme.
 *
 * This is the SAME module CI and the QA runner use, so a scheme cannot be written to the catalog
 * that would fail the gate later — the failure is caught at extraction time, where the notes
 * explaining it are still to hand.
 */
export function validateAgainstEngine(
  sanitized: SanitizedScheme,
  courseCode: string,
): { ok: boolean; violations: string[] } {
  const course: Course = {
    id: `extract:${courseCode}`,
    catalogCourseId: null,
    code: courseCode,
    name: courseCode,
    section: null,
    creditWeight: 0.5,
    gradeBasis: 'numeric',
    gradingRules: sanitized.rules,
    rulesOverridden: false,
    targetGrade: null,
    assessments: sanitized.assessments.map((a, i) => ({
      id: `x${i}`,
      slug: a.slug,
      name: a.name,
      category: a.category,
      assessmentType: a.category,
      weight: a.weight,
      orderIndex: a.orderIndex,
      // Mid-term shape: some graded, some not. Exercises the rule paths that only fire once
      // marks exist, which is where a bad rule actually bites.
      grade: i % 2 === 0 ? 70 : null,
      status: i % 2 === 0 ? 'graded' : 'upcoming',
      isCustom: false,
      isRemoved: false,
    })),
  };

  const violations = checkInvariants(course)
    .filter((v) => v.severity === 'violation')
    .map((v) => `${v.invariant}: ${v.message}`);

  return { ok: violations.length === 0, violations };
}
