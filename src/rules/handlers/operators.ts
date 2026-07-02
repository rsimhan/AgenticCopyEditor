/**
 * Deterministic equality/inequality-operator rules (SPEC §5C).
 */
import type { RuleHandler, Resolution } from '../registry.js';
import { regexCandidates } from '../detect-util.js';

/**
 * no_space_operators — remove spaces around = < > ≤ ≥ in running prose (P < .001 → P<.001).
 * NOT auto-applicable: §6 requires spaces around operators *inside equations*, and a regex cannot
 * reliably tell prose from an equation, so this posts pending for review. To limit equation
 * false-positives, it only fires when the right-hand side is numeric (equations usually have a
 * variable on the right), preceded by an alphanumeric/closing token.
 */
export const noSpaceOperators: RuleHandler = {
  ruleId: 'no_space_operators',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: false,
  detect: (ctx) => regexCandidates(ctx.text, /(?<=[A-Za-z0-9)\]]) [=<>≤≥] (?=[<>]?[-–−]?\.?\d)/),
  resolve: (c): Resolution => ({ kind: 'edit', proposed: c.matched.trim() }),
};

/**
 * gte_lte_symbols — use ≥ / ≤ rather than ASCII >= / <=. Posts pending.
 */
export const gteLteSymbols: RuleHandler = {
  ruleId: 'gte_lte_symbols',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: false,
  detect: (ctx) => regexCandidates(ctx.text, />=|<=/),
  resolve: (c): Resolution => ({
    kind: 'edit',
    proposed: c.matched === '>=' ? '≥' : '≤',
  }),
};
