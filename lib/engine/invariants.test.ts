import { describe, expect, it, beforeEach } from 'vitest';

import {
  checkInvariants,
  checkPassingNotReportedAsFail,
  isClean,
  plainWeightedSum,
} from './invariants';
import { graded, makeCourse, resetIds, rule, upcoming, withStatus } from './testing';
import type {
  BestNOfMRule,
  BonusRule,
  CapRule,
  CourseResult,
  PassGateRule,
} from '@/lib/types';

beforeEach(resetIds);

describe('checkInvariants — clean courses', () => {
  it('passes a plain weighted-sum course', () => {
    const course = makeCourse({
      assessments: [graded('midterm', 40, 70), upcoming('final-exam', 60)],
    });

    expect(checkInvariants(course)).toEqual([]);
  });

  it('passes a course with every rule type engaged', () => {
    const course = makeCourse({
      assessments: [
        graded('quiz-1', 5, 90, 'Quiz'),
        graded('quiz-2', 5, 40, 'Quiz'),
        graded('quiz-3', 5, 80, 'Quiz'),
        withStatus('assignment-1', 10, 'missed', null, 'Assignment'),
        graded('midterm', 25, 65, 'Midterm'),
        upcoming('final-exam', 50, 'Final Exam'),
        graded('bonus-task', 3, 100),
      ],
      gradingRules: [
        rule<BestNOfMRule>({ type: 'bestNofM', group: { category: 'Quiz' }, take: 2 }),
        rule<BonusRule>({ type: 'bonus', slug: 'bonus-task' }),
        rule<CapRule>({ type: 'cap', capAt: 100 }),
        rule<PassGateRule>({
          type: 'passGate',
          target: { slug: 'final-exam' },
          min: 50,
          coursePassMark: 50,
        }),
      ],
    });

    expect(isClean(checkInvariants(course))).toBe(true);
  });

  it('passes a course where nothing is graded yet', () => {
    const course = makeCourse({
      assessments: [upcoming('midterm', 40), upcoming('final-exam', 60)],
    });

    expect(checkInvariants(course)).toEqual([]);
  });
});

describe('checkInvariants — catches real defects', () => {
  it('flags a rule referencing a slug from another course', () => {
    // The legacy multi-tenant bug in a new costume: one course's rules touching another's.
    const course = makeCourse({
      code: 'CS 240',
      assessments: [graded('final-exam', 100, 80)],
      gradingRules: [
        rule<BonusRule>({ type: 'bonus', slug: 'math239-bonus' }),
      ],
    });

    const found = checkInvariants(course);

    expect(found.some((v) => v.invariant === 'cross_course_slug_reference')).toBe(true);
    expect(found.find((v) => v.invariant === 'cross_course_slug_reference')!.detail).toMatchObject({
      slug: 'math239-bonus',
      courseCode: 'CS 240',
    });
  });

  it('flags a "failed" status that no enabled gate rule justifies', () => {
    // Called directly with a fabricated result, because the engine correctly refuses to
    // produce this state — which is exactly why the invariant needs its own test. If a future
    // refactor ever *did* produce it, this is the assertion that catches it.
    const course = makeCourse({ assessments: [graded('final-exam', 100, 80)] });
    const fabricated: CourseResult = {
      currentGrade: 80,
      projectedGrade: 80,
      completedWeight: 100,
      remainingWeight: 0,
      floor: 80,
      ceiling: 80,
      passGateStatus: 'failed',
      appliedRules: [],
      warnings: [],
    };

    const found = checkPassingNotReportedAsFail(course, fabricated);

    expect(found).toHaveLength(1);
    expect(found[0].invariant).toBe('passing_average_reported_as_fail');
    expect(found[0].severity).toBe('violation');
  });

  it('flags a "failed" status where the average is null, hiding it from the UI', () => {
    const course = makeCourse({
      assessments: [graded('final-exam', 100, 80)],
      gradingRules: [
        rule<PassGateRule>({
          type: 'passGate',
          target: { slug: 'final-exam' },
          min: 50,
          coursePassMark: 50,
        }),
      ],
    });
    const noAverage: CourseResult = {
      currentGrade: null,
      projectedGrade: null,
      completedWeight: 0,
      remainingWeight: 100,
      floor: 0,
      ceiling: 100,
      passGateStatus: 'failed',
      appliedRules: [],
      warnings: [],
    };

    // A gate can only be shown *alongside* a number. "FAIL" with no number is the display the
    // correctness rule exists to forbid.
    expect(checkPassingNotReportedAsFail(course, noAverage)).toHaveLength(1);
  });

  it('accepts a disabled gate producing no status at all', () => {
    const withDisabledGate = makeCourse({
      assessments: [graded('coursework', 50, 90), graded('final-exam', 50, 10)],
      gradingRules: [
        rule<PassGateRule>({
          type: 'passGate',
          target: { slug: 'final-exam' },
          min: 50,
          coursePassMark: 50,
          enabled: false,
        }),
      ],
    });

    expect(checkInvariants(withDisabledGate)).toEqual([]);
  });
});

describe('plainWeightedSum — the independent reference', () => {
  it('matches the engine when no rules are present', () => {
    const course = makeCourse({
      assessments: [
        graded('a', 25, 80),
        graded('b', 25, 60),
        withStatus('c', 25, 'missed'),
        withStatus('d', 25, 'excused'),
      ],
    });

    // 20 + 15 + 0 earned over 75 completed weight.
    expect(plainWeightedSum(course)).toBeCloseTo((35 / 75) * 100, 8);
  });

  it('returns null when nothing is graded, matching amendment A2', () => {
    expect(plainWeightedSum(makeCourse({ assessments: [upcoming('a', 100)] }))).toBeNull();
  });
});
