/**
 * Deterministic time-format rule (JMIR house style: 12-hour clock with AM/PM; noon/midnight).
 */
import type { RuleHandler, Resolution } from '../registry.js';
import { regexCandidates } from '../detect-util.js';

/**
 * time_12hour — convert an UNAMBIGUOUS 24-hour time to the 12-hour clock. Only hours that can't be
 * mistaken for a 12-hour time are handled: 00 (midnight/AM), 12 (noon/PM), and 13–23 (PM). Hours
 * 1–11 without an AM/PM marker are ambiguous, so they're left alone. Posts pending.
 */
export const time12Hour: RuleHandler = {
  ruleId: 'time_12hour',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: false,
  detect: (ctx) => regexCandidates(ctx.text, /\b(00|12|1[3-9]|2[0-3]):([0-5]\d)\b/),
  resolve: (c): Resolution => {
    const [hh, mm] = c.matched.split(':') as [string, string];
    const h = Number(hh);
    if (h === 0 && mm === '00') return { kind: 'edit', proposed: 'midnight' };
    if (h === 12 && mm === '00') return { kind: 'edit', proposed: 'noon' };
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return { kind: 'edit', proposed: `${h12}:${mm} ${period}` };
  },
};
