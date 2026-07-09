import { describe, it, expect } from 'vitest';
import {
  resolveChunkAmbiguities,
  makeBudget,
  parseDecision,
} from '../../src/llm/reasoning.js';
import type { LlmClient, LlmResult } from '../../src/llm/client.js';
import { negativeRangeTo } from '../../src/rules/handlers/ranges.js';

/** A stub reasoning client that returns a canned reply — no network (AGENT-ARCH §10). */
function stub(reply: string, onCall?: () => void): LlmClient {
  return {
    model: 'stub-model',
    complete(): Promise<LlmResult> {
      onCall?.();
      return Promise.resolve({ text: reply, model: 'stub-model' });
    },
  };
}

describe('reasoning tier — parseDecision', () => {
  it('tolerates code fences and surrounding prose', () => {
    expect(parseDecision('```json\n{"action":"noop"}\n```')).toEqual({ action: 'noop' });
    expect(parseDecision('Sure — {"action":"edit","proposed":"x"} .')).toEqual({
      action: 'edit',
      proposed: 'x',
    });
  });
  it('rejects non-JSON and invalid decisions', () => {
    expect(parseDecision('no json here')).toBeNull();
    expect(parseDecision('{"action":"bogus"}')).toBeNull(); // enum violation
    expect(parseDecision('{"action":"edit","confidence":5}')).toBeNull(); // out of range
  });
});

describe('reasoning tier — resolveChunkAmbiguities (Phase D)', () => {
  const rangeText = 'The mean change was −3.4-1.1 across groups.';

  it('turns an LLM "edit" decision into a base_inference draft', async () => {
    const client = stub('{"action":"edit","proposed":"−3.4 to 1.1","confidence":0.9}');
    const { drafts, calls } = await resolveChunkAmbiguities(
      { chunkId: 1, text: rangeText },
      [negativeRangeTo],
      client,
      makeBudget(10),
    );
    expect(calls).toBe(1);
    expect(drafts).toHaveLength(1);
    const d = drafts[0]!;
    expect(d.ruleId).toBe('negative_range_to');
    expect(d.kind).toBe('edit');
    expect(d.proposedText).toBe('−3.4 to 1.1');
    expect(d.originTier).toBe('base_inference');
    expect(d.originatorEngine).toContain('reasoning:');
  });

  it('drops a "noop" decision (subtraction, not a range)', async () => {
    const client = stub('{"action":"noop"}');
    const { drafts } = await resolveChunkAmbiguities(
      { chunkId: 1, text: rangeText },
      [negativeRangeTo],
      client,
      makeBudget(10),
    );
    expect(drafts).toHaveLength(0);
  });

  it('respects the per-manuscript call budget', async () => {
    let n = 0;
    const client = stub('{"action":"noop"}', () => (n += 1));
    // two candidates in one context
    const { calls } = await resolveChunkAmbiguities(
      { chunkId: 1, text: '−3.4-1.1 and −5.1-2.2' },
      [negativeRangeTo],
      client,
      makeBudget(1),
    );
    expect(calls).toBe(1);
    expect(n).toBe(1);
  });

  it('skips a candidate on a provider error without throwing', async () => {
    const client: LlmClient = {
      model: 'm',
      complete: () => Promise.reject(new Error('503')),
    };
    const { drafts, calls } = await resolveChunkAmbiguities(
      { chunkId: 1, text: rangeText },
      [negativeRangeTo],
      client,
      makeBudget(10),
    );
    expect(calls).toBe(1);
    expect(drafts).toHaveLength(0);
  });
});
