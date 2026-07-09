/**
 * Deterministic mechanical house-style rules (SPEC §1 extended scope, §5C).
 * The purely mechanical subset of JMIR House Style — no prose judgment.
 */
import type { RuleHandler, Resolution } from '../registry.js';
import { regexCandidates, isInsideParentheses } from '../detect-util.js';

/**
 * trademark_symbol_removal — remove ™ ® ℠ (and a wrongly used ©) after names. Auto-applicable.
 * The edit deletes the symbol (proposed is an empty string); the "capitalize the initial letter"
 * nuance is left to reasoning tiers where the term boundary is known.
 */
export const trademarkSymbolRemoval: RuleHandler = {
  ruleId: 'trademark_symbol_removal',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: true,
  detect: (ctx) => regexCandidates(ctx.text, /[™®℠]/),
  resolve: (): Resolution => ({ kind: 'edit', proposed: '' }),
};

/**
 * latin_abbrev_comma — inside parentheses, ie/eg take a comma and no periods (i.e. → ie,).
 * Context-sensitive (running-text usage should be reworded to "that is"/"for example"), so this
 * only acts inside parentheses and posts pending; outside parentheses it defers (noop).
 */
export const latinAbbrevComma: RuleHandler = {
  ruleId: 'latin_abbrev_comma',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: false,
  detect: (ctx) => regexCandidates(ctx.text, /\b(?:i\.e\.|e\.g\.|ie\.|eg\.)/i),
  resolve: (c, ctx): Resolution => {
    if (!isInsideParentheses(ctx, c)) return { kind: 'noop' };
    const isIe = /^i/i.test(c.matched);
    return { kind: 'edit', proposed: isIe ? 'ie,' : 'eg,' };
  },
};

/**
 * abbrev_no_dots — drop the periods from abbreviations JMIR sets closed-up (et al., Inc., Corp.,
 * etc., vs., U.S., U.S.A., U.K. → et al, Inc, Corp, etc, vs, US, USA, UK). ie/eg are intentionally
 * left to `latin_abbrev_comma` (which also adds the comma). NOT auto-applicable: a trailing "et al."
 * or "etc." can double as the sentence-final period, so a human confirms. (House-rules curation
 * 2026-07-03, note 19.)
 */
export const abbrevNoDots: RuleHandler = {
  ruleId: 'abbrev_no_dots',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: false,
  detect: (ctx) =>
    regexCandidates(ctx.text, /\bet al\.|\b(?:Inc|Corp|etc|vs)\.|\bU\.S\.A\.|\bU\.S\.|\bU\.K\./),
  resolve: (c): Resolution => ({ kind: 'edit', proposed: c.matched.replace(/\./g, '') }),
};

/**
 * range_hyphen — a numeric range takes a tight hyphen (curation note 10). Normalizes an en/em dash
 * or a spaced hyphen BETWEEN two digits to `-` (2825–2836 → 2825-2836; 5 - 7 → 5-7). A plain tight
 * hyphen (10-19) is already correct and not flagged. Requires a digit on the LEFT, so a leading
 * minus/en-dash on a negative value isn't a match — negative ranges keep "to" (negative_range_to).
 * Posts pending.
 */
export const rangeHyphen: RuleHandler = {
  ruleId: 'range_hyphen',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: false,
  detect: (ctx) => regexCandidates(ctx.text, /(?<=\d)(?:\s*[–—]\s*|\s+-\s+)(?=\d)/),
  resolve: (): Resolution => ({ kind: 'edit', proposed: '-' }),
};

/**
 * ellipsis_three_periods — replace the Word ellipsis character with three periods. Auto.
 */
export const ellipsisThreePeriods: RuleHandler = {
  ruleId: 'ellipsis_three_periods',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: true,
  detect: (ctx) => regexCandidates(ctx.text, /…/),
  resolve: (): Resolution => ({ kind: 'edit', proposed: '...' }),
};

/** Preserve the leading capital of a replaced word. */
function matchCase(source: string, replacement: string): string {
  return /^[A-Z]/.test(source)
    ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
    : replacement;
}

/**
 * term_toward — use "toward", not "towards". Auto. Case of the leading letter is preserved.
 */
export const termToward: RuleHandler = {
  ruleId: 'term_toward',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: true,
  detect: (ctx) => regexCandidates(ctx.text, /\btowards\b/i),
  resolve: (c): Resolution => ({ kind: 'edit', proposed: matchCase(c.matched, 'toward') }),
};

/**
 * term_xhealth — use eHealth/mHealth/eSource (not e-health, m-health, e-Health, …). Auto.
 */
export const termXhealth: RuleHandler = {
  ruleId: 'term_xhealth',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: true,
  detect: (ctx) => regexCandidates(ctx.text, /\b([emEM])-(health|source)\b/i),
  resolve: (c): Resolution => {
    const prefix = c.matched.charAt(0).toLowerCase(); // e or m
    const rest = c.matched.slice(2); // after "e-"
    const word = rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase(); // Health / Source
    return { kind: 'edit', proposed: `${prefix}${word}` };
  },
};
