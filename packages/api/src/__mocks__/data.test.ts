import { describe, expect, it } from 'vitest';

import { computeCourse, computeCumulative, computeTermAverage } from '@goosegrade/engine';

import { mockApi } from './index';
import { CURRENT_TERM, PAST_TERM } from './data';

/**
 * These assertions pin the mock fixtures to `specs/visuals/dashboard-mockup.html`.
 *
 * The point is not to test the engine — that is covered in lib/engine. It is to guarantee that
 * `NEXT_PUBLIC_API_MODE=mock` renders the canonical design with the canonical numbers, so a
 * frontend developer building against mocks is looking at the real screen rather than an
 * approximation of it. If someone edits a fixture grade, this fails and tells them the design
 * reference moved.
 */

const byCode = (code: string) => {
  const course = CURRENT_TERM.courses.find((c) => c.code === code);
  if (!course) throw new Error(`fixture missing ${code}`);
  return course;
};

describe('mock fixtures reproduce the dashboard mockup', () => {
  it.each([
    ['CS 240', 78.4, 62],
    ['MATH 239', 84.1, 55],
    ['STAT 230', 69.2, 48],
    ['CS 241', 88.0, 70],
  ])('%s reads %s%% with %s%% graded', (code, expectedGrade, expectedCompleted) => {
    const r = computeCourse(byCode(code));

    expect(r.currentGrade).toBeCloseTo(expectedGrade as number, 1);
    expect(r.completedWeight).toBeCloseTo(expectedCompleted as number, 1);
  });

  it('shows the term average as 79.9% over 2.0 credits', () => {
    const t = computeTermAverage(CURRENT_TERM.courses);

    expect(t.average).toBeCloseTo(79.9, 1);
    expect(t.includedCredits).toBeCloseTo(2.0, 8);
  });

  it('excludes PD 11 as CR/NCR, exactly as the mockup shows', () => {
    const t = computeTermAverage(CURRENT_TERM.courses);

    expect(t.exclusions).toEqual([{ courseId: 'course-pd11', reason: 'cr_ncr' }]);
  });

  it('shows STAT 230 at risk behind its pass gate, without hiding the average', () => {
    const r = computeCourse(byCode('STAT 230'));

    expect(r.passGateStatus).toBe('at_risk');
    // The mockup's caption is "final must reach 50% to pass" — shown ALONGSIDE 69.2%.
    expect(r.currentGrade).not.toBeNull();
  });

  it('shows the cumulative average as 77.4%', () => {
    const cum = computeCumulative([CURRENT_TERM, PAST_TERM]);

    expect(cum.average).toBeCloseTo(77.4, 1);
  });

  it('produces no warnings — every fixture course sums to 100%', () => {
    for (const course of CURRENT_TERM.courses) {
      expect(computeCourse(course).warnings).toEqual([]);
    }
  });
});

describe('fixture rules are exercised, not decorative', () => {
  it('CS 240 actually applies its best-4-of-5 quiz rule', () => {
    const r = computeCourse(byCode('CS 240'));

    expect(r.appliedRules.some((a) => a.type === 'bestNofM')).toBe(true);
  });

  it("CS 241's maxOf correctly does NOT fire, because the alternative is worse", () => {
    // The midterm (92) sits above the assignment average (85), so shifting weight off the
    // midterm would lower the grade. A maxOf rule must never do that — this is the negative
    // case, and it is the one worth having a fixture for.
    const r = computeCourse(byCode('CS 241'));

    expect(r.appliedRules.some((a) => a.type === 'maxOf')).toBe(false);
    expect(r.currentGrade).toBeCloseTo(88.0, 1);
  });
});


describe('the catalog is a template, not somebody\'s marks', () => {
  it('never returns grades from a catalog lookup', async () => {
    // The signed-out course preview renders whatever getCatalogCourse returns. If a mark leaks
    // through, every visitor sees a stranger's grades on a public page.
    const sections = await mockApi.getCatalogCourse('CS 240');

    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(section.assessments.length).toBeGreaterThan(0);
      for (const a of section.assessments) {
        expect(a.grade).toBeNull();
        expect(a.status).toBe('upcoming');
      }
    }
  });

  it('carries the weights and rules that make the preview useful', async () => {
    const [cs240] = await mockApi.getCatalogCourse('CS 240');

    const total = cs240.assessments.reduce((sum, a) => sum + a.weight, 0);
    expect(total).toBeCloseTo(100, 6);
    expect(cs240.gradingRules.length).toBeGreaterThan(0);
  });
});
