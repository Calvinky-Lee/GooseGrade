import { describe, expect, it } from 'vitest';

import {
  harvestCourseCodes,
  inferTerm,
  normalizeCode,
  termForDate,
} from './parseSchedule';
import { SAMPLE_QUEST_PASTE } from './__mocks__/data';

describe('harvestCourseCodes', () => {
  it('extracts every course from a realistic Quest paste', () => {
    const codes = harvestCourseCodes(SAMPLE_QUEST_PASTE).map((c) => c.code);

    expect(codes).toContain('CS 240');
    expect(codes).toContain('MATH 239');
    expect(codes).toContain('STAT 230'); // written "STAT230" with no space
    expect(codes).toContain('CS 241');
    expect(codes).toContain('PD 11');
    expect(codes).toContain('MUSIC 140');
  });

  it('does not emit rooms, components, or class numbers as courses', () => {
    const codes = harvestCourseCodes(SAMPLE_QUEST_PASTE).map((c) => c.code);

    // These all match the code shape and would otherwise fill the review screen with noise.
    expect(codes.some((c) => c.startsWith('LEC'))).toBe(false);
    expect(codes.some((c) => c.startsWith('MC'))).toBe(false);
    expect(codes.some((c) => c.startsWith('RCH'))).toBe(false);
    expect(codes.some((c) => c.startsWith('DC'))).toBe(false);
    expect(codes.some((c) => c.startsWith('AL'))).toBe(false);
  });

  it('collapses a course listed twice into one candidate', () => {
    const paste = `
      CS 341 - Algorithms
        1111  LEC 001  Lecture   MWF 9:30AM
        1112  TUT 101  Tutorial  T 3:30PM
      CS 341 - Algorithms (tutorial)
    `;

    expect(harvestCourseCodes(paste)).toHaveLength(1);
  });

  it('captures a section hint from the same line', () => {
    const candidates = harvestCourseCodes('CS 240 LEC 002 Lecture MWF');

    expect(candidates[0]).toEqual({ code: 'CS 240', sectionHint: '002' });
  });

  it('normalizes a missing space', () => {
    expect(harvestCourseCodes('cs240 and math239').map((c) => c.code)).toEqual([
      'CS 240',
      'MATH 239',
    ]);
  });

  it('handles a course number with a trailing letter', () => {
    expect(harvestCourseCodes('BIOL 130L').map((c) => c.code)).toEqual(['BIOL 130L']);
  });

  it('returns nothing for text with no courses, rather than throwing', () => {
    expect(harvestCourseCodes('hello there, no courses here')).toEqual([]);
    expect(harvestCourseCodes('')).toEqual([]);
  });

  it('preserves the order courses appeared in', () => {
    const codes = harvestCourseCodes('MATH 239\nCS 240\nSTAT 230').map((c) => c.code);
    expect(codes).toEqual(['MATH 239', 'CS 240', 'STAT 230']);
  });
});

describe('inferTerm', () => {
  it('reads a term label out of the paste', () => {
    expect(inferTerm(SAMPLE_QUEST_PASTE)).toBe('Spring 2026');
  });

  it('maps Summer onto UW’s Spring term', () => {
    // Students and Quest both sometimes say "Summer"; UW calls May-August "Spring".
    expect(inferTerm('Summer 2026 class schedule')).toBe('Spring 2026');
  });

  it('is case-insensitive', () => {
    expect(inferTerm('FALL 2025')).toBe('Fall 2025');
  });

  it('returns null when there is no term to find', () => {
    expect(inferTerm('CS 240 - Data Structures')).toBeNull();
  });
});

describe('termForDate', () => {
  it('maps months onto UW terms', () => {
    expect(termForDate(new Date('2026-02-15T00:00:00Z'))).toBe('Winter 2026');
    expect(termForDate(new Date('2026-06-15T00:00:00Z'))).toBe('Spring 2026');
    expect(termForDate(new Date('2026-10-15T00:00:00Z'))).toBe('Fall 2026');
  });

  it('places the term boundaries correctly', () => {
    expect(termForDate(new Date('2026-04-30T00:00:00Z'))).toBe('Winter 2026');
    expect(termForDate(new Date('2026-05-01T00:00:00Z'))).toBe('Spring 2026');
    expect(termForDate(new Date('2026-08-31T00:00:00Z'))).toBe('Spring 2026');
    expect(termForDate(new Date('2026-09-01T00:00:00Z'))).toBe('Fall 2026');
  });
});

describe('normalizeCode', () => {
  it('inserts the missing space', () => {
    expect(normalizeCode('cs240')).toBe('CS 240');
    expect(normalizeCode('MATH239')).toBe('MATH 239');
  });

  it('collapses extra whitespace', () => {
    expect(normalizeCode('  cs   240  ')).toBe('CS 240');
  });

  it('passes through anything that is not code-shaped', () => {
    expect(normalizeCode('data structures')).toBe('DATA STRUCTURES');
  });
});
