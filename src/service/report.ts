/**
 * Service operation: produce a review report for a manuscript — consumed by the CLI text report,
 * the HTML report, and the review console API. Each item carries enough to render the console: the
 * change, its rule + plain-language description, tier/confidence, a surrounding-sentence context
 * snippet (the "address" a junior uses to find the text in kriyadocs), and both status dimensions.
 */
import { getPool } from '../db/pool.js';
import { toCodepoints } from '../util/offsets.js';

export interface ReportItem {
  suggestionId: number;
  section: string;
  ruleId: string;
  ruleDescription: string;
  kind: 'edit' | 'author_query';
  status: string;
  originTier: string;
  confidence: number | null;
  original: string;
  proposed: string | null;
  queryMessage: string | null;
  /** Surrounding sentence, split around the change so the UI can highlight it in place. */
  contextPre: string;
  contextPost: string;
  appliedInKriyadocs: boolean;
  /** For faithful in-place rendering: the chunk + codepoint span the change occupies. */
  chunkId: number;
  charStart: number;
  charEnd: number;
  isCell: boolean;
}

export interface ReportChunk {
  chunkId: number;
  section: string;
  sequenceOrder: number;
  text: string;
}

export interface ManuscriptReport {
  manuscriptId: string;
  title: string | null;
  status: string;
  counts: { autoApplied: number; pending: number; queries: number; superseded: number };
  items: ReportItem[];
  /** Body prose chunks, in order — the front-end renders each once with its changes spliced in. */
  chunks: ReportChunk[];
}

/** Extract the sentence around [start,end) from `text`, returned as pre/post around the change. */
function context(text: string, start: number, end: number): { pre: string; post: string } {
  const cps = toCodepoints(text);
  let s = start;
  while (s > 0 && !/[.!?]/.test(cps[s - 1] ?? '')) s--;
  let e = end;
  while (e < cps.length && !/[.!?]/.test(cps[e] ?? '')) e++;
  if (e < cps.length) e++; // include the terminal punctuation
  return {
    pre: cps.slice(s, start).join('').replace(/^\s+/, ''),
    post: cps.slice(end, e).join('').replace(/\s+$/, ''),
  };
}

interface Row {
  suggestion_id: number;
  chunk_id: number;
  cell_id: number | null;
  section_name: string;
  rule_id: string;
  rule_description: string;
  kind: 'edit' | 'author_query';
  status: string;
  origin_tier: string;
  confidence: string | null;
  original_text: string;
  proposed_text: string | null;
  query_message: string | null;
  char_start_index: number;
  char_end_index: number;
  applied_in_kriyadocs: boolean;
  src_text: string;
}

export async function getManuscriptReport(manuscriptId: string): Promise<ManuscriptReport> {
  const pool = getPool();
  const ms = await pool.query(`SELECT title, status FROM manuscripts WHERE manuscript_id=$1`, [
    manuscriptId,
  ]);
  const rows = await pool.query<Row>(
    `SELECT es.suggestion_id, es.chunk_id, es.cell_id, mc.section_name, es.rule_id,
            sr.description AS rule_description, es.kind, es.status, es.origin_tier, es.confidence,
            es.original_text, es.proposed_text, es.query_message, es.char_start_index,
            es.char_end_index, es.applied_in_kriyadocs, COALESCE(tcx.cell_text, mc.chunk_text) AS src_text
       FROM editing_suggestions es
       JOIN manuscript_chunks mc ON es.chunk_id = mc.chunk_id
       JOIN style_rules sr ON es.rule_id = sr.rule_id
       LEFT JOIN table_cells tcx ON es.cell_id = tcx.cell_id
      WHERE mc.manuscript_id=$1
      ORDER BY mc.sequence_order, es.char_start_index, es.suggestion_id`,
    [manuscriptId],
  );
  const chunkRows = await pool.query<{
    chunk_id: number;
    section_name: string;
    sequence_order: number;
    chunk_text: string;
  }>(
    `SELECT chunk_id, section_name, sequence_order, chunk_text FROM manuscript_chunks
      WHERE manuscript_id=$1 AND chunk_type='prose' AND region='body' ORDER BY sequence_order`,
    [manuscriptId],
  );

  const items: ReportItem[] = rows.rows.map((r) => {
    const ctx = context(r.src_text, r.char_start_index, r.char_end_index);
    return {
      suggestionId: r.suggestion_id,
      section: r.section_name,
      ruleId: r.rule_id,
      ruleDescription: r.rule_description,
      kind: r.kind,
      status: r.status,
      originTier: r.origin_tier,
      confidence: r.confidence !== null ? Number(r.confidence) : null,
      original: r.original_text,
      proposed: r.proposed_text,
      queryMessage: r.query_message,
      contextPre: ctx.pre,
      contextPost: ctx.post,
      appliedInKriyadocs: r.applied_in_kriyadocs,
      chunkId: r.chunk_id,
      charStart: r.char_start_index,
      charEnd: r.char_end_index,
      isCell: r.cell_id !== null,
    };
  });

  const chunks: ReportChunk[] = chunkRows.rows.map((c) => ({
    chunkId: c.chunk_id,
    section: c.section_name,
    sequenceOrder: c.sequence_order,
    text: c.chunk_text,
  }));

  const counts = {
    autoApplied: items.filter((i) => i.status === 'auto_applied').length,
    pending: items.filter((i) => i.status === 'pending' && i.kind === 'edit').length,
    queries: items.filter((i) => i.kind === 'author_query' && i.status !== 'superseded').length,
    superseded: items.filter((i) => i.status === 'superseded').length,
  };

  return {
    manuscriptId,
    title: ms.rows[0]?.title ?? null,
    status: ms.rows[0]?.status ?? 'unknown',
    counts,
    items,
    chunks,
  };
}

/** Render the report as plain text for the CLI. */
export function formatReport(report: ManuscriptReport): string {
  const lines: string[] = [];
  lines.push(`Manuscript: ${report.title ?? '(untitled)'}  [${report.manuscriptId}]`);
  lines.push(`Status: ${report.status}`);
  lines.push(
    `Auto-applied: ${report.counts.autoApplied}  ·  Pending review: ${report.counts.pending}  ·  ` +
      `Author queries: ${report.counts.queries}  ·  Superseded: ${report.counts.superseded}`,
  );
  lines.push('');
  let section = '';
  for (const it of report.items) {
    if (it.status === 'superseded') continue;
    if (it.section !== section) {
      section = it.section;
      lines.push(`## ${section}`);
    }
    const mark = it.status === 'auto_applied' ? '✓' : it.kind === 'author_query' ? '?' : '●';
    const tag = `${it.ruleId} [${it.originTier}/${it.status}]`;
    if (it.kind === 'author_query') {
      lines.push(`  ${mark} ${tag}  "${it.original}" — ${it.queryMessage ?? 'query'}`);
    } else {
      lines.push(`  ${mark} ${tag}  "${it.original}" → "${it.proposed ?? ''}"`);
    }
  }
  return lines.join('\n');
}
