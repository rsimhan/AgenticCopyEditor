import { describe, it, expect } from 'vitest';
import { SuggestionDraftSchema } from '../../src/domain/types.js';

const base = {
  chunkId: 1,
  ruleId: 'percent_no_space',
  originatorEngine: 'regex_engine_v1',
  originTier: 'deterministic' as const,
  span: { start: 0, end: 4 },
  originalText: '18 %',
};

describe('SuggestionDraft contract (SPEC §4 kind/proposed invariant)', () => {
  it('accepts a well-formed edit', () => {
    const r = SuggestionDraftSchema.safeParse({ ...base, kind: 'edit', proposedText: '18%' });
    expect(r.success).toBe(true);
  });

  it('rejects an edit with no proposedText', () => {
    const r = SuggestionDraftSchema.safeParse({ ...base, kind: 'edit' });
    expect(r.success).toBe(false);
  });

  it('accepts an author_query with a message and no proposedText', () => {
    const r = SuggestionDraftSchema.safeParse({
      ...base,
      ruleId: 'p_value_exact',
      kind: 'author_query',
      queryMessage: 'Exact P value not derivable from the text; please provide it.',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an author_query that carries proposedText', () => {
    const r = SuggestionDraftSchema.safeParse({
      ...base,
      kind: 'author_query',
      queryMessage: 'x',
      proposedText: 'nope',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an inverted span', () => {
    const r = SuggestionDraftSchema.safeParse({
      ...base,
      kind: 'edit',
      proposedText: '18%',
      span: { start: 4, end: 0 },
    });
    expect(r.success).toBe(false);
  });
});
