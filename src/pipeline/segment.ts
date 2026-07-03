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

/**
 * Where a chunk sits in the manuscript. Only `body` is copyedited for statistical content — a real
 * editor never applies number rules to author affiliations/DOIs (front matter) or the reference
 * list / end sections (back matter), which are full of IDs, dates, and citation numbers.
 */
export type ChunkRegion = 'front_matter' | 'body' | 'back_matter';

export interface SegmentedChunk {
  sectionName: string;
  sequenceOrder: number;
  chunkType: 'prose' | 'table';
  region: ChunkRegion;
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

/** A section heading that begins the manuscript body. */
const BODY_START = /^(abstract|introduction|background|objectives?)\b/i;
/** A section heading that begins the back matter (references + end sections). */
const BACK_MATTER =
  /^(references|bibliography|acknowledge?ments|conflicts?\s+of\s+interest|competing\s+interests|data\s+availability|author\s+contributions?|funding|supplementary|appendix|appendices|abbreviations)\b/i;

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

/**
 * Assign a region to each block by document position: everything before the first body-start
 * heading is front matter; from the first back-matter heading onward is back matter; the rest is
 * body. If no body-start heading is found (a fragment/extract), there is no front matter — treat it
 * all as body so nothing is silently skipped.
 */
function regionsFor(blocks: Block[]): ChunkRegion[] {
  let firstBody = -1;
  let firstBack = -1;
  for (let i = 0; i < blocks.length; i++) {
    const s = blocks[i]!.section;
    if (firstBody < 0 && BODY_START.test(s)) firstBody = i;
    if (firstBack < 0 && i >= Math.max(firstBody, 0) && BACK_MATTER.test(s)) firstBack = i;
  }
  return blocks.map((_, i) => {
    if (firstBack >= 0 && i >= firstBack) return 'back_matter';
    if (firstBody > 0 && i < firstBody) return 'front_matter';
    return 'body';
  });
}

export function segmentManuscript(markdown: string): Segmentation {
  const blocks = toBlocks(markdown);
  const regions = regionsFor(blocks);
  const chunks: SegmentedChunk[] = [];
  let seq = 0;

  // Accumulate consecutive same-section paragraphs into prose chunks up to the word cap.
  let buf: string[] = [];
  let bufSection = '';
  let bufRegion: ChunkRegion = 'body';
  const flushBuf = () => {
    if (buf.length === 0) return;
    chunks.push({
      sectionName: bufSection,
      sequenceOrder: seq++,
      chunkType: 'prose',
      region: bufRegion,
      chunkText: buf.join('\n\n'),
    });
    buf = [];
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const region = regions[i]!;
    if (block.kind === 'table') {
      flushBuf();
      chunks.push({
        sectionName: block.section,
        sequenceOrder: seq++,
        chunkType: 'table',
        region,
        chunkText: block.raw,
        table: block.table,
      });
      continue;
    }
    // paragraph
    if (bufSection && block.section !== bufSection) flushBuf();
    const projected = wordCount([...buf, block.text].join(' '));
    if (buf.length > 0 && projected > MAX_WORDS_PER_CHUNK) flushBuf();
    bufSection = block.section;
    bufRegion = region;
    buf.push(block.text);
  }
  flushBuf();

  return { chunks };
}
