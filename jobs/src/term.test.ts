import { describe, expect, it } from 'vitest';

import { decodeTerm, encodeTerm, normalizeTermArg, termForDate } from './term';

describe('term codes', () => {
  it('encodes the term v1 had hardcoded', () => {
    // v1 hardcoded 1261; this is the value it stood for.
    expect(encodeTerm('Winter 2026')).toBe('1261');
  });

  it('round-trips every season', () => {
    for (const label of ['Winter 2026', 'Spring 2026', 'Fall 2026', 'Fall 2031']) {
      expect(decodeTerm(encodeTerm(label))).toBe(label);
    }
  });

  it('rejects nonsense rather than guessing', () => {
    expect(() => encodeTerm('Summer 2026')).toThrow(/Unrecognised term/);
    expect(() => encodeTerm('Winter')).toThrow(/Unrecognised term/);
    expect(() => decodeTerm('abc')).toThrow(/Unrecognised term/);
  });

  it('maps dates onto UW terms at the boundaries', () => {
    expect(termForDate(new Date('2026-04-30T00:00:00Z'))).toBe('Winter 2026');
    expect(termForDate(new Date('2026-05-01T00:00:00Z'))).toBe('Spring 2026');
    expect(termForDate(new Date('2026-08-31T00:00:00Z'))).toBe('Spring 2026');
    expect(termForDate(new Date('2026-09-01T00:00:00Z'))).toBe('Fall 2026');
  });

  it('accepts either form on the command line', () => {
    expect(normalizeTermArg('1261')).toBe('Winter 2026');
    expect(normalizeTermArg('Winter 2026')).toBe('Winter 2026');
  });
});
