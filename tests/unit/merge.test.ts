import { describe, it, expect } from 'vitest';
import { mergeChunk, comparePrecedence, type MergeClaim } from '../../src/pipeline/merge.js';

const claim = (
  id: number,
  start: number,
  end: number,
  over: Partial<MergeClaim> = {},
): MergeClaim => ({
  id,
  span: { start, end },
  tier: 'deterministic',
  kind: 'edit',
  ...over,
});

function outcome(outcomes: ReturnType<typeof mergeChunk>, id: number) {
  return outcomes.find((o) => o.id === id);
}

describe('merge & arbitration (Phase E)', () => {
  it('keeps non-overlapping suggestions untouched', () => {
    const out = mergeChunk([claim(1, 0, 5), claim(2, 10, 15, { tier: 'base_inference' })]);
    expect(outcome(out, 1)?.decision).toBe('kept');
    expect(outcome(out, 2)?.decision).toBe('kept');
  });

  it('higher tier wins the overlap; lower tier keeps its non-overlapping remainder (split)', () => {
    // deterministic [10,20) vs base_inference [15,25): overlap [15,20) → det wins; base keeps [20,25).
    const out = mergeChunk([
      claim(1, 10, 20, { tier: 'deterministic' }),
      claim(2, 15, 25, { tier: 'base_inference' }),
    ]);
    expect(outcome(out, 1)).toEqual({ id: 1, decision: 'kept', span: { start: 10, end: 20 } });
    expect(outcome(out, 2)).toEqual({
      id: 2,
      decision: 'split',
      survivingSpans: [{ start: 20, end: 25 }],
    });
  });

  it('supersedes a lower-tier suggestion fully covered by a higher tier', () => {
    const out = mergeChunk([
      claim(1, 10, 30, { tier: 'deterministic' }),
      claim(2, 15, 25, { tier: 'base_inference' }),
    ]);
    expect(outcome(out, 2)?.decision).toBe('superseded');
  });

  it('breaks equal-tier ties by confidence, superseding the loser', () => {
    const out = mergeChunk([
      claim(1, 10, 20, { tier: 'base_inference', confidence: 0.7 }),
      claim(2, 10, 20, { tier: 'base_inference', confidence: 0.9 }),
    ]);
    expect(outcome(out, 2)?.decision).toBe('kept'); // higher confidence wins
    expect(outcome(out, 1)?.decision).toBe('superseded');
  });

  it('breaks equal confidence ties by earlier createdAt', () => {
    const out = mergeChunk([
      claim(1, 10, 20, { tier: 'base_inference', createdAt: 200 }),
      claim(2, 10, 20, { tier: 'base_inference', createdAt: 100 }),
    ]);
    expect(outcome(out, 2)?.decision).toBe('kept'); // earlier wins
    expect(outcome(out, 1)?.decision).toBe('superseded');
  });

  it('passes author_query claims through without competing for spans', () => {
    const out = mergeChunk([
      claim(1, 10, 20, { tier: 'deterministic' }),
      claim(2, 12, 18, { kind: 'author_query', tier: 'base_inference' }),
    ]);
    expect(outcome(out, 1)?.decision).toBe('kept');
    expect(outcome(out, 2)?.decision).toBe('passthrough');
  });

  it('produces a non-overlapping ownership map (no lost or duplicated characters)', () => {
    const out = mergeChunk([
      claim(1, 0, 10, { tier: 'deterministic' }),
      claim(2, 5, 20, { tier: 'base_inference' }),
      claim(3, 18, 30, { tier: 'verified_memory' }),
    ]);
    // Collect owned spans from kept + split outcomes; assert they tile without overlap.
    const owned: Array<{ start: number; end: number }> = [];
    for (const o of out) {
      if (o.decision === 'kept') owned.push(o.span);
      else if (o.decision === 'split') owned.push(...o.survivingSpans);
    }
    owned.sort((a, b) => a.start - b.start);
    for (let i = 1; i < owned.length; i++) {
      expect(owned[i]!.start).toBeGreaterThanOrEqual(owned[i - 1]!.end);
    }
  });

  it('orders precedence: tier, then confidence, then createdAt', () => {
    expect(
      comparePrecedence(
        claim(1, 0, 1, { tier: 'deterministic' }),
        claim(2, 0, 1, { tier: 'base_inference' }),
      ),
    ).toBeLessThan(0);
  });
});
