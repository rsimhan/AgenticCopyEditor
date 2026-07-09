/**
 * Deterministic statistical-reporting rules (House-rules curation 2026-07-03).
 */
import type { RuleHandler, Resolution } from '../registry.js';
import { regexCandidates } from '../detect-util.js';

/** Strip a leading zero before the decimal point (0.03 → .03). */
const stripZero = (s: string): string => s.replace(/^0(?=\.)/, '');

/**
 * Canonical value for `P <op> <num>` (op-aware). `<` / `>` thresholds keep their value; `=` values
 * are rounded to 2 dp, EXCEPT the .045–.049 significance band which keeps 3 dp so a significant .047
 * is never rounded up to a nonsignificant-looking .05. P=0 → <.001, P=1 → >.99, and `=` values below
 * .001 / above .99 collapse to the bounds. (Curation note 13.)
 */
function formatP(op: string, numStr: string): string {
  if (op !== '=') return op + stripZero(numStr); // < / > threshold: keep value, drop leading zero
  const v = Number(numStr);
  if (v === 0 || v < 0.001) return '<.001';
  if (v === 1 || v > 0.99) return '>.99';
  const rounded = v >= 0.045 && v < 0.05 ? v.toFixed(3) : v.toFixed(2);
  return '=' + stripZero(rounded);
}

/**
 * p_value_reporting — the comprehensive P-value formatter. Italicizes P and normalizes the value per
 * house style (see formatP). Deterministic; posts pending. Higher confidence than the generic
 * no_leading_zero_stats so the merge engine prefers this fuller edit when both touch a P value.
 */
export const pValueReporting: RuleHandler = {
  ruleId: 'p_value_reporting',
  scope: 'span',
  isDeterministic: true,
  isAutoApplicable: false,
  detect: (ctx) => regexCandidates(ctx.text, /\bP\s*[=<>]\s*(?:0?\.\d+|[01](?!\d))/i),
  resolve: (c): Resolution => {
    const m = /^P\s*([=<>])\s*(.+)$/i.exec(c.matched);
    if (!m) return { kind: 'noop' };
    const proposed = `*P*${formatP(m[1]!, m[2]!.trim())}`;
    return proposed === c.matched ? { kind: 'noop' } : { kind: 'edit', proposed, confidence: 0.9 };
  },
};
