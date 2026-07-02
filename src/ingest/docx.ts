/**
 * .docx → Markdown ingestion front-end (AGENT-ARCHITECTURE §14: real manuscripts arrive as Word).
 * mammoth converts the document to semantic HTML (headings, tables, paragraphs, preserving Unicode);
 * turndown + the GFM plugin render that to Markdown the Phase A segmenter understands.
 *
 * Markdown escaping is disabled so statistical notation survives verbatim — turndown would otherwise
 * backslash-escape characters like `-`, `.`, `<` that carry meaning in reported statistics
 * (e.g. `P<.001`, `24-29%`). Our downstream only needs faithful text, not re-parseable Markdown.
 */
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/** Known scientific-manuscript section names, for promoting bold titles to headings. */
const SECTION_NAME =
  /^(abstract|introduction|background|methods?|materials and methods|results|discussion|conclusions?|references|acknowledge?ments|limitations|objectives?)\b/i;

/**
 * Normalize mammoth's HTML before Markdown conversion:
 *  - drop inlined base64 images (figures are out of v1 scope);
 *  - promote each table's first row from <td> to <th> so the GFM plugin emits a real Markdown table
 *    for CLEAN data tables (mammoth emits every cell as <td>);
 *  - promote bold, section-named paragraphs to <h1> (docs often style headings as bold rather than
 *    using Heading styles; real Heading styles already map to <h1>–<h6>).
 */
function normalizeHtml(html: string): string {
  let out = html.replace(/<img[^>]*>/gi, '');

  out = out.replace(/<table>([\s\S]*?)<\/table>/gi, (_m, inner: string) => {
    let firstRowDone = false;
    const fixed = inner.replace(/<tr>([\s\S]*?)<\/tr>/i, (trm: string, tri: string) => {
      if (firstRowDone) return trm;
      firstRowDone = true;
      return `<tr>${tri.replace(/<td[^>]*>/gi, '<th>').replace(/<\/td>/gi, '</th>')}</tr>`;
    });
    return `<table>${fixed}</table>`;
  });

  out = out.replace(/<p>\s*<strong>([^<]{1,80})<\/strong>\s*<\/p>/gi, (m, txt: string) =>
    SECTION_NAME.test(txt.trim()) ? `<h1>${txt.trim()}</h1>` : m,
  );

  return out;
}

/**
 * Flatten any table that turndown left as raw HTML (irregular layout tables with colspan/rowspan or
 * nested blocks that the GFM plugin can't represent) into plain text rows. This ONLY touches
 * complete `<table>…</table>` blocks, so stray `<`/`>` in statistical prose (P<.001, n>5) is never
 * altered.
 */
function flattenResidualTables(md: string): string {
  return md.replace(
    /<table[\s\S]*?<\/table>/gi,
    (block) =>
      '\n' +
      block
        .replace(/<\/(tr|p|li)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .split('\n')
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n') +
      '\n',
  );
}

/** Convert (already-parsed) document HTML to Markdown. Exposed for testing without a .docx file. */
export function htmlToMarkdown(html: string): string {
  const td = new TurndownService({
    headingStyle: 'atx', // "# Heading" — what the segmenter reads
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  });
  td.use(gfm); // GFM tables → "| a | b |" with a "| --- |" delimiter row
  // Preserve reported values exactly; do not escape Markdown metacharacters.
  (td as unknown as { escape: (s: string) => string }).escape = (s) => s;

  return flattenResidualTables(td.turndown(normalizeHtml(html))).trim();
}

export async function docxToMarkdown(path: string): Promise<string> {
  const { value: html } = await mammoth.convertToHtml({ path });
  return htmlToMarkdown(html);
}
