import { describe, it, expect } from 'vitest';
import { extractStatistics } from '../../src/pipeline/extract.js';
import { deriveLogicalKey } from '../../src/pipeline/logical-key.js';
import { runCrossLocation } from '../../src/pipeline/reconcile.js';
import type { StatExtraction } from '../../src/domain/stats.js';
import type { LocationContext } from '../../src/domain/types.js';

/**
 * End-to-end (deterministic, no DB): extract → assign a heuristic logical_key → reconcile across
 * locations. This is the SPEC §9 M3 headline test: a deliberate abstract-vs-table mismatch yields
 * exactly one cross_reference_mismatch; the consistent variant yields none.
 */
function keyedPercentages(
  chunkId: number,
  loc: LocationContext,
  text: string,
  label: string,
): StatExtraction[] {
  const key = deriveLogicalKey(label);
  return extractStatistics({ chunkId, text, locationContext: loc })
    .filter((s) => s.statType === 'percentage')
    .map((s) => ({ ...s, ...(key ? { logicalKey: key } : {}) }));
}

describe('manuscript reconciliation (E2E)', () => {
  it('flags a mortality value that disagrees between abstract and table', () => {
    const stats = [
      ...keyedPercentages(1, 'abstract', 'Overall mortality was 25%.', 'Overall mortality'),
      ...keyedPercentages(2, 'table_cell', '26%', 'Overall mortality'),
    ];
    const flags = runCrossLocation(stats);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.ruleId).toBe('cross_reference_mismatch');
  });

  it('does not flag a consistent manuscript', () => {
    const stats = [
      ...keyedPercentages(1, 'abstract', 'Overall mortality was 25%.', 'Overall mortality'),
      ...keyedPercentages(2, 'table_cell', '25%', 'Overall mortality'),
    ];
    expect(runCrossLocation(stats)).toHaveLength(0);
  });
});
