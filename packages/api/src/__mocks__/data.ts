/**
 * Mock fixtures — specs/04 §0, specs/06 preamble.
 *
 * These are deliberately reverse-engineered from `specs/visuals/dashboard-mockup.html` so that
 * running `NEXT_PUBLIC_API_MODE=mock` renders the canonical design with its real numbers:
 * a 79.9% term average over 2.0 credits, CS 240 at 78.4% with 62% graded, STAT 230 at risk
 * behind a pass gate, PD 11 excluded as CR/NCR.
 *
 * `data.test.ts` asserts the engine actually produces those figures, so the fixture cannot
 * drift away from the design it is meant to represent.
 */

import type { Assessment, Course, GradingRule, Term } from '@goosegrade/types';

let n = 0;
const id = (prefix: string) => `${prefix}-${(n += 1)}`;

function item(
  slug: string,
  name: string,
  weight: number,
  category: Assessment['category'],
  grade: number | null,
  orderIndex: number,
): Assessment {
  return {
    id: id('ua'),
    slug,
    name,
    category,
    assessmentType: category ?? 'Other',
    weight,
    orderIndex,
    grade,
    status: grade == null ? 'upcoming' : 'graded',
    isCustom: false,
    isRemoved: false,
  };
}

/** Five assignments sharing a weight, the shape the scraper's prompt produces. */
function assignments(count: number, each: number, grades: Array<number | null>): Assessment[] {
  return Array.from({ length: count }, (_, i) =>
    item(
      `assignment-${i + 1}`,
      `Assignment ${i + 1}`,
      each,
      'Assignment',
      grades[i] ?? null,
      i + 1,
    ),
  );
}

function quizzes(count: number, each: number, grades: Array<number | null>): Assessment[] {
  return Array.from({ length: count }, (_, i) =>
    item(`quiz-${i + 1}`, `Quiz ${i + 1}`, each, 'Quiz', grades[i] ?? null, 20 + i),
  );
}

// ---------------------------------------------------------------------------
// CS 240 — 78.4%, 62% graded, target 80
// ---------------------------------------------------------------------------
const cs240: Course = {
  id: 'course-cs240',
  catalogCourseId: 'cat-cs240',
  code: 'CS 240',
  name: 'Data Structures & Data Management',
  section: '001',
  creditWeight: 0.5,
  gradeBasis: 'numeric',
  rulesOverridden: false,
  targetGrade: 80,
  gradingRules: [
    {
      id: 'rule-cs240-best',
      type: 'bestNofM',
      enabled: true,
      source: 'scraped',
      description: 'Best 4 of 5 quizzes count',
      group: { category: 'Quiz' },
      take: 4,
    },
  ],
  assessments: [
    ...assignments(5, 6, [88, 92, 79, 84, 82]),
    ...quizzes(5, 3, [80, 85, 72, 83, 70]),
    item('midterm', 'Midterm', 20, 'Midterm', 67.5, 40),
    item('final-exam', 'Final Exam', 35, 'Final Exam', null, 50),
  ],
};

// ---------------------------------------------------------------------------
// MATH 239 — 84.1%, 55% graded
// ---------------------------------------------------------------------------
const math239: Course = {
  id: 'course-math239',
  catalogCourseId: 'cat-math239',
  code: 'MATH 239',
  name: 'Introduction to Combinatorics',
  section: '001',
  creditWeight: 0.5,
  gradeBasis: 'numeric',
  rulesOverridden: false,
  targetGrade: 85,
  gradingRules: [],
  assessments: [
    ...assignments(6, 5, [90, 86, 88, 80, 92, 92]),
    item('midterm', 'Midterm', 25, 'Midterm', 79.4, 40),
    item('final-exam', 'Final Exam', 45, 'Final Exam', null, 50),
  ],
};

// ---------------------------------------------------------------------------
// STAT 230 — 69.2%, at risk behind a pass gate on the final
// ---------------------------------------------------------------------------
const stat230: Course = {
  id: 'course-stat230',
  catalogCourseId: 'cat-stat230',
  code: 'STAT 230',
  name: 'Probability',
  section: '003',
  creditWeight: 0.5,
  gradeBasis: 'numeric',
  rulesOverridden: false,
  targetGrade: null,
  gradingRules: [
    {
      id: 'rule-stat230-gate',
      type: 'passGate',
      enabled: true,
      source: 'scraped',
      description: 'You must score at least 50% on the final exam to pass the course',
      target: { slug: 'final-exam' },
      min: 50,
      coursePassMark: 50,
    },
  ],
  assessments: [
    ...assignments(4, 5, [72, 65, 70, 73]),
    item('midterm', 'Midterm', 28, 'Midterm', 68.6, 40),
    item('final-exam', 'Final Exam', 52, 'Final Exam', null, 50),
  ],
};

// ---------------------------------------------------------------------------
// CS 241 — 88.0%, ahead of an 85 target
// ---------------------------------------------------------------------------
const cs241: Course = {
  id: 'course-cs241',
  catalogCourseId: 'cat-cs241',
  code: 'CS 241',
  name: 'Foundations of Sequential Programs',
  section: '002',
  creditWeight: 0.5,
  gradeBasis: 'numeric',
  rulesOverridden: false,
  targetGrade: 85,
  gradingRules: [
    {
      id: 'rule-cs241-maxof',
      type: 'maxOf',
      enabled: true,
      source: 'scraped',
      description: 'The final counts 30%, or 45% if that improves your grade',
      variants: [
        [
          { slug: 'midterm', weight: 15 },
          { slug: 'final-exam', weight: 45 },
        ],
      ],
    },
  ],
  assessments: [
    ...assignments(5, 8, [88, 84, 86, 82, 85]),
    item('midterm', 'Midterm', 30, 'Midterm', 92, 40),
    item('final-exam', 'Final Exam', 30, 'Final Exam', null, 50),
  ],
};

// ---------------------------------------------------------------------------
// PD 11 — CR/NCR, excluded from every average
// ---------------------------------------------------------------------------
const pd11: Course = {
  id: 'course-pd11',
  catalogCourseId: 'cat-pd11',
  code: 'PD 11',
  name: 'Processes for Project Management',
  section: null,
  creditWeight: 0.5,
  gradeBasis: 'cr_ncr',
  rulesOverridden: false,
  targetGrade: null,
  gradingRules: [],
  assessments: [
    item('reflection-1', 'Reflection 1', 50, 'Participation', 100, 1),
    item('final-report', 'Final Report', 50, 'Project', null, 2),
  ],
};

export const CURRENT_TERM: Term = {
  id: 'term-s26',
  termLabel: 'Spring 2026',
  termDate: '2026-05-01',
  isCurrent: true,
  courses: [cs240, math239, stat230, cs241, pd11],
};

/** A completed prior term, so the cumulative average and its delta have something to work on. */
export const PAST_TERM: Term = {
  id: 'term-w26',
  termLabel: 'Winter 2026',
  termDate: '2026-01-01',
  isCurrent: false,
  courses: [
    {
      id: 'course-cs245',
      catalogCourseId: 'cat-cs245',
      code: 'CS 245',
      name: 'Logic and Computation',
      section: '001',
      creditWeight: 0.5,
      gradeBasis: 'numeric',
      rulesOverridden: false,
      targetGrade: null,
      gradingRules: [],
      assessments: [item('final-exam', 'Final Exam', 100, 'Final Exam', 72, 1)],
    },
    {
      id: 'course-math237',
      catalogCourseId: 'cat-math237',
      code: 'MATH 237',
      name: 'Calculus 3',
      section: '002',
      creditWeight: 0.5,
      gradeBasis: 'numeric',
      rulesOverridden: false,
      targetGrade: null,
      gradingRules: [],
      assessments: [item('final-exam', 'Final Exam', 100, 'Final Exam', 73, 1)],
    },
  ],
};

export const CATALOG: Array<{
  id: string;
  code: string;
  name: string;
  term: string;
  section: string | null;
  creditWeight: number;
  schemeConfidence: 'unconfirmed' | 'review' | 'verified';
}> = [
  { id: 'cat-cs240', code: 'CS 240', name: 'Data Structures & Data Management', term: 'Spring 2026', section: '001', creditWeight: 0.5, schemeConfidence: 'verified' },
  { id: 'cat-cs240-2', code: 'CS 240', name: 'Data Structures & Data Management', term: 'Spring 2026', section: '002', creditWeight: 0.5, schemeConfidence: 'verified' },
  { id: 'cat-cs241', code: 'CS 241', name: 'Foundations of Sequential Programs', term: 'Spring 2026', section: '002', creditWeight: 0.5, schemeConfidence: 'verified' },
  { id: 'cat-cs245', code: 'CS 245', name: 'Logic and Computation', term: 'Spring 2026', section: '001', creditWeight: 0.5, schemeConfidence: 'unconfirmed' },
  { id: 'cat-math239', code: 'MATH 239', name: 'Introduction to Combinatorics', term: 'Spring 2026', section: '001', creditWeight: 0.5, schemeConfidence: 'review' },
  { id: 'cat-stat230', code: 'STAT 230', name: 'Probability', term: 'Spring 2026', section: '003', creditWeight: 0.5, schemeConfidence: 'verified' },
  { id: 'cat-pd11', code: 'PD 11', name: 'Processes for Project Management', term: 'Spring 2026', section: null, creditWeight: 0.5, schemeConfidence: 'unconfirmed' },
];

export const PROFILE = {
  id: 'user-1',
  email: 'student@uwaterloo.ca',
  displayName: 'Sample Student',
  faculty: 'Mathematics',
  program: 'Computer Science',
  currentLevel: '2B',
  settings: { contributeDistributions: false, theme: 'light' as const },
};

/**
 * A realistic Quest paste, for exercising the intake flow.
 *
 * Deliberately messy — headers, times, rooms, an unmatched course — because the parser must
 * cope with whatever a student actually copies, and the point of the design is that it
 * harvests code-shaped tokens rather than parsing this layout.
 */
export const SAMPLE_QUEST_PASTE = `
Spring 2026 | Undergraduate | University of Waterloo

CS 240 - Data Structures & Data Management
  Class Nbr  Section  Component  Days & Times           Room
  1234       LEC 001  Lecture    MWF 10:30AM - 11:20AM  MC 4021

MATH 239 - Introduction to Combinatorics
  2345       LEC 001  Lecture    TTh 1:00PM - 2:20PM    MC 4045

STAT230 - Probability
  3456       LEC 003  Lecture    MWF 9:30AM - 10:20AM   RCH 101

CS 241 - Foundations of Sequential Programs
  4567       LEC 002  Lecture    TTh 11:30AM - 12:50PM  DC 1350

PD 11 - Processes for Project Management
  5678       ONLINE   Online     TBA                    TBA

MUSIC 140 - Rock and Roll
  6789       LEC 001  Lecture    W 7:00PM - 9:50PM      AL 116
`;
