/**
 * Numeric parsing helpers for extraction + reconciliation.
 * Handles leading-decimal (.03), and negative signs written as hyphen, en dash (–), or the Unicode
 * minus (−) — all of which appear in the guidelines.
 */

/** Parse a reported numeric string to a number, or undefined if not parseable. */
export function parseNumber(raw: string): number | undefined {
  let s = raw.trim();
  // Normalize a leading hyphen / en dash / minus sign to ASCII '-'.
  s = s.replace(/^[-–−]/, '-');
  if (s.startsWith('.')) s = `0${s}`;
  if (s.startsWith('-.')) s = `-0${s.slice(1)}`;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Count digits after the decimal point in a reported value (25.0 → 1, 25 → 0, .03 → 2). */
export function decimalPlaces(raw: string): number {
  const m = raw.match(/\.(\d+)/);
  return m ? m[1]!.length : 0;
}

/** Round to `dp` decimal places (half-up), avoiding binary-float surprises. */
export function roundTo(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}
