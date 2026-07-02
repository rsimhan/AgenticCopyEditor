import { describe, it, expect } from 'vitest';
import { extractStatistics } from '../../src/pipeline/extract.js';
import { sliceByCodepoint } from '../../src/util/offsets.js';
import type { StatType } from '../../src/domain/types.js';

function extract(text: string) {
  const stats = extractStatistics({ chunkId: 1, text, locationContext: 'body_prose' });
  // Every recorded span must round-trip to the raw value (Principle 8).
  for (const s of stats) {
    expect(sliceByCodepoint(text, s.span.start, s.span.end)).toBe(s.rawValueString);
  }
  return stats;
}

function ofType(text: string, t: StatType) {
  return extract(text).filter((s) => s.statType === t);
}

describe('Phase B extraction', () => {
  it('extracts p-values with their numeric value', () => {
    expect(ofType('P=.03', 'p_value')[0]?.numericPrimary).toBe(0.03);
    expect(ofType('p < .001', 'p_value')[0]?.numericPrimary).toBe(0.001);
    expect(ofType('P > .99', 'p_value')[0]?.numericPrimary).toBe(0.99);
  });

  it('extracts percentages but not the 95% CI level', () => {
    expect(ofType('mortality was 25%', 'percentage').map((s) => s.numericPrimary)).toEqual([25]);
    expect(ofType('24.8% of the cohort', 'percentage')[0]?.numericPrimary).toBe(24.8);
    // "95% CI" is a confidence level, not a data percentage.
    expect(ofType('3.1 (95% CI 2.2-4.8)', 'percentage')).toHaveLength(0);
  });

  it('extracts proportions n/N', () => {
    const [p] = ofType('150/200 participants', 'proportion');
    expect(p?.numericPrimary).toBe(150);
    expect(p?.numericSecondary).toBe(200);
  });

  it('extracts sample sizes', () => {
    expect(ofType('n=150', 'sample_size')[0]?.numericPrimary).toBe(150);
    expect(ofType('N = 200', 'sample_size')[0]?.numericPrimary).toBe(200);
  });

  it('extracts CI bounds with negative lower bound', () => {
    const [ci] = ofType('-1.2 (95% CI -3.4 to 1.1) mm Hg', 'ci_bound');
    expect(ci?.numericPrimary).toBe(-3.4);
    expect(ci?.numericSecondary).toBe(1.1);
  });

  it('extracts multiple statistics from one statement', () => {
    const stats = extract('Of 200 participants, 150 (75%) responded (P=.03).');
    const types = new Set(stats.map((s) => s.statType));
    expect(types.has('percentage')).toBe(true);
    expect(types.has('p_value')).toBe(true);
  });
});
