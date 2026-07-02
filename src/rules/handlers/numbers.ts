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
 *
 * NOT auto-applicable (UAT lesson): the number alone can't distinguish a reported quantity from an
 * identifier/DOI/date/reference (e.g. a manuscript DOI `…/95374`, an 8-digit Medline ID, or 24-digit
 * submission-date metadata). So it posts pending, and guards drop the obvious non-quantities:
 *   - the `:` and `/` exclusions keep it out of URLs/DOIs/ratios/times;
 *   - runs longer than 7 digits are almost always IDs/dates/garbage, not reported values.
 */
export const thousandsSeparator: RuleHandler = {
  ruleId: 'thousands_separator',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: false,
  detect: (ctx) => regexCandidates(ctx.text, /(?<![\w.,:/])\d{5,}(?![\w.,:/])/),
  resolve: (c): Resolution => {
    if (c.matched.length > 7) return { kind: 'noop' }; // ID / date / concatenated metadata
    const proposed = groupThousands(c.matched);
    return proposed === c.matched ? { kind: 'noop' } : { kind: 'edit', proposed };
  },
};

/**
 * thousands_strip — remove grouping commas from integers ≤ 9999 (1,076 → 1076); JMIR reserves commas
 * for values > 9999. The mirror of thousands_separator. Deterministic; posts pending (conservative
 * until proven on real data).
 */
export const thousandsStrip: RuleHandler = {
  ruleId: 'thousands_strip',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: false,
  detect: (ctx) => regexCandidates(ctx.text, /(?<![\w.])\d{1,3}(?:,\d{3})+(?![\w.])/),
  resolve: (c): Resolution => {
    const digits = c.matched.replace(/,/g, '');
    if (Number(digits) > 9999) return { kind: 'noop' }; // >9999 correctly keeps commas
    return { kind: 'edit', proposed: digits };
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
