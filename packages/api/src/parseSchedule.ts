/**
 * Paste-your-schedule intake — design decision D2, amendment A2b.
 *
 * THIS DOES NOT PARSE QUEST'S LAYOUT. Parsing another system's copy-paste format is brittle
 * and fails in a way that ruins a first impression. Instead it harvests anything shaped like a
 * course code and hands the candidates to the caller, which validates every one against
 * `catalog_courses`. The catalog is the validator; unrecognized tokens are dropped silently.
 *
 * Worst case this degrades to search-first. There is no dead end.
 */

/** `CS 240`, `CS240`, `MATH 239`, `STAT230`, `PD 11`, `CO 250`, `BIOL 130L`. */
const COURSE_CODE = /\b([A-Z]{2,6})\s?(\d{2,3}[A-Z]?)\b/g;

/** "Spring 2026", "Fall 2025", "Winter 2026" — including the Summer alias for Spring. */
const TERM_LABEL = /\b(Winter|Spring|Summer|Fall)\s+(\d{4})\b/i;

/**
 * Tokens that match the code shape but are never courses.
 *
 * Without this, a Quest paste yields candidates like "LEC 001" and "MC 4021" on every single
 * line. They would all fail the catalog lookup and be dropped, so this is about not showing
 * the student a review screen full of obvious noise.
 */
const NOT_A_COURSE = new Set([
  'LEC',
  'TUT',
  'LAB',
  'SEM',
  'TST',
  'ONLINE',
  'PRJ',
  'RDG',
  'WSP',
  'CLN',
  'ESL',
  'FLD',
  'STU',
  'MC',
  'DC',
  'RCH',
  'AL',
  'PAS',
  'HH',
  'E7',
  'E5',
  'QNC',
  'STC',
  'PHY',
  'B1',
  'B2',
  'M3',
  'EIT',
  'EV1',
  'EV2',
  'EV3',
  'OPT',
  'TBA',
  'AM',
  'PM',
  'MWF',
  'TTH',
]);

export interface CodeCandidate {
  /** Normalized: always `SUBJECT NUMBER` with exactly one space. */
  code: string;
  /** A section number that appeared on the same line, if any — used to pre-select a section. */
  sectionHint: string | null;
}

/** `LEC 001`, `ONLINE 002`, or a bare `001` sitting in a component column. */
const SECTION_HINT = /\b(?:LEC|TUT|LAB|SEM|ONLINE)\s+(\d{3})\b/i;

/**
 * Harvest course-code candidates from arbitrary pasted text.
 *
 * Order is preserved and duplicates are collapsed, so a schedule that lists a course twice
 * (lecture plus tutorial) yields one candidate.
 */
export function harvestCourseCodes(pastedText: string): CodeCandidate[] {
  const found = new Map<string, CodeCandidate>();

  for (const line of pastedText.split(/\r?\n/)) {
    const upper = line.toUpperCase();
    const sectionMatch = SECTION_HINT.exec(line);
    const sectionHint = sectionMatch ? sectionMatch[1] : null;

    COURSE_CODE.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = COURSE_CODE.exec(upper)) !== null) {
      const [, subject, number] = match;
      if (NOT_A_COURSE.has(subject)) continue;

      // A room number like "MC 4021" is 4 digits; course numbers are 2-3 plus an optional
      // letter. The regex already bounds this, but a 4-digit class number can slip through
      // when it abuts a subject-like token, so re-check the digit count explicitly.
      if (number.replace(/[A-Z]$/, '').length > 3) continue;

      const code = `${subject} ${number}`;
      if (!found.has(code)) {
        found.set(code, { code, sectionHint });
      } else if (sectionHint && !found.get(code)!.sectionHint) {
        found.get(code)!.sectionHint = sectionHint;
      }
    }
  }

  return [...found.values()];
}

/** Pull a term label out of the paste, so the student does not have to restate it. */
export function inferTerm(pastedText: string): string | null {
  const match = TERM_LABEL.exec(pastedText);
  if (!match) return null;

  const season = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
  // UW calls the May–August term "Spring"; Quest and students both sometimes say "Summer".
  return `${season === 'Summer' ? 'Spring' : season} ${match[2]}`;
}

/**
 * The UW term a date falls in, for when the paste carries no term label.
 *
 * Takes the date as an argument rather than calling `new Date()` so it is testable and so the
 * containerized scraper can run deterministically.
 */
export function termForDate(date: Date): string {
  const month = date.getUTCMonth() + 1; // 1-12
  const year = date.getUTCFullYear();

  if (month >= 1 && month <= 4) return `Winter ${year}`;
  if (month >= 5 && month <= 8) return `Spring ${year}`;
  return `Fall ${year}`;
}

/** Normalize a code a student typed into a search box: `math135` → `MATH 135`. */
export function normalizeCode(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, ' ');
  const match = /^([A-Z]{2,6})\s?(\d{2,3}[A-Z]?)$/.exec(cleaned);
  return match ? `${match[1]} ${match[2]}` : cleaned;
}
