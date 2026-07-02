/**
 * Deterministic percentage-formatting rules (SPEC §5C).
 */
import type { RuleHandler, Resolution } from '../registry.js';
import { regexCandidates } from '../detect-util.js';

/**
 * percent_no_space — remove the space before a percent sign (18 % → 18%). Auto-applicable.
 */
export const percentNoSpace: RuleHandler = {
  ruleId: 'percent_no_space',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: true,
  detect: (ctx) => regexCandidates(ctx.text, /\d[\d.,]*\s+%/),
  resolve: (c): Resolution => ({ kind: 'edit', proposed: c.matched.replace(/\s+%$/, '%') }),
};

/**
 * percent_repeat_range — repeat the percent sign across a range (15-20% → 15%-20%). Auto-applicable.
 * Requires the first value to lack its own `%` (so 15%-20% is not re-flagged).
 */
export const percentRepeatRange: RuleHandler = {
  ruleId: 'percent_repeat_range',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: true,
  detect: (ctx) => regexCandidates(ctx.text, /(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%/),
  resolve: (c): Resolution => ({
    kind: 'edit',
    proposed: c.matched.replace(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%$/, '$1%-$2%'),
  }),
};
