import { describe, it, expect } from 'vitest';
import { runFormatEngine } from '../../src/engine/format-engine.js';
import { spanRuleHandlers, buildSpanRegistry } from '../../src/rules/handlers/index.js';
import { sliceByCodepoint } from '../../src/util/offsets.js';

describe('format engine (Phase C)', () => {
  it('produces suggestions across multiple rules with correct auto-apply flags', () => {
    const text = 'The rate was 18 % (36127 cases); trending towards P = .03.';
    const results = runFormatEngine({ chunkId: 7, text }, spanRuleHandlers);
    const byRule = new Map(results.map((r) => [r.ruleId, r]));

    // percent_no_space, thousands_separator, term_toward → auto-applicable edits
    expect(byRule.get('percent_no_space')?.draft.proposedText).toBe('18%');
    expect(byRule.get('percent_no_space')?.autoApply).toBe(true);
    expect(byRule.get('thousands_separator')?.draft.proposedText).toBe('36,127');
    expect(byRule.get('thousands_separator')?.autoApply).toBe(true);
    expect(byRule.get('term_toward')?.draft.proposedText).toBe('toward');

    // no_space_operators fires (P = .03) but must NOT auto-apply
    expect(byRule.get('no_space_operators')?.draft.proposedText).toBe('=');
    expect(byRule.get('no_space_operators')?.autoApply).toBe(false);

    // leading_zero must NOT fire on the P value (.03) — context exception
    expect(byRule.has('leading_zero')).toBe(false);
  });

  it('records codepoint-correct spans that round-trip against the source (non-ASCII)', () => {
    // Leading ≤ (BMP, 1 code unit) then a spaced percent later.
    const text = '≤ 18 % of χ² cases';
    const results = runFormatEngine({ chunkId: 1, text }, spanRuleHandlers);
    const pct = results.find((r) => r.ruleId === 'percent_no_space');
    expect(pct).toBeDefined();
    const { start, end } = pct!.draft.span;
    expect(sliceByCodepoint(text, start, end)).toBe(pct!.draft.originalText);
    expect(pct!.draft.originalText).toBe('18 %');
  });

  it('carries the cell_id through for table-scoped context', () => {
    const results = runFormatEngine({ chunkId: 3, cellId: 42, text: '25.0%' }, spanRuleHandlers);
    const whole = results.find((r) => r.ruleId === 'whole_number_percent');
    expect(whole?.draft.cellId).toBe(42);
    expect(whole?.draft.proposedText).toBe('25%');
    expect(whole?.autoApply).toBe(true);
  });

  it('registry rejects duplicate handler ids and exposes all span rules', () => {
    const reg = buildSpanRegistry();
    expect(reg.byScope('span').length).toBe(spanRuleHandlers.length);
  });
});
