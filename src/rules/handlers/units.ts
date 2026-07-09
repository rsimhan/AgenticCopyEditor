/**
 * Deterministic unit-formatting rules (SPEC §5C). Scoped to temperature for v1 (general unit
 * spacing like 5kg→5 kg is deferred — it has more false-positive surface).
 */
import type { RuleHandler, Resolution } from '../registry.js';
import { regexCandidates, isInsideParentheses } from '../detect-util.js';

/**
 * temperature_celsius_spacing — space between the numeral and the degree unit (37.5°C → 37.5 °C).
 * Auto-applicable. (Fahrenheit→Celsius conversion is a separate, non-deterministic concern.)
 */
export const temperatureCelsiusSpacing: RuleHandler = {
  ruleId: 'temperature_celsius_spacing',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: true,
  detect: (ctx) => regexCandidates(ctx.text, /\d[\d.,]*°[CF]/),
  resolve: (c): Resolution => ({
    kind: 'edit',
    proposed: c.matched.replace(/°/, ' °'),
  }),
};

/**
 * time_unit_format — inside parentheses, a time unit written out after a number is abbreviated
 * (30 minutes → 30 min; 2 hours → 2 h; 45 seconds → 45 s). Curation note 25 ("h, min, s in
 * parenthesis"). The number-adjacency requirement keeps it off non-durations ("(over several
 * hours)"). In running text the full word is correct, so this is a noop there — the risky reverse
 * direction (expanding a bare "h"/"s" in prose) is left to the reasoning tier. Posts pending.
 */
export const timeUnitFormat: RuleHandler = {
  ruleId: 'time_unit_format',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: false,
  detect: (ctx) => regexCandidates(ctx.text, /(?<=\d\s?)(?:hours?|minutes?|seconds?)\b/i),
  resolve: (c, ctx): Resolution => {
    if (!isInsideParentheses(ctx, c)) return { kind: 'noop' }; // running text keeps the full word
    const w = c.matched.toLowerCase();
    const abbr = w.startsWith('h') ? 'h' : w.startsWith('m') ? 'min' : 's';
    return { kind: 'edit', proposed: abbr };
  },
};
