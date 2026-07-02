/**
 * Service operation: produce a human-readable review report for a manuscript — the Phase-1 (Test)
 * output. Groups suggestions by section and status so the pipeline's behavior can be inspected and
 * refined against expert judgment (AGENT-ARCHITECTURE §14).
 */
import { getPool } from '../db/pool.js';

export interface ReportItem {
  section: string;
  ruleId: string;
  kind: 'edit' | 'author_query';
  status: string;
  originTier: string;
  original: string;
  proposed: string | null;
  queryMessage: string | null;
}

export interface ManuscriptReport {
  manuscriptId: string;
  title: string | null;
  status: string;
  counts: { autoApplied: number; pending: number; queries: number; superseded: number };
  items: ReportItem[];
}

export async function getManuscriptReport(manuscriptId: string): Promise<ManuscriptReport> {
  const pool = getPool();
  const ms = await pool.query(`SELECT title, status FROM manuscripts WHERE manuscript_id=$1`, [
    manuscriptId,
  ]);
  const rows = await pool.query(
    `SELECT mc.section_name, es.rule_id, es.kind, es.status, es.origin_tier,
            es.original_text, es.proposed_text, es.query_message
       FROM editing_suggestions es
       JOIN manuscript_chunks mc ON es.chunk_id = mc.chunk_id
      WHERE mc.manuscript_id=$1
      ORDER BY mc.sequence_order, es.char_start_index, es.suggestion_id`,
    [manuscriptId],
  );

  const items: ReportItem[] = rows.rows.map((r) => ({
    section: r.section_name,
    ruleId: r.rule_id,
    kind: r.kind,
    status: r.status,
    originTier: r.origin_tier,
    original: r.original_text,
    proposed: r.proposed_text,
    queryMessage: r.query_message,
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
  if (report.items.every((i) => i.status === 'superseded')) lines.push('  (no suggestions)');
  return lines.join('\n');
}
