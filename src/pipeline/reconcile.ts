/**
 * Phase B.1 — reconciliation (SPEC §5). Two sub-passes with different authority:
 *   B.1a  derived checks (deterministic math within one statement) → 'deterministic' tier.
 *   B.1b  cross-location agreement (fuzzy, grouped by logical_key) → 'base_inference', author_query.
 * Uses per-stat-type precision so it does not raise false mismatches (25% vs 24.8% at 0 dp agree).
 */
import type { StatExtraction } from '../domain/stats.js';
import type { SuggestionDraft } from '../domain/types.js';
import type { PrecisionPolicy } from '../tools/math.js';
import { codeUnitToCodepoint, codepointLength } from '../util/offsets.js';
import { parseNumber, decimalPlaces, roundTo } from './numeric.js';
import { valuesAgreeAtDp } from '../tools/math-impl.js';
import { policyFor } from './precision-policy.js';

const ENGINE = 'reconciler_v1';

// ---------- B.1a: deterministic derived checks ----------

/** Format a computed percentage to the stated value's precision, honoring strip-trailing-zero. */
function formatPercent(value: number, statedDp: number, policy: PrecisionPolicy): string {
  const dp = policy.decimalPlaces ?? statedDp;
  let s = roundTo(value, dp).toFixed(dp);
  if (policy.stripTrailingZero && s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s;
}

/**
 * proportion↔percentage: "n/N (p%)" or "n/N=p%". The percentage is computable from n/N, so a
 * mismatch is emitted as a deterministic EDIT correcting the percentage.
 */
export function checkProportionPercentages(chunkId: number, text: string): SuggestionDraft[] {
  const out: SuggestionDraft[] = [];
  // n/N followed (within a small separator: space, comma, '(', '=') by the stated percentage.
  const re = /(\d+)\s*\/\s*(\d+)\s*[,=(]?\s*(\d+(?:\.\d+)?)\s*%\)?/g;
  const policy = policyFor('percentage');
  for (const m of text.matchAll(re)) {
    const n = parseNumber(m[1]!);
    const N = parseNumber(m[2]!);
    const statedRaw = m[3]!;
    const stated = parseNumber(statedRaw);
    if (n === undefined || N === undefined || stated === undefined || N === 0) continue;
    const statedDp = decimalPlaces(statedRaw);
    const computed = (n / N) * 100;
    if (roundTo(computed, statedDp) === roundTo(stated, statedDp)) continue; // agrees
    const correct = formatPercent(computed, statedDp, policy);
    const start = codeUnitToCodepoint(text, m.index!);
    out.push({
      chunkId,
      ruleId: 'derived_value_check',
      originatorEngine: ENGINE,
      originTier: 'deterministic',
      kind: 'edit',
      span: { start, end: start + codepointLength(m[0]) },
      originalText: m[0],
      proposedText: m[0].replace(/(\d+(?:\.\d+)?)\s*%/, `${correct}%`),
    });
  }
  return out;
}

/**
 * CI ordering: "point (95% CI lo–hi)". A violation (lower>point or point>upper) can't be corrected
 * automatically (which value is wrong is unknown), so it is flagged as an author_query.
 */
export function checkCiOrdering(chunkId: number, text: string): SuggestionDraft[] {
  const out: SuggestionDraft[] = [];
  const re = /(-?[\d.]+)\s*\(\s*95%?\s*CI[:\s]*(-?[\d.–−]+)\s*(?:to|[-–−])\s*(-?[\d.]+)\s*\)/gi;
  for (const m of text.matchAll(re)) {
    const point = parseNumber(m[1]!);
    const lower = parseNumber(m[2]!);
    const upper = parseNumber(m[3]!);
    if (point === undefined || lower === undefined || upper === undefined) continue;
    if (lower <= point && point <= upper) continue; // ordered
    const start = codeUnitToCodepoint(text, m.index!);
    out.push({
      chunkId,
      ruleId: 'derived_value_check',
      originatorEngine: ENGINE,
      originTier: 'deterministic',
      kind: 'author_query',
      span: { start, end: start + codepointLength(m[0]) },
      originalText: m[0],
      queryMessage:
        `Confidence interval is not ordered: point estimate ${point} is not within ` +
        `[${lower}, ${upper}]. Please verify the reported values.`,
    });
  }
  return out;
}

/** Run all B.1a derived checks for one chunk's text. */
export function runDerivedChecks(chunkId: number, text: string): SuggestionDraft[] {
  return [...checkProportionPercentages(chunkId, text), ...checkCiOrdering(chunkId, text)];
}

// ---------- B.1b: fuzzy cross-location agreement ----------

/** Group by (logicalKey, statType) and flag groups whose values disagree beyond tolerance. */
export function runCrossLocation(stats: StatExtraction[]): SuggestionDraft[] {
  const groups = new Map<string, StatExtraction[]>();
  for (const s of stats) {
    if (s.logicalKey === undefined || s.numericPrimary === undefined) continue;
    const key = `${s.logicalKey}::${s.statType}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(s);
  }

  const out: SuggestionDraft[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const values = members.map((m) => m.numericPrimary!);
    const min = Math.min(...values);
    const max = Math.max(...values);
    // Effective precision = the lowest reported precision across the group.
    const dp = Math.min(...members.map((m) => decimalPlaces(m.rawValueString)));
    const policy = policyFor(members[0]!.statType);
    const effectiveDp = policy.decimalPlaces ?? dp;
    if (valuesAgreeAtDp(min, max, effectiveDp)) continue; // agree within tolerance

    const anchor = members[0]!;
    const summary = members
      .map((m) => `${m.locationContext} reports ${m.rawValueString}`)
      .join('; ');
    out.push({
      chunkId: anchor.chunkId,
      ...(anchor.cellId !== undefined ? { cellId: anchor.cellId } : {}),
      ruleId: 'cross_reference_mismatch',
      originatorEngine: ENGINE,
      originTier: 'base_inference',
      kind: 'author_query',
      span: anchor.span,
      originalText: anchor.rawValueString,
      queryMessage: `Inconsistent values across sections — ${summary}. Please reconcile.`,
    });
  }
  return out;
}
