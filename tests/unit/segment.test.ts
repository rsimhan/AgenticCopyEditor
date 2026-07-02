import { describe, it, expect } from 'vitest';
import { segmentManuscript } from '../../src/pipeline/segment.js';

describe('Phase A segmentation', () => {
  it('splits into sections and keeps a statistic intact within a chunk', () => {
    const md = `# Abstract

Overall mortality was 25% (50/200).

# Results

The mean difference was -1.2 (95% CI -3.4 to 1.1) mm Hg.`;
    const { chunks } = segmentManuscript(md);
    const sections = chunks.map((c) => c.sectionName);
    expect(sections).toContain('Abstract');
    expect(sections).toContain('Results');
    // The CI statistic must not be split across chunks.
    const joined = chunks.map((c) => c.chunkText).join(' ');
    expect(joined).toContain('(95% CI -3.4 to 1.1)');
    expect(chunks.every((c) => c.chunkType === 'prose')).toBe(true);
  });

  it('assigns stable, gapless sequence order', () => {
    const md = `# A\n\npara one\n\n# B\n\npara two`;
    const { chunks } = segmentManuscript(md);
    expect(chunks.map((c) => c.sequenceOrder)).toEqual([...chunks.keys()]);
  });

  it('extracts a Markdown table into structured geometry', () => {
    const md = `# Results

| Outcome | n (%) |
| --- | --- |
| Mortality | 50 (25%) |
| Recovery | 150 (75%) |`;
    const { chunks } = segmentManuscript(md);
    const table = chunks.find((c) => c.chunkType === 'table');
    expect(table).toBeDefined();
    expect(table!.table!.headerRowCount).toBe(1);
    expect(table!.table!.rows[0]).toEqual(['Outcome', 'n (%)']);
    expect(table!.table!.rows[1]).toEqual(['Mortality', '50 (25%)']);
    expect(table!.table!.rows).toHaveLength(3);
  });

  it('starts a new chunk when the word cap is exceeded, on a paragraph boundary', () => {
    const para = (n: number) => Array.from({ length: 300 }, (_, i) => `w${n}_${i}`).join(' ');
    const md = `# Methods\n\n${para(1)}\n\n${para(2)}`;
    const { chunks } = segmentManuscript(md);
    // Two 300-word paragraphs exceed the 450 cap → two prose chunks.
    expect(chunks.filter((c) => c.chunkType === 'prose').length).toBe(2);
  });
});
