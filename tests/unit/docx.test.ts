import { describe, it, expect } from 'vitest';
import { htmlToMarkdown } from '../../src/ingest/docx.js';
import { segmentManuscript } from '../../src/pipeline/segment.js';

describe('docx HTML → Markdown conversion', () => {
  it('converts a clean data table to a GFM table (first row becomes the header)', () => {
    const html =
      '<table><tr><td>Outcome</td><td>n (%)</td></tr>' +
      '<tr><td>Mortality</td><td>50 (25%)</td></tr></table>';
    const md = htmlToMarkdown(html);
    const { chunks } = segmentManuscript(md);
    const table = chunks.find((c) => c.chunkType === 'table');
    expect(table).toBeDefined();
    expect(table!.table!.rows[0]).toEqual(['Outcome', 'n (%)']);
    expect(table!.table!.rows[1]).toEqual(['Mortality', '50 (25%)']);
  });

  it('preserves statistical notation verbatim (no escaping, no tag-strip damage)', () => {
    const html = '<p>The result was P&lt;.001 and n&gt;5 (24-29%), OR 3.1 (95% CI 2.2-4.8).</p>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('P<.001');
    expect(md).toContain('n>5');
    expect(md).toContain('24-29%');
    expect(md).toContain('(95% CI 2.2-4.8)');
  });

  it('promotes bold section titles to headings', () => {
    const md = htmlToMarkdown('<p><strong>Methods</strong></p><p>We enrolled patients.</p>');
    expect(md).toMatch(/^#\s+Methods/m);
  });

  it('flattens an irregular layout table to text without leaking HTML tags', () => {
    const html =
      '<table><tr><td colspan="2"><p>Header</p></td></tr>' +
      '<tr><td><ul><li>bullet</li></ul></td><td>P&lt;.05</td></tr></table>';
    const md = htmlToMarkdown(html);
    expect(md).not.toMatch(/<\/?table|<\/?td|<\/?tr/i); // no residual table HTML
    expect(md).toContain('P<.05'); // content preserved
  });
});
