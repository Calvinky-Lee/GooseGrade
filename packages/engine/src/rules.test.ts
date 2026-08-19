import { describe, expect, it, beforeEach } from 'vitest';

import { computeCourse } from './computeCourse';
import {
  graded,
  makeAssessment,
  makeCourse,
  resetIds,
  rule,
  upcoming,
  withStatus,
} from './testing';
import type {
  BestNOfMRule,
  BonusRule,
  CapRule,
  DropLowestRule,
  MaxOfRule,
  PassGateRule,
  RedistributeRule,
} from '@goosegrade/types';

beforeEach(resetIds);

const quizzes = (grades: Array<number | null>) =>
  grades.map((g, i) =>
    g == null
      ? upcoming(`quiz-${i + 1}`, 5, 'Quiz')
      : graded(`quiz-${i + 1}`, 5, g, 'Quiz'),
  );

describe('bestNofM', () => {
  it('drops the lowest graded items once more than `take` are graded', () => {
    const course = makeCourse({
      assessments: [...quizzes([100, 100, 40]), graded('final-exam', 85, 80)],
      gradingRules: [
        rule<BestNOfMRule>({ type: 'bestNofM', group: { category: 'Quiz' }, take: 2 }),
      ],
    });

    const r = computeCourse(course);

    // Quiz 3 (40) dropped: (5*100 + 5*100 + 85*80) / 95
    expect(r.currentGrade).toBeCloseTo(((5 + 5 + 68) / 95) * 100, 8);
    expect(r.appliedRules.some((a) => a.type === 'bestNofM')).toBe(true);
  });

  it('names the dropped item by its display name, not its slug', () => {
    // The fixture helper defaults name to slug, so this case sets them apart deliberately:
    // the effect string is rendered in the rules panel and in "show the math", where
    // "dropped quiz-3" would read as a leaked database key.
    const course = makeCourse({
      assessments: [
        makeAssessment({ slug: 'quiz-1', name: 'Quiz 1', weight: 5, grade: 100, category: 'Quiz' }),
        makeAssessment({ slug: 'quiz-2', name: 'Quiz 2', weight: 5, grade: 100, category: 'Quiz' }),
        makeAssessment({ slug: 'quiz-3', name: 'Quiz 3', weight: 5, grade: 40, category: 'Quiz' }),
        graded('final-exam', 85, 80),
      ],
      gradingRules: [
        rule<BestNOfMRule>({ type: 'bestNofM', group: { category: 'Quiz' }, take: 2 }),
      ],
    });

    const effect = computeCourse(course).appliedRules.find((a) => a.type === 'bestNofM')!.effect;

    expect(effect).toContain('Quiz 3');
    expect(effect).not.toContain('quiz-3');
  });

  it('drops nothing while fewer than `take` items are graded', () => {
    // 12 quizzes, best 10, only 3 marked so far — you cannot yet know which 10 will count.
    const course = makeCourse({
      assessments: [...quizzes([90, 50, 70, null, null, null]), graded('final-exam', 70, 80)],
      gradingRules: [
        rule<BestNOfMRule>({ type: 'bestNofM', group: { category: 'Quiz' }, take: 5 }),
      ],
    });

    const r = computeCourse(course);

    expect(r.appliedRules).toEqual([]);
    // All three graded quizzes still count.
    expect(r.currentGrade).toBeCloseTo(((4.5 + 2.5 + 3.5 + 56) / 85) * 100, 8);
  });

  it('selects by grade, so dropping raises the average', () => {
    const withRule = makeCourse({
      assessments: quizzes([100, 20]),
      gradingRules: [
        rule<BestNOfMRule>({ type: 'bestNofM', group: { category: 'Quiz' }, take: 1 }),
      ],
    });
    const without = makeCourse({ assessments: quizzes([100, 20]) });

    expect(computeCourse(withRule).currentGrade!).toBeGreaterThan(
      computeCourse(without).currentGrade!,
    );
  });

  it('resolves a group by explicit slugs as well as by category', () => {
    const course = makeCourse({
      assessments: quizzes([100, 100, 10]),
      gradingRules: [
        rule<BestNOfMRule>({
          type: 'bestNofM',
          group: { slugs: ['quiz-1', 'quiz-2', 'quiz-3'] },
          take: 2,
        }),
      ],
    });

    expect(computeCourse(course).currentGrade).toBe(100);
  });
});

describe('dropLowest', () => {
  it('is the convenience form of bestNofM', () => {
    const course = makeCourse({
      assessments: quizzes([100, 100, 30]),
      gradingRules: [
        rule<DropLowestRule>({ type: 'dropLowest', group: { category: 'Quiz' }, drop: 1 }),
      ],
    });

    expect(computeCourse(course).currentGrade).toBe(100);
  });
});

describe('redistribute', () => {
  it('moves a missed item’s weight onto the target', () => {
    const course = makeCourse({
      assessments: [
        withStatus('assignment-3', 10, 'missed'),
        graded('final-exam', 90, 80),
      ],
      gradingRules: [
        rule<RedistributeRule>({
          type: 'redistribute',
          from: { slug: 'assignment-3' },
          to: { slug: 'final-exam' },
        }),
      ],
    });

    const r = computeCourse(course);

    // The 10% moves to the final rather than standing as a zero: 80% of 100.
    expect(r.currentGrade).toBe(80);
    expect(r.appliedRules[0].type).toBe('redistribute');
  });

  it('does not fire for work that is merely upcoming', () => {
    const course = makeCourse({
      assessments: [upcoming('assignment-3', 10), graded('final-exam', 90, 80)],
      gradingRules: [
        rule<RedistributeRule>({
          type: 'redistribute',
          from: { slug: 'assignment-3' },
          to: { slug: 'final-exam' },
        }),
      ],
    });

    const r = computeCourse(course);

    expect(r.appliedRules).toEqual([]);
    expect(r.remainingWeight).toBe(10);
  });
});

describe('maxOf', () => {
  it('picks the variant that maximises the grade', () => {
    // "Final counts 40%, or 60% if that helps you." Student did better on the final.
    const course = makeCourse({
      assessments: [graded('midterm', 60, 60), graded('final-exam', 40, 90)],
      gradingRules: [
        rule<MaxOfRule>({
          type: 'maxOf',
          variants: [
            [
              { slug: 'midterm', weight: 40 },
              { slug: 'final-exam', weight: 60 },
            ],
          ],
        }),
      ],
    });

    const r = computeCourse(course);

    // Base: 0.6*60 + 0.4*90 = 72. Variant: 0.4*60 + 0.6*90 = 78. Engine must choose 78.
    expect(r.currentGrade).toBeCloseTo(78, 8);
    expect(r.appliedRules.some((a) => a.type === 'maxOf')).toBe(true);
  });

  it('keeps the base weights when no variant helps', () => {
    const course = makeCourse({
      assessments: [graded('midterm', 60, 90), graded('final-exam', 40, 50)],
      gradingRules: [
        rule<MaxOfRule>({
          type: 'maxOf',
          variants: [
            [
              { slug: 'midterm', weight: 40 },
              { slug: 'final-exam', weight: 60 },
            ],
          ],
        }),
      ],
    });

    // Base 74 beats the variant's 66 — the rule must never lower the grade.
    expect(computeCourse(course).currentGrade).toBeCloseTo(74, 8);
  });
});

describe('bonus and cap', () => {
  it('adds bonus marks on top without entering the denominator', () => {
    const course = makeCourse({
      assessments: [graded('final-exam', 100, 80), graded('bonus-quiz', 5, 100)],
      gradingRules: [rule<BonusRule>({ type: 'bonus', slug: 'bonus-quiz' })],
    });

    const r = computeCourse(course);

    expect(r.currentGrade).toBeCloseTo(85, 8);
    expect(r.completedWeight).toBe(100); // the bonus weight is not part of the course
  });

  it('caps the final grade', () => {
    const course = makeCourse({
      assessments: [graded('final-exam', 100, 98), graded('bonus-quiz', 10, 100)],
      gradingRules: [
        rule<BonusRule>({ type: 'bonus', slug: 'bonus-quiz' }),
        rule<CapRule>({ type: 'cap', capAt: 100 }),
      ],
    });

    expect(computeCourse(course).currentGrade).toBe(100);
  });
});

describe('passGate — never mutates the number', () => {
  it('reports failed while still showing the real average', () => {
    const course = makeCourse({
      assessments: [graded('coursework', 50, 95), graded('final-exam', 50, 40)],
      gradingRules: [
        rule<PassGateRule>({
          type: 'passGate',
          target: { slug: 'final-exam' },
          min: 50,
          coursePassMark: 50,
        }),
      ],
    });

    const r = computeCourse(course);

    // The average is 67.5 and MUST still read 67.5. The gate is a separate flag.
    expect(r.currentGrade).toBeCloseTo(67.5, 8);
    expect(r.passGateStatus).toBe('failed');
  });

  it('reports ok when the gated component clears the bar', () => {
    const course = makeCourse({
      assessments: [graded('coursework', 50, 60), graded('final-exam', 50, 55)],
      gradingRules: [
        rule<PassGateRule>({
          type: 'passGate',
          target: { slug: 'final-exam' },
          min: 50,
          coursePassMark: 50,
        }),
      ],
    });

    expect(computeCourse(course).passGateStatus).toBe('ok');
  });

  it('reports at_risk while the gated component is unmarked', () => {
    const course = makeCourse({
      assessments: [graded('coursework', 50, 70), upcoming('final-exam', 50)],
      gradingRules: [
        rule<PassGateRule>({
          type: 'passGate',
          target: { slug: 'final-exam' },
          min: 50,
          coursePassMark: 50,
        }),
      ],
    });

    expect(computeCourse(course).passGateStatus).toBe('at_risk');
  });
});

describe('safety contract (specs/03 §5)', () => {
  const conditional = makeCourse({
    assessments: [...quizzes([100, 100, 30]), graded('final-exam', 85, 60)],
    gradingRules: [
      rule<BestNOfMRule>({ type: 'bestNofM', group: { category: 'Quiz' }, take: 2 }),
      rule<CapRule>({ type: 'cap', capAt: 100 }),
    ],
  });

  it('a disabled rule is ignored entirely', () => {
    const disabled = {
      ...conditional,
      gradingRules: conditional.gradingRules.map((r) => ({ ...r, enabled: false })),
    };
    const none = { ...conditional, gradingRules: [] };

    expect(computeCourse(disabled).currentGrade).toBe(computeCourse(none).currentGrade);
    expect(computeCourse(disabled).appliedRules).toEqual([]);
  });

  it('disabling every special rule reproduces the plain weighted sum', () => {
    const disabled = {
      ...conditional,
      gradingRules: conditional.gradingRules.map((r) => ({ ...r, enabled: false })),
    };

    const expected = ((5 + 5 + 1.5 + 51) / 100) * 100;
    expect(computeCourse(disabled).currentGrade).toBeCloseTo(expected, 8);
  });

  it('skips a rule with unresolved references, warns, and never throws', () => {
    const course = makeCourse({
      assessments: [graded('final-exam', 100, 80)],
      gradingRules: [
        rule<BestNOfMRule>({ type: 'bestNofM', group: { slugs: ['does-not-exist'] }, take: 1 }),
        rule<RedistributeRule>({
          type: 'redistribute',
          from: { slug: 'ghost' },
          to: { slug: 'phantom' },
        }),
      ],
    });

    const r = computeCourse(course);

    expect(r.currentGrade).toBe(80); // falls back to plain weighted sum
    expect(r.appliedRules).toEqual([]);
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('never lets a rule push the grade above the ceiling', () => {
    const r = computeCourse(conditional);
    expect(r.currentGrade!).toBeLessThanOrEqual(r.ceiling);
    expect(r.floor).toBeLessThanOrEqual(r.ceiling);
  });

  it('a passing weighted average is never reported as a fail without a resolved gate', () => {
    const course = makeCourse({
      assessments: [graded('final-exam', 100, 72)],
      gradingRules: [
        // Gate targets something that does not exist — must not fail the student.
        rule<PassGateRule>({
          type: 'passGate',
          target: { slug: 'nonexistent-final' },
          min: 50,
          coursePassMark: 50,
        }),
      ],
    });

    const r = computeCourse(course);

    expect(r.currentGrade).toBe(72);
    expect(r.passGateStatus).toBe('n/a');
  });
});
