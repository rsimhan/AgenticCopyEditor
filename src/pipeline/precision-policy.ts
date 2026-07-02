/**
 * Default per-stat-type precision policies, mirroring the `stat_precision_policy` seed (migration
 * 0006). Kept in code so reconciliation unit tests stay DB-free; an integration test asserts this
 * matches the DB so the two cannot drift.
 */
import type { PrecisionPolicy } from '../tools/math.js';
import type { StatType } from '../domain/types.js';

export const DEFAULT_PRECISION_POLICIES: Readonly<Record<StatType, PrecisionPolicy>> =
  Object.freeze({
    p_value: {
      statType: 'p_value',
      decimalPlaces: 2,
      keepFirstSigDigit: false,
      stripTrailingZero: false,
    },
    mean: {
      statType: 'mean',
      decimalPlaces: null,
      keepFirstSigDigit: false,
      stripTrailingZero: false,
    },
    mean_difference: {
      statType: 'mean_difference',
      decimalPlaces: null,
      keepFirstSigDigit: false,
      stripTrailingZero: false,
    },
    percentage: {
      statType: 'percentage',
      decimalPlaces: null,
      keepFirstSigDigit: false,
      stripTrailingZero: true,
    },
    proportion: {
      statType: 'proportion',
      decimalPlaces: null,
      keepFirstSigDigit: false,
      stripTrailingZero: false,
    },
    ci_bound: {
      statType: 'ci_bound',
      decimalPlaces: null,
      keepFirstSigDigit: false,
      stripTrailingZero: false,
    },
    sample_size: {
      statType: 'sample_size',
      decimalPlaces: 0,
      keepFirstSigDigit: false,
      stripTrailingZero: false,
    },
    test_statistic: {
      statType: 'test_statistic',
      decimalPlaces: null,
      keepFirstSigDigit: true,
      stripTrailingZero: false,
    },
    other: {
      statType: 'other',
      decimalPlaces: null,
      keepFirstSigDigit: false,
      stripTrailingZero: false,
    },
  });

export function policyFor(statType: StatType): PrecisionPolicy {
  return DEFAULT_PRECISION_POLICIES[statType];
}
