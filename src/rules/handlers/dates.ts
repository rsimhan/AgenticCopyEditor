/**
 * Deterministic US date formatting (House-rules curation 2026-07-03, notes 22 + 23/24 merged).
 * Target house style: month spelled out, `Month D, YYYY` (e.g. `March 3, 2026`) — no leading zero
 * on the day. Handles three unambiguous shapes and normalizes them:
 *   - day-first textual:   `3 March 2026`, `3rd Mar 2026`   → `March 3, 2026`
 *   - month-first textual: `Mar. 3 2026`, `March 03, 2026`  → `March 3, 2026`
 *   - ISO numeric:         `2026-03-03`                     → `March 3, 2026`
 * Purely-numeric slash dates (`7/3/2026`) are intentionally NOT handled — month/day order is
 * locale-ambiguous, so they belong to the reasoning tier. Posts pending (dates warrant a human check).
 */
import type { RuleHandler, Candidate, Resolution } from '../registry.js';
import { regexCandidates } from '../detect-util.js';

const FULL: Record<string, string> = {
  jan: 'January',
  feb: 'February',
  mar: 'March',
  apr: 'April',
  may: 'May',
  jun: 'June',
  jul: 'July',
  aug: 'August',
  sep: 'September',
  oct: 'October',
  nov: 'November',
  dec: 'December',
};
const NUM_TO_KEY = ['', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const MONTH =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun[e]?|Jul[y]?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DAY = String.raw`\d{1,2}(?:st|nd|rd|th)?`;
const DATE_RE = new RegExp(
  // day-first textual | month-first textual | ISO
  String.raw`\b${DAY}\s+${MONTH}\.?\s+\d{4}\b` +
    String.raw`|\b${MONTH}\.?\s+${DAY},?\s+\d{4}\b` +
    String.raw`|\b\d{4}-\d{2}-\d{2}\b`,
);

/** Full month name from a name (full or abbreviated) or a 1–12 number; null if invalid. */
function monthName(token: string): string | null {
  if (/^\d+$/.test(token)) return FULL[NUM_TO_KEY[Number(token)] ?? ''] ?? null;
  return FULL[token.slice(0, 3).toLowerCase()] ?? null;
}

export const dateFormatUs: RuleHandler = {
  ruleId: 'date_format_us',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: false,
  detect: (ctx) => regexCandidates(ctx.text, DATE_RE),
  resolve: (c: Candidate): Resolution => {
    const s = c.matched;
    let month: string | null = null;
    let day: string | undefined;
    let year: string | undefined;
    let m: RegExpExecArray | null;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) {
      year = m[1];
      month = monthName(m[2]!);
      day = String(Number(m[3]));
    } else if ((m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?\s+(\d{4})$/.exec(s))) {
      day = String(Number(m[1]));
      month = monthName(m[2]!);
      year = m[3];
    } else if ((m = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s))) {
      month = monthName(m[1]!);
      day = String(Number(m[2]));
      year = m[3];
    }
    if (!month || !day || !year) return { kind: 'noop' };
    const proposed = `${month} ${day}, ${year}`;
    return proposed === s ? { kind: 'noop' } : { kind: 'edit', proposed };
  },
};
