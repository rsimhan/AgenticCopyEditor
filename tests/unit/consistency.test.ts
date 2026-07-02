import { describe, it, expect } from 'vitest';
import {
  tableRangeStyleConsistency,
  decimalPlacesConsistency,
  type CellText,
  type PercentOccurrence,
} from '../../src/pipeline/consistency.js';

function cell(cellId: number, text: string): CellText {
  return { chunkId: 1, cellId, text };
}

describe('B.2 table_range_style_consistency', () => {
  it('converts all hyphen ranges to "to" when any range is negative', () => {
    const out = tableRangeStyleConsistency([cell(1, '2.2-4.8'), cell(2, '-3.4-1.1')]);
    expect(out).toHaveLength(2);
    const proposals = out.map((s) => s.proposedText).sort();
    expect(proposals).toEqual(['-3.4 to 1.1', '2.2 to 4.8']);
    expect(out.every((s) => s.ruleId === 'table_range_style_consistency')).toBe(true);
  });

  it('leaves an all-positive table alone', () => {
    expect(tableRangeStyleConsistency([cell(1, '2.2-4.8'), cell(2, '1.0-3.0')])).toHaveLength(0);
  });

  it('does not re-flag ranges already using "to"', () => {
    const out = tableRangeStyleConsistency([cell(1, '-3.4-1.1'), cell(2, '2.2 to 4.8')]);
    expect(out).toHaveLength(1);
    expect(out[0]?.proposedText).toBe('-3.4 to 1.1');
    expect(out[0]?.cellId).toBe(1);
  });
});

describe('B.2 decimal_places_consistency', () => {
  const occ = (raw: string, id: number): PercentOccurrence => ({
    chunkId: 1,
    span: { start: 0, end: raw.length },
    rawValueString: raw,
    cellId: id,
  });

  it('flags the minority precision among fractional percentages', () => {
    const out = decimalPlacesConsistency([occ('24.8%', 1), occ('24.9%', 2), occ('24.85%', 3)]);
    expect(out).toHaveLength(1);
    expect(out[0]?.originalText).toBe('24.85%');
    expect(out[0]?.kind).toBe('author_query');
  });

  it('ignores whole-number percentages (they take no trailing zero)', () => {
    // 25% is whole (0 dp) and allowed to coexist; only 24.8% is fractional → no inconsistency.
    expect(decimalPlacesConsistency([occ('25%', 1), occ('24.8%', 2)])).toHaveLength(0);
  });

  it('passes when all fractional percentages share precision', () => {
    expect(decimalPlacesConsistency([occ('24.8%', 1), occ('25.1%', 2)])).toHaveLength(0);
  });
});
