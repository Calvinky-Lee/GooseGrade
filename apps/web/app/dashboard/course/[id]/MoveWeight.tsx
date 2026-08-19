'use client';

/**
 * The "move weight" gesture — design decision D1, specs/06 F3.1 amendment.
 *
 * This replaces v1's mouse-only drag-and-drop "drop mode", which mutated weights in ephemeral
 * React state and was lost on refresh. The gesture now APPENDS A RULE:
 *
 *   - it shows up in the rules panel, tagged `you` rather than `official`
 *   - it is individually toggleable and removable
 *   - it appears in appliedRules, so "show the math" explains it
 *   - it survives refresh and term rollover
 *   - it sets rules_overridden, so "reset to official" reverses it
 *
 * A menu rather than a drag also satisfies F6.1's keyboard/touch requirement without needing a
 * separate accessible path.
 */

import { useState } from 'react';

import type { Assessment, Course, RedistributeRule } from '@goosegrade/types';

export function MoveWeight({
  course,
  assessment,
  onAddRule,
}: {
  course: Course;
  assessment: Assessment;
  onAddRule: (rule: RedistributeRule) => void;
}) {
  const [open, setOpen] = useState(false);

  // Only MISSED work redistributes — that is the engine's rule, so offering the gesture on
  // anything else would produce a rule that silently never fires.
  if (assessment.status !== 'missed') return null;

  const alreadyMoved = course.gradingRules.some(
    (r) => r.type === 'redistribute' && r.enabled && r.from.slug === assessment.slug,
  );
  if (alreadyMoved) {
    return <span className="gg-hint" style={{ margin: 0 }}>weight moved — see rules</span>;
  }

  const targets = course.assessments.filter(
    (a) => !a.isRemoved && a.slug !== assessment.slug && a.status !== 'excused',
  );

  // "Spread over remaining X" only makes sense where more than one X is outstanding. Offering
  // it for a single item produced "spread over remaining Final Exams", which reads as a bug —
  // and would in any case be identical to picking that one item directly.
  const outstandingByCategory = new Map<string, number>();
  for (const a of targets) {
    if (a.status !== 'upcoming' || !a.category) continue;
    outstandingByCategory.set(a.category, (outstandingByCategory.get(a.category) ?? 0) + 1);
  }
  const categoriesLeft = [...outstandingByCategory]
    .filter(([, count]) => count > 1)
    .map(([category]) => category);

  const add = (to: RedistributeRule['to'], description: string) => {
    onAddRule({
      id: `usr-redist-${assessment.slug}-${Date.now()}`,
      type: 'redistribute',
      enabled: true,
      // Provenance is what lets the rules panel tag this `you` and lets reset-to-official
      // distinguish it from a scraped rule.
      source: 'user',
      description,
      from: { slug: assessment.slug },
      to,
    });
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        className="gg-link"
        style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
        onClick={() => setOpen(true)}
      >
        ↳ move weight
      </button>
    );
  }

  return (
    <div className="gg-movemenu" role="group" aria-label={`move ${assessment.name} weight to`}>
      <div className="gg-hint" style={{ marginTop: 0 }}>
        move its <b>{assessment.weight}%</b> to…
      </div>

      {targets
        .filter((a) => a.status === 'upcoming')
        .map((a) => (
          <button
            key={a.id}
            type="button"
            className="gg-moveopt"
            onClick={() => add({ slug: a.slug }, `${assessment.name} weight → ${a.name}`)}
          >
            {a.name}
          </button>
        ))}

      {categoriesLeft.map((cat) => (
        <button
          key={cat}
          type="button"
          className="gg-moveopt"
          onClick={() =>
            add(
              { category: cat as RedistributeRule['to']['category'] },
              `${assessment.name} weight spread over remaining ${plural(cat)}`,
            )
          }
        >
          spread over remaining {plural(cat)}
        </button>
      ))}

      {targets.filter((a) => a.status === 'upcoming').length === 0 && (
        <div className="gg-hint">Nothing outstanding to move it onto.</div>
      )}

      <button
        type="button"
        className="gg-link"
        style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0, marginTop: 4 }}
        onClick={() => setOpen(false)}
      >
        cancel
      </button>
    </div>
  );
}

/** Matches the display pluralisation used by groupAssessments, so the two never disagree. */
function plural(category: string): string {
  const map: Record<string, string> = {
    Assignment: 'assignments',
    Quiz: 'quizzes',
    Lab: 'labs',
    Project: 'projects',
  };
  return map[category] ?? `${category.toLowerCase()}s`;
}
