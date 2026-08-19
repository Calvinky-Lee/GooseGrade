import { describe, expect, it } from 'vitest';

import { sectionFromUrl, termDate } from './discover';

describe('sectionFromUrl', () => {
  it('prefers a component code from the title', () => {
    expect(sectionFromUrl('/view/CS/240/x', 'CS 240 LEC 002')).toBe('002');
    expect(sectionFromUrl('/view/PD/11/x', 'PD 11 ONLINE 001')).toBe('001');
  });

  it('falls back to a three-digit path segment', () => {
    expect(sectionFromUrl('/view/CS/240/001/98765')).toBe('001');
  });

  it('returns null rather than guessing when there is no section', () => {
    // A null section is meaningful — the unique key allows it, and inventing "001" would
    // collide two genuinely different offerings.
    expect(sectionFromUrl('/view/CS/240')).toBeNull();
  });

  it('does not mistake a catalog number for a section', () => {
    // "240" is three digits and sits in the path, so ordering matters: the title is checked
    // first, and the path fallback would otherwise return the course number.
    expect(sectionFromUrl('/view/CS/240/003/1', 'CS 240 LEC 003')).toBe('003');
  });
});

describe('termDate', () => {
  it('maps each term onto its first day, for ordering', () => {
    expect(termDate('Winter 2026')).toBe('2026-01-01');
    expect(termDate('Spring 2026')).toBe('2026-05-01');
    expect(termDate('Fall 2026')).toBe('2026-09-01');
  });
});
