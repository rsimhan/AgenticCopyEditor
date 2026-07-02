import { describe, it, expect } from 'vitest';
import {
  runDerivedChecks,
  checkProportionPercentages,
  checkCiOrdering,
  runCrossLocation,
} from '../../src/pipeline/reconcile.js';
import type { StatExtraction } from '../../src/domain/stats.js';

describe('B.1a derived checks — proportion ↔ percentage', () => {
  it('passes when n/N equals the stated percentage', () => {
    expect(checkProportionPercentages(1, 'the majority (150/200, 75%) responded')).toHaveLength(0);
    expect(checkProportionPercentages(1, '50/200=25%')).toHaveLength(0);
    expect(checkProportionPercentages(1, '50/200 (25.0%)')).toHaveLength(0); // rounds equal
  });

  it('emits a deterministic edit correcting a wrong percentage', () => {
    const [s] = checkProportionPercentages(1, 'a total of 50/200 (30%) were positive');
    expect(s?.kind).toBe('edit');
    expect(s?.originTier).toBe('deterministic');
    expect(s?.ruleId).toBe('derived_value_check');
    expect(s?.proposedText).toBe('50/200 (25%)');
  });
});

describe('B.1a derived checks — CI ordering', () => {
  it('passes an ordered interval (including negative bounds)', () => {
    expect(checkCiOrdering(1, '3.1 (95% CI 2.2-4.8)')).toHaveLength(0);
    expect(checkCiOrdering(1, '-1.2 (95% CI -3.4 to 1.1)')).toHaveLength(0);
  });

  it('flags an out-of-order interval as an author query', () => {
    const [s] = checkCiOrdering(1, '3.1 (95% CI 4.2-4.8)');
    expect(s?.kind).toBe('author_query');
    expect(s?.originTier).toBe('deterministic');
    expect(s?.proposedText).toBeUndefined();
  });

  it('runDerivedChecks combines both check families', () => {
    const out = runDerivedChecks(1, '50/200 (30%); 3.1 (95% CI 4.2-4.8)');
    expect(out).toHaveLength(2);
  });
});

// ---- B.1b cross-location agreement ----

function pct(loc: StatExtraction['locationContext'], raw: string, value: number): StatExtraction {
  return {
    chunkId: 1,
    locationContext: loc,
    statType: 'percentage',
    logicalKey: 'mortality',
    rawValueString: raw,
    numericPrimary: value,
    span: { start: 0, end: raw.length },
  };
}

describe('B.1b cross-location agreement (SPEC §5 B.1b)', () => {
  it('produces exactly one flag for an abstract-vs-table mismatch', () => {
    const out = runCrossLocation([pct('abstract', '25%', 25), pct('table_cell', '26%', 26)]);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe('cross_reference_mismatch');
    expect(out[0]?.kind).toBe('author_query');
    expect(out[0]?.originTier).toBe('base_inference'); // fuzzy → never deterministic authority
  });

  it('produces no flag for a consistent manuscript', () => {
    const out = runCrossLocation([
      pct('abstract', '25%', 25),
      pct('body_prose', '25%', 25),
      pct('table_cell', '25%', 25),
    ]);
    expect(out).toHaveLength(0);
  });

  it('does NOT false-alarm on rounding (25% vs 24.8% at 0 dp)', () => {
    const out = runCrossLocation([pct('abstract', '25%', 25), pct('table_cell', '24.8%', 24.8)]);
    expect(out).toHaveLength(0);
  });

  it('does not compare across different stat types under one key', () => {
    const proportion: StatExtraction = {
      chunkId: 1,
      locationContext: 'body_prose',
      statType: 'proportion',
      logicalKey: 'mortality',
      rawValueString: '50/200',
      numericPrimary: 50,
      span: { start: 0, end: 6 },
    };
    // 50 (count) must not be compared against 25 (percentage) → no false mismatch.
    const out = runCrossLocation([proportion, pct('abstract', '25%', 25)]);
    expect(out).toHaveLength(0);
  });
});
