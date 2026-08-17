/**
 * Display grouping — specs/03 §4, amendment A3.
 *
 * Collapses Quiz 1/2/3 into a single "Quizzes" row. Ported from the legacy course page so the
 * course view and the calculator share ONE implementation; the duplicated copies were most of
 * the 1,800-line file this replaces.
 */

import type { Assessment, AssessmentCategory, DisplayItem } from '@/lib/types';

/** Plural display names for the categories that repeat. */
const PLURALS: Partial<Record<AssessmentCategory, string>> = {
  Assignment: 'Assignments',
  Quiz: 'Quizzes',
  Lab: 'Labs',
  Project: 'Projects',
};

/**
 * Two or more visible assessments sharing a category become one group row. A lone item stays
 * ungrouped — "Quizzes (1)" is noise.
 *
 * Categories that are inherently singular (Midterm, Final Exam, Participation) are never
 * grouped even when duplicated, because "Final Exams" reads as an error.
 */
const NEVER_GROUP: ReadonlySet<AssessmentCategory> = new Set([
  'Midterm',
  'Final Exam',
  'Participation',
  'Other',
]);

export function groupAssessments(assessments: Assessment[]): DisplayItem[] {
  const visible = assessments
    .filter((a) => !a.isRemoved)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  const counts = new Map<AssessmentCategory, number>();
  for (const a of visible) {
    if (a.category && !NEVER_GROUP.has(a.category)) {
      counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
    }
  }

  const items: DisplayItem[] = [];
  const emitted = new Set<AssessmentCategory>();

  for (const assessment of visible) {
    const category = assessment.category;
    const groupable = category != null && (counts.get(category) ?? 0) > 1;

    if (!groupable) {
      items.push({ isGroup: false, id: assessment.id, assessment });
      continue;
    }

    // Emit the group once, at the position of its first member, so ordering is preserved.
    if (emitted.has(category!)) continue;
    emitted.add(category!);

    const children = visible.filter((a) => a.category === category);

    items.push({
      isGroup: true,
      id: `group:${category}`,
      name: PLURALS[category!] ?? `${category}s`,
      category,
      weight: children.reduce((sum, c) => sum + c.weight, 0),
      children,
    });
  }

  return items;
}
