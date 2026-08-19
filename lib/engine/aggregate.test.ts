import { describe, expect, it, beforeEach } from 'vitest';

import { computeCumulative, computeTermAverage } from './aggregate';
import { requiredAcrossCourses, requiredForCourse } from './required';
import { groupAssessments } from './groupAssessments';
import { CR_NCR, graded, makeCourse, makeTerm, resetIds, upcoming } from './testing';

beforeEach(resetIds);

describe('computeTermAverage — credit-weighted', () => {
  it('weights each course by its credit value, not equally', () => {
    const half = makeCourse({
      code: 'CS 240',
      creditWeight: 0.5,
      assessments: [graded('final-exam', 100, 60)],
    });
    const full = makeCourse({
      code: 'CS 241',
      creditWeight: 1.0,
      assessments: [graded('final-exam', 100, 90)],
    });

    const r = computeTermAverage([half, full]);

    // (0.5*60 + 1.0*90) / 1.5 = 80, NOT the unweighted mean of 75.
    expect(r.average).toBeCloseTo(80, 8);
    expect(r.includedCredits).toBeCloseTo(1.5, 8);
  });

  it('excludes CR/NCR courses and says why', () => {
    const numeric = makeCourse({
      code: 'CS 240',
      assessments: [graded('final-exam', 100, 80)],
    });
    const crncr = makeCourse({
      code: 'PD 11',
      gradeBasis: CR_NCR,
      assessments: [graded('final-exam', 100, 100)],
    });

    const r = computeTermAverage([numeric, crncr]);

    expect(r.average).toBe(80);
    expect(r.includedCredits).toBeCloseTo(0.5, 8);
    expect(r.exclusions).toEqual([{ courseId: crncr.id, reason: 'cr_ncr' }]);
    expect(r.excludedCourseIds).toEqual([crncr.id]);
  });

  it('excludes not-yet-graded courses with a distinct reason (amendment A1)', () => {
    // "PD 11 excluded" and "STAT 230 has no marks yet" are different messages.
    const graded_ = makeCourse({ assessments: [graded('final-exam', 100, 75)] });
    const fresh = makeCourse({ assessments: [upcoming('final-exam', 100)] });

    const r = computeTermAverage([graded_, fresh]);

    expect(r.average).toBe(75);
    expect(r.exclusions).toEqual([{ courseId: fresh.id, reason: 'no_graded_work' }]);
  });

  it('returns null rather than 0 when no course has a mark yet', () => {
    const r = computeTermAverage([makeCourse({ assessments: [upcoming('final-exam', 100)] })]);

    expect(r.average).toBeNull();
    expect(r.projectedAverage).toBeNull();
    expect(r.includedCredits).toBe(0);
  });

  it('handles an empty term', () => {
    const r = computeTermAverage([]);
    expect(r.average).toBeNull();
    expect(r.exclusions).toEqual([]);
  });
});

describe('computeCumulative (amendment A1)', () => {
  it('averages across every term, credit-weighted', () => {
    const past = makeTerm({
      termLabel: 'Winter 2026',
      termDate: '2026-01-01',
      isCurrent: false,
      courses: [makeCourse({ creditWeight: 1.0, assessments: [graded('f', 100, 70)] })],
    });
    const current = makeTerm({
      termLabel: 'Spring 2026',
      termDate: '2026-05-01',
      courses: [makeCourse({ creditWeight: 1.0, assessments: [graded('f', 100, 80)] })],
    });

    const r = computeCumulative([current, past]);

    expect(r.average).toBeCloseTo(75, 8);
    expect(r.includedCredits).toBeCloseTo(2.0, 8);
  });

  it('reports the delta against the most recent prior term', () => {
    const past = makeTerm({
      termDate: '2026-01-01',
      isCurrent: false,
      courses: [makeCourse({ assessments: [graded('f', 100, 70)] })],
    });
    const current = makeTerm({
      termDate: '2026-05-01',
      courses: [makeCourse({ assessments: [graded('f', 100, 82)] })],
    });

    // The mockup's "▲ 1.3 vs last term" — current term average minus previous term average.
    expect(computeCumulative([current, past]).deltaVsPreviousTerm).toBeCloseTo(12, 8);
  });

  it('has no delta in a first term, rather than showing 0', () => {
    const only = makeTerm({ courses: [makeCourse({ assessments: [graded('f', 100, 82)] })] });

    expect(computeCumulative([only]).deltaVsPreviousTerm).toBeNull();
  });

  it('orders perTerm oldest-first regardless of input order', () => {
    const a = makeTerm({ termLabel: 'W26', termDate: '2026-01-01', courses: [] });
    const b = makeTerm({ termLabel: 'S26', termDate: '2026-05-01', courses: [] });

    expect(computeCumulative([b, a]).perTerm.map((t) => t.termLabel)).toEqual(['W26', 'S26']);
  });
});

describe('requiredForCourse', () => {
  it('computes the average needed on remaining work', () => {
    const course = makeCourse({
      assessments: [graded('midterm', 50, 70), upcoming('final-exam', 50)],
    });

    // Need 90 overall: 35 earned, need 90 total, so 55 of the remaining 50 → 110%. Not feasible.
    const r = requiredForCourse(course, 90);
    expect(r.feasible).toBe(false);
    expect(r.requiredAverage).toBeCloseTo(110, 8);
    expect(r.maxAchievable).toBeCloseTo(85, 8);
  });

  it('is feasible when the target sits inside the achievable range', () => {
    const course = makeCourse({
      assessments: [graded('midterm', 50, 70), upcoming('final-exam', 50)],
    });

    const r = requiredForCourse(course, 80);
    expect(r.feasible).toBe(true);
    expect(r.requiredAverage).toBeCloseTo(90, 8);
  });

  it('reports 0 required when the target is already locked in', () => {
    const course = makeCourse({
      assessments: [graded('midterm', 50, 95), upcoming('final-exam', 50)],
    });

    const r = requiredForCourse(course, 40);
    expect(r.feasible).toBe(true);
    expect(r.requiredAverage).toBe(0);
  });

  it('is not feasible once nothing remains and the target was missed', () => {
    const course = makeCourse({ assessments: [graded('final-exam', 100, 65)] });

    const r = requiredForCourse(course, 80);
    expect(r.feasible).toBe(false);
    expect(r.requiredAverage).toBeNull();
    expect(r.message).toMatch(/no remaining/i);
  });

  it('uses neutral, factual wording with no coaching', () => {
    const course = makeCourse({
      assessments: [graded('midterm', 50, 70), upcoming('final-exam', 50)],
    });

    const message = requiredForCourse(course, 80).message;
    expect(message).not.toMatch(/you should|try|keep it up|don't worry|great/i);
  });
});

describe('requiredAcrossCourses', () => {
  it('reports per-course requirements for a target term average', () => {
    const a = makeCourse({
      code: 'CS 240',
      assessments: [graded('midterm', 50, 70), upcoming('final-exam', 50)],
    });
    const b = makeCourse({
      code: 'CS 241',
      assessments: [graded('midterm', 50, 80), upcoming('final-exam', 50)],
    });

    const r = requiredAcrossCourses([a, b], 80);

    expect(r.feasible).toBe(true);
    expect(r.perCourse).toHaveLength(2);
    expect(r.perCourse.every((p) => p.requiredAverage != null)).toBe(true);
  });

  it('flags infeasible when even every ceiling cannot reach the target', () => {
    const a = makeCourse({ assessments: [graded('final-exam', 100, 50)] });
    const b = makeCourse({ assessments: [graded('final-exam', 100, 55)] });

    const r = requiredAcrossCourses([a, b], 90);

    expect(r.feasible).toBe(false);
    expect(r.message).toMatch(/not reachable|cannot/i);
  });

  it('reports one headline figure for the average needed on all remaining work (A9)', () => {
    // Two courses, each 0.5 credits, each 50% graded at 70, targeting an 80 term average.
    // Floor is 35 per course => term floor 35; each has 50% remaining at 0.5 credits.
    // Needed lift in credit-weighted points: (80 - 35) * 1.0 = 45, over capacity 0.5*50*2 = 50
    // => 90% on everything left.
    const a = makeCourse({
      assessments: [graded('midterm', 50, 70), upcoming('final-exam', 50)],
    });
    const b = makeCourse({
      assessments: [graded('midterm', 50, 70), upcoming('final-exam', 50)],
    });

    const r = requiredAcrossCourses([a, b], 80);

    expect(r.requiredAverageOnRemaining).toBeCloseTo(90, 6);
    // The headline must agree with the per-course breakdown, or the screen contradicts itself.
    for (const p of r.perCourse) {
      expect(p.requiredAverage).toBeCloseTo(90, 6);
    }
  });

  it('has no headline figure when nothing is outstanding', () => {
    const done = makeCourse({ assessments: [graded('final-exam', 100, 75)] });

    expect(requiredAcrossCourses([done], 80).requiredAverageOnRemaining).toBeNull();
  });

  it('quotes the headline figure in its message, so the copy is self-contained', () => {
    const a = makeCourse({
      assessments: [graded('midterm', 50, 70), upcoming('final-exam', 50)],
    });

    // The old copy said "requires the per-course averages listed" while the dashboard listed
    // nothing. A message must not reference something the caller may not render.
    const r = requiredAcrossCourses([a], 80);
    expect(r.message).toMatch(/90/);
    expect(r.message).not.toMatch(/listed/);
  });

  it('ignores CR/NCR courses, which are not in the average', () => {
    const numeric = makeCourse({
      assessments: [graded('midterm', 50, 70), upcoming('final-exam', 50)],
    });
    const crncr = makeCourse({ gradeBasis: CR_NCR, assessments: [upcoming('final-exam', 100)] });

    const r = requiredAcrossCourses([numeric, crncr], 80);

    expect(r.perCourse.map((p) => p.courseId)).toEqual([numeric.id]);
  });
});

describe('groupAssessments', () => {
  it('collapses repeated categories into one row', () => {
    const items = groupAssessments([
      graded('quiz-1', 5, 90, 'Quiz'),
      graded('quiz-2', 5, 80, 'Quiz'),
      graded('quiz-3', 5, 70, 'Quiz'),
      graded('final-exam', 85, 75, 'Final Exam'),
    ]);

    const group = items.find((i) => i.isGroup);
    expect(group).toBeDefined();
    expect(group!.isGroup && group!.children).toHaveLength(3);
    expect(group!.isGroup && group!.weight).toBeCloseTo(15, 8);
  });

  it('leaves a lone item ungrouped', () => {
    const items = groupAssessments([
      graded('midterm', 30, 80, 'Midterm'),
      graded('final-exam', 70, 75, 'Final Exam'),
    ]);

    expect(items.every((i) => !i.isGroup)).toBe(true);
    expect(items).toHaveLength(2);
  });

  it('omits soft-removed assessments', () => {
    const items = groupAssessments([
      graded('quiz-1', 5, 90, 'Quiz'),
      { ...graded('quiz-2', 5, 80, 'Quiz'), isRemoved: true },
      { ...graded('quiz-3', 5, 70, 'Quiz'), isRemoved: true },
    ]);

    // Only one quiz survives, so it should not be presented as a group.
    expect(items).toHaveLength(1);
    expect(items[0].isGroup).toBe(false);
  });

  it('preserves order by orderIndex', () => {
    const items = groupAssessments([
      graded('final-exam', 70, 75, 'Final Exam'),
      graded('midterm', 30, 80, 'Midterm'),
    ]);

    // final-exam was created first, so it has the lower orderIndex.
    expect(items[0].isGroup === false && items[0].assessment.slug).toBe('final-exam');
  });

  it('gives every item a stable id usable as a React key', () => {
    const items = groupAssessments([
      graded('quiz-1', 5, 90, 'Quiz'),
      graded('quiz-2', 5, 80, 'Quiz'),
    ]);

    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('group:Quiz');
  });
});
