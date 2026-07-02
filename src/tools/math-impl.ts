/**
 * Concrete deterministic math checks (SPEC §5 B.1a). Uses per-stat-type precision so reconciliation
 * does not raise false mismatches (e.g. 25% vs 24.8% at 0 dp are within tolerance).
 */
import type { MathChecks, PrecisionPolicy } from './math.js';
import { roundTo } from '../pipeline/numeric.js';

/**
 * Tolerance rule (SPEC §5 B.1): exact for whole numbers; otherwise |a-b| <= 0.5 * 10^-dp where dp
 * is the effective decimal precision. When the policy pins decimal_places we use it; otherwise the
 * caller supplies the lower reported precision of the two values.
 */
export function valuesAgreeAtDp(a: number, b: number, dp: number): boolean {
  const tolerance = 0.5 * 10 ** -dp;
  // Add a tiny epsilon so a difference exactly at the tolerance boundary counts as agreement.
  return Math.abs(a - b) <= tolerance + 1e-9;
}

export class StandardMathChecks implements MathChecks {
  proportionMatchesPercentage(
    n: number,
    N: number,
    statedPercentage: number,
    policy: PrecisionPolicy,
    statedDp = 0,
  ): boolean {
    if (N === 0) return false;
    const computed = (n / N) * 100;
    const dp = policy.decimalPlaces ?? statedDp;
    return roundTo(computed, dp) === roundTo(statedPercentage, dp);
  }

  ciOrdered(lower: number, point: number, upper: number): boolean {
    return lower <= point && point <= upper;
  }

  valuesAgree(a: number, b: number, policy: PrecisionPolicy, reportedDp = 0): boolean {
    const dp = policy.decimalPlaces ?? reportedDp;
    return valuesAgreeAtDp(a, b, dp);
  }
}
