/**
 * Deterministic unit-formatting rules (SPEC §5C). Scoped to temperature for v1 (general unit
 * spacing like 5kg→5 kg is deferred — it has more false-positive surface).
 */
import type { RuleHandler, Resolution } from '../registry.js';
import { regexCandidates } from '../detect-util.js';

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
