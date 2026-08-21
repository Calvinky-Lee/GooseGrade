/**
 * UW term codes — specs/07 §3.
 *
 * v1 hardcoded 1261 (Winter 2026). The term is now a parameter, and the date is passed in
 * rather than read from the clock so the job is deterministic and testable.
 */

const SEASONS: Record<string, { code: string; month: number }> = {
  Winter: { code: '1', month: 1 },
  Spring: { code: '5', month: 5 },
  Fall: { code: '9', month: 9 },
};

/** "Winter 2026" -> "1261". UW encodes 1 + last two digits of year + season month. */
export function encodeTerm(label: string): string {
  const [season, year] = label.trim().split(/\s+/);
  const s = SEASONS[season];
  if (!s || !/^\d{4}$/.test(year ?? '')) {
    throw new Error(`Unrecognised term label "${label}". Expected e.g. "Winter 2026".`);
  }
  return `1${year.slice(2)}${s.code}`;
}

/** "1261" -> "Winter 2026". Mirrors v1's decodeTerm. */
export function decodeTerm(code: string): string {
  if (!/^\d{4}$/.test(code)) throw new Error(`Unrecognised term code "${code}".`);
  const year = 2000 + Number(code.slice(1, 3));
  const month = Number(code.slice(3));
  const season = Object.entries(SEASONS).find(([, s]) => Number(s.code) === month)?.[0];
  if (!season) throw new Error(`Unrecognised season digit in "${code}".`);
  return `${season} ${year}`;
}

/** The UW term a date falls in. Date is an argument so the job stays deterministic. */
export function termForDate(date: Date): string {
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  if (month <= 4) return `Winter ${year}`;
  if (month <= 8) return `Spring ${year}`;
  return `Fall ${year}`;
}

/** Accepts either form, so --term works with "1261" or "Winter 2026". */
export function normalizeTermArg(value: string): string {
  return /^\d{4}$/.test(value.trim()) ? decodeTerm(value.trim()) : value.trim();
}
