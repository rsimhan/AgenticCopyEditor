/**
 * Deterministic time-format rule (JMIR house style: 12-hour clock with AM/PM; noon/midnight).
 */
import type { RuleHandler, Resolution } from '../registry.js';
import { regexCandidates } from '../detect-util.js';

/**
 * time_12hour — convert a 24-hour time to the 12-hour clock in the expert's house format
 * (curation note 7): `08:00 → 8 AM`, `14:00 → 2 PM`, `13:30 → 1:30 PM`, `00:00`/`24:00 → midnight`,
 * `12:00 → noon`. The `:00` is dropped on the hour ("8 AM", not "8:00 AM"); non-zero minutes are
 * kept. A time is treated as 24-hour when it has a leading-zero hour (`08:00`), an hour ≥ 13, or is
 * 10–12 / 24:00 — so a bare single-digit `9:00` (which reads as a 12-hour time) is left alone.
 * Posts pending.
 */
export const time12Hour: RuleHandler = {
  ruleId: 'time_12hour',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: false,
  detect: (ctx) => regexCandidates(ctx.text, /\b(?:0\d|1\d|2[0-3]):[0-5]\d\b|\b24:00\b/),
  resolve: (c): Resolution => {
    const [hh, mm] = c.matched.split(':') as [string, string];
    const h = Number(hh);
    if ((h === 0 || h === 24) && mm === '00') return { kind: 'edit', proposed: 'midnight' };
    if (h === 12 && mm === '00') return { kind: 'edit', proposed: 'noon' };
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const clock = mm === '00' ? `${h12}` : `${h12}:${mm}`;
    return { kind: 'edit', proposed: `${clock} ${period}` };
  },
};
