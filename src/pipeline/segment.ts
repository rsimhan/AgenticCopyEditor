/**
 * Phase A — ingestion & segmentation (SPEC §5). Splits a Markdown manuscript into sections and
 * ~250–500-word prose chunks, and extracts Markdown tables into structured geometry. Statistic-safe
 * by construction: it never splits inside a paragraph, so a bracketed statistic stays intact.
 */

const MAX_WORDS_PER_CHUNK = 450;

export interface SegmentedTable {
  /** All rows (header + body) as trimmed cell strings. */
  rows: string[][];
  /** How many leading rows are header rows (Markdown tables: 1). */
  headerRowCount: number;
}

export interface SegmentedChunk {
  sectionName: string;
  sequenceOrder: number;
  chunkType: 'prose' | 'table';
  chunkText: string;
  table?: SegmentedTable;
}

export interface Segmentation {
  chunks: SegmentedChunk[];
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const HEADING = /^#{1,6}\s+(.*\S)\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DELIM = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

interface ParaBlock {
  kind: 'para';
  section: string;
  text: string;
}
interface TableBlock {
  kind: 'table';
  section: string;
  raw: string;
  table: SegmentedTable;
}
type Block = ParaBlock | TableBlock;

function parseTable(lines: string[]): SegmentedTable {
  const cells = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());

  const rows: string[][] = [];
  let headerRowCount = 0;
  let seenDelim = false;
  for (const line of lines) {
    if (TABLE_DELIM.test(line) && !seenDelim) {
      seenDelim = true;
      headerRowCount = rows.length; // rows collected so far are headers
      continue;
    }
    rows.push(cells(line));
  }
  if (!seenDelim) headerRowCount = rows.length > 0 ? 1 : 0; // fallback: first row is header
  return { rows, headerRowCount };
}

/** Parse the manuscript into ordered blocks tagged by section. */
function toBlocks(markdown: string): Block[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: Block[] = [];
  let section = 'Body';
  let para: string[] = [];

  const flushPara = () => {
    const text = para.join(' ').trim();
    if (text) blocks.push({ kind: 'para', section, text });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = line.match(HEADING);
    if (heading) {
      flushPara();
      section = heading[1]!.trim();
      continue;
    }
    // Table: a row line immediately followed by a delimiter row.
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_DELIM.test(lines[i + 1]!)) {
      flushPara();
      const tableLines: string[] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) {
        tableLines.push(lines[i]!);
        i++;
      }
      i--; // step back; the for-loop will advance
      blocks.push({
        kind: 'table',
        section,
        raw: tableLines.join('\n'),
        table: parseTable(tableLines),
      });
      continue;
    }
    if (line.trim() === '') {
      flushPara();
    } else {
      para.push(line.trim());
    }
  }
  flushPara();
  return blocks;
}

export function segmentManuscript(markdown: string): Segmentation {
  const blocks = toBlocks(markdown);
  const chunks: SegmentedChunk[] = [];
  let seq = 0;

  // Accumulate consecutive same-section paragraphs into prose chunks up to the word cap.
  let buf: string[] = [];
  let bufSection = '';
  const flushBuf = () => {
    if (buf.length === 0) return;
    chunks.push({
      sectionName: bufSection,
      sequenceOrder: seq++,
      chunkType: 'prose',
      chunkText: buf.join('\n\n'),
    });
    buf = [];
  };

  for (const block of blocks) {
    if (block.kind === 'table') {
      flushBuf();
      chunks.push({
        sectionName: block.section,
        sequenceOrder: seq++,
        chunkType: 'table',
        chunkText: block.raw,
        table: block.table,
      });
      continue;
    }
    // paragraph
    if (bufSection && block.section !== bufSection) flushBuf();
    bufSection = block.section;
    const projected = wordCount([...buf, block.text].join(' '));
    if (buf.length > 0 && projected > MAX_WORDS_PER_CHUNK) flushBuf();
    bufSection = block.section;
    buf.push(block.text);
  }
  flushBuf();

  return { chunks };
}
