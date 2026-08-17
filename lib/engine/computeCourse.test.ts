import { describe, expect, it, beforeEach } from 'vitest';

import { computeCourse } from './computeCourse';
import { graded, makeCourse, resetIds, upcoming, withStatus } from './testing';

beforeEach(resetIds);

describe('computeCourse — plain weighted sum', () => {
  it('returns null currentGrade when nothing is graded (amendment A2)', () => {
    // The founding correctness rule is that a passing student is never displayed as failing.
    // Returning 0 here would show every student 0.0% in week one of term.
    const course = makeCourse({
      assessments: [upcoming('midterm', 30), upcoming('final-exam', 70)],
    });

    const r = computeCourse(course);

    expect(r.currentGrade).toBeNull();
    expect(r.projectedGrade).toBeNull();
    expect(r.completedWeight).toBe(0);
    expect(r.remainingWeight).toBe(100);
  });

  it('still reports a real achievable range before anything is graded', () => {
    const course = makeCourse({
      assessments: [upcoming('midterm', 30), upcoming('final-exam', 70)],
    });

    const r = computeCourse(course);

    // floor/ceiling are never null — "you can still get anywhere from 0 to 100" is information.
    expect(r.floor).toBe(0);
    expect(r.ceiling).toBe(100);
  });

  it('computes the weighted average over graded work only', () => {
    const course = makeCourse({
      assessments: [
        graded('midterm', 30, 80), // 24 of 30
        upcoming('final-exam', 70),
      ],
    });

    const r = computeCourse(course);

    expect(r.currentGrade).toBe(80);
    expect(r.completedWeight).toBe(30);
    expect(r.remainingWeight).toBe(70);
    // 24 earned, 70 still available
    expect(r.floor).toBeCloseTo(24, 10);
    expect(r.ceiling).toBeCloseTo(94, 10);
  });

  it('weights each item by its own weight, not equally', () => {
    const course = makeCourse({
      assessments: [
        graded('quiz-1', 10, 100),
        graded('final-exam', 90, 50),
      ],
    });

    // (10*100 + 90*50) / 100 = 55, NOT the unweighted mean of 75.
    expect(computeCourse(course).currentGrade).toBeCloseTo(55, 10);
  });

  it('is fully graded when every item has a mark', () => {
    const course = makeCourse({
      assessments: [graded('midterm', 40, 70), graded('final-exam', 60, 90)],
    });

    const r = computeCourse(course);

    expect(r.currentGrade).toBeCloseTo(82, 10);
    expect(r.remainingWeight).toBe(0);
    // Nothing left to move the number: floor == ceiling == the grade.
    expect(r.floor).toBeCloseTo(82, 10);
    expect(r.ceiling).toBeCloseTo(82, 10);
  });

  it('projects remaining work at the current average', () => {
    const course = makeCourse({
      assessments: [graded('midterm', 50, 60), upcoming('final-exam', 50)],
    });

    // Neutral tool: no optimistic bias. Assume you keep scoring what you have been.
    expect(computeCourse(course).projectedGrade).toBeCloseTo(60, 10);
  });
});

describe('computeCourse — status semantics (the correctness keystone)', () => {
  it('excused work leaves the denominator entirely', () => {
    const course = makeCourse({
      assessments: [
        graded('midterm', 30, 90),
        withStatus('quiz-1', 20, 'excused'),
        upcoming('final-exam', 50),
      ],
    });

    const r = computeCourse(course);

    // 90% on the midterm, quiz excused: the 20% is gone, not zeroed.
    expect(r.currentGrade).toBe(90);
    expect(r.completedWeight).toBe(30);
    expect(r.remainingWeight).toBe(50);
    // Denominator is 80, so 27 earned of a possible 80 → scaled to 100.
    expect(r.ceiling).toBeCloseTo(((27 + 50) / 80) * 100, 10);
  });

  it('missed work is a real zero, not excused', () => {
    const course = makeCourse({
      assessments: [
        graded('midterm', 30, 90),
        withStatus('quiz-1', 20, 'missed'),
        upcoming('final-exam', 50),
      ],
    });

    const r = computeCourse(course);

    // 27 earned out of 50 completed weight (30 midterm + 20 missed).
    expect(r.currentGrade).toBeCloseTo(54, 10);
    expect(r.completedWeight).toBe(50);
  });

  it('distinguishes excused from missed — this is what prevents wrongly failing a student', () => {
    const base = [graded('midterm', 50, 88)];

    const excusedCourse = makeCourse({
      assessments: [...base, withStatus('final-exam', 50, 'excused')],
    });
    const missedCourse = makeCourse({
      assessments: [...base, withStatus('final-exam', 50, 'missed')],
    });

    expect(computeCourse(excusedCourse).currentGrade).toBe(88); // passing
    expect(computeCourse(missedCourse).currentGrade).toBeCloseTo(44, 10); // failing
  });

  it('returns null rather than dividing by zero when everything is excused', () => {
    const course = makeCourse({
      assessments: [
        withStatus('midterm', 40, 'excused'),
        withStatus('final-exam', 60, 'excused'),
      ],
    });

    const r = computeCourse(course);

    expect(r.currentGrade).toBeNull();
    expect(r.completedWeight).toBe(0);
    expect(r.warnings.some((w) => /excused/i.test(w))).toBe(true);
  });

  it('ignores soft-removed items completely', () => {
    const course = makeCourse({
      assessments: [
        graded('midterm', 50, 80),
        { ...graded('dropped-item', 50, 10), isRemoved: true },
      ],
    });

    expect(computeCourse(course).currentGrade).toBe(80);
  });

  it('treats a graded item with a null mark as upcoming rather than as a zero', () => {
    // Defensive: `status: 'graded'` with `grade: null` is inconsistent data. Scoring it 0
    // would invent a failing mark from a database inconsistency.
    const course = makeCourse({
      assessments: [
        withStatus('midterm', 50, 'graded', null),
        graded('final-exam', 50, 70),
      ],
    });

    const r = computeCourse(course);

    expect(r.currentGrade).toBe(70);
    expect(r.completedWeight).toBe(50);
    expect(r.warnings.some((w) => /midterm/.test(w))).toBe(true);
  });
});

describe('computeCourse — warnings', () => {
  it('warns when weights do not sum to 100 but still computes', () => {
    const course = makeCourse({
      assessments: [graded('midterm', 30, 80), upcoming('final-exam', 40)],
    });

    const r = computeCourse(course);

    expect(r.warnings.some((w) => /70/.test(w))).toBe(true);
    expect(r.currentGrade).toBe(80); // never withhold the number over a warning
  });

  it('does not warn when weights sum to 100 within floating-point tolerance', () => {
    // 3.1818… × 11 + 65 — the shared-weight case the scraper prompt produces.
    const shared = Array.from({ length: 11 }, (_, i) =>
      graded(`weekly-${i + 1}`, 35 / 11, 90),
    );
    const course = makeCourse({
      assessments: [...shared, graded('final-exam', 65, 70)],
    });

    expect(computeCourse(course).warnings).toEqual([]);
  });

  it('returns an empty-but-valid result for a course with no assessments', () => {
    const r = computeCourse(makeCourse({ assessments: [] }));

    expect(r.currentGrade).toBeNull();
    expect(r.floor).toBe(0);
    expect(r.ceiling).toBe(100);
    expect(r.appliedRules).toEqual([]);
  });
});
