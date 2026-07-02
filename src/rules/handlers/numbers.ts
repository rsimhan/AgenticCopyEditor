/**
 * Deterministic number/decimal/currency rules (SPEC §5C).
 * Each handler is a pure function pair (detect/resolve) over a bounded RuleContext.
 */
import type { RuleHandler, Candidate, RuleContext, Resolution } from '../registry.js';
import { regexCandidates, textBefore } from '../detect-util.js';

/** Insert grouping commas every three digits from the right. */
function groupThousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * thousands_separator — integers > 9999 take grouping commas (36127 → 36,127); 6500 unchanged.
 * Matches standalone runs of 5+ digits not adjacent to a word char, dot, or comma (so decimals
 * like 12345.6 and identifiers are left alone). Auto-applicable.
 */
export const thousandsSeparator: RuleHandler = {
  ruleId: 'thousands_separator',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: true,
  detect: (ctx) => regexCandidates(ctx.text, /(?<![\w.,])\d{5,}(?![\w.,])/),
  resolve: (c): Resolution => {
    const proposed = groupThousands(c.matched);
    return proposed === c.matched ? { kind: 'noop' } : { kind: 'edit', proposed };
  },
};

/**
 * whole_number_percent — strip trailing .0 from whole-number percentages (25.0% → 25%). Auto.
 */
export const wholeNumberPercent: RuleHandler = {
  ruleId: 'whole_number_percent',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: true,
  detect: (ctx) => regexCandidates(ctx.text, /\d+\.0+%/),
  resolve: (c): Resolution => ({
    kind: 'edit',
    proposed: c.matched.replace(/\.0+%$/, '%'),
  }),
};

const PRECEDING_STAT_MARKER = /(?:\bP|\balpha|\bbeta|[Pαβ])\s*[=<>≤≥]?\s*$/;

/**
 * leading_zero — values < 1 take a leading zero (.7 → 0.7), EXCEPT P/α/β values. Context-sensitive,
 * so NOT auto-applicable: it posts pending. The exception is enforced in resolve by inspecting the
 * preceding text.
 */
export const leadingZero: RuleHandler = {
  ruleId: 'leading_zero',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: false,
  detect: (ctx) => regexCandidates(ctx.text, /(?<![\w.])\.\d+/),
  resolve: (c: Candidate, ctx: RuleContext): Resolution => {
    if (PRECEDING_STAT_MARKER.test(textBefore(ctx, c))) return { kind: 'noop' }; // P/α/β keep no zero
    return { kind: 'edit', proposed: `0${c.matched}` };
  },
};

/**
 * no_leading_zero_stats — strip the leading zero from P/α/β values (P=0.03 → P=.03). Deterministic
 * but context-scoped to the P/α/β marker; posts pending.
 */
export const noLeadingZeroStats: RuleHandler = {
  ruleId: 'no_leading_zero_stats',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: false,
  detect: (ctx) => regexCandidates(ctx.text, /[Pαβ]\s*[=<>≤≥]\s*0\.\d+/),
  resolve: (c): Resolution => ({
    kind: 'edit',
    proposed: c.matched.replace(/0(\.\d+)$/, '$1'),
  }),
};

/**
 * currency_us_format — space between a country abbreviation and the currency symbol (US$99 → US $99).
 * Posts pending (spacing near currency can be sensitive). Trailing-zero stripping is a separate case.
 */
export const currencyUsFormat: RuleHandler = {
  ruleId: 'currency_us_format',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: false,
  detect: (ctx) => regexCandidates(ctx.text, /\b(?:US|CAD|Aus)\$\d[\d.,]*/),
  resolve: (c): Resolution => ({
    kind: 'edit',
    proposed: c.matched.replace('$', ' $'),
  }),
};
