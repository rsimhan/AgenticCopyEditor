/**
 * Deterministic math / derived-relationship checks (tool, not an agent).
 * Used by the Reconciliation agent (Phase B.1a) for genuinely deterministic checks that need no
 * fuzzy cross-location matching. Per-stat-type rounding comes from `stat_precision_policy`
 * (SPEC §4/§9) so comparisons don't raise false mismatches. Implemented in Milestone 3.
 */

export interface PrecisionPolicy {
  statType: string;
  decimalPlaces: number | null;
  keepFirstSigDigit: boolean;
  stripTrailingZero: boolean;
}

export interface MathChecks {
  /** Does n/N, rounded per policy, equal the stated percentage? */
  proportionMatchesPercentage(
    n: number,
    N: number,
    statedPercentage: number,
    policy: PrecisionPolicy,
  ): boolean;

  /** lower <= point <= upper for a confidence interval. */
  ciOrdered(lower: number, point: number, upper: number): boolean;

  /** Are two reported values equal within the per-stat-type tolerance? */
  valuesAgree(a: number, b: number, policy: PrecisionPolicy): boolean;
}
