/**
 * Service operations that run the pipeline phases over an ingested manuscript and persist
 * suggestions to the ledger. Transport-agnostic (SPEC §8; AGENT-ARCHITECTURE §5.7). Phase C is
 * fully deterministic; B.1a derived checks are deterministic; B.1b/B.2 are best-effort in v1.
 */
import { getPool } from '../db/pool.js';
import { PgLedgerRepo } from '../db/ledger-repo.js';
import { runFormatEngine } from '../engine/format-engine.js';
import { spanRuleHandlers } from '../rules/handlers/index.js';
import { runDerivedChecks, runCrossLocation } from '../pipeline/reconcile.js';
import {
  tableRangeStyleConsistency,
  decimalPlacesConsistency,
  type CellText,
  type PercentOccurrence,
} from '../pipeline/consistency.js';
import { extractStatistics } from '../pipeline/extract.js';
import { deriveLogicalKey, guessLabelBefore } from '../pipeline/logical-key.js';
import { mergeChunkInDb } from '../pipeline/merge-db.js';
import {
  sliceByCodepoint,
  codeUnitToCodepoint,
  codepointLength,
  spansOverlap,
} from '../util/offsets.js';
import type { CharSpan } from '../util/offsets.js';
import type { StatExtraction } from '../domain/stats.js';
import type { SuggestionDraft, LocationContext } from '../domain/types.js';

const ledger = new PgLedgerRepo();

interface ProseUnit {
  chunkId: number;
  section: string;
  text: string;
}
interface CellUnit {
  chunkId: number;
  cellId: number;
  text: string;
  label: string | null;
}

async function loadProse(manuscriptId: string): Promise<ProseUnit[]> {
  // Only body chunks are copyedited for statistical content (front/back matter are skipped).
  const r = await getPool().query(
    `SELECT chunk_id, section_name, chunk_text FROM manuscript_chunks
      WHERE manuscript_id=$1 AND chunk_type='prose' AND region='body' ORDER BY sequence_order`,
    [manuscriptId],
  );
  return r.rows.map((x) => ({ chunkId: x.chunk_id, section: x.section_name, text: x.chunk_text }));
}

async function loadDataCells(manuscriptId: string): Promise<CellUnit[]> {
  // The quantity in a data cell is identified by its ROW label (the col-0 cell of the same row),
  // not the shared column header — otherwise every cell in a "n (%)" column collapses to one key.
  const r = await getPool().query(
    `SELECT tc.cell_id, mt.chunk_id, tc.cell_text, tc.col_idx, lbl.cell_text AS row_label
       FROM table_cells tc
       JOIN manuscript_tables mt ON tc.table_id = mt.table_id
       LEFT JOIN table_cells lbl ON lbl.table_id = tc.table_id AND lbl.row_idx = tc.row_idx AND lbl.col_idx = 0
      JOIN manuscript_chunks mc ON mt.chunk_id = mc.chunk_id
      WHERE mt.manuscript_id=$1 AND NOT tc.is_header AND mc.region='body'
      ORDER BY tc.cell_id`,
    [manuscriptId],
  );
  return r.rows.map((x) => ({
    chunkId: x.chunk_id,
    cellId: x.cell_id,
    text: x.cell_text,
    label: x.col_idx === 0 ? null : (x.row_label ?? null),
  }));
}

function locationFor(section: string): LocationContext {
  return /abstract/i.test(section) ? 'abstract' : 'body_prose';
}

// ---------- Phase C: deterministic fixes ----------

/** Codepoint spans of URLs / DOIs / emails in text — rules must not fire inside these. */
function urlSpans(text: string): CharSpan[] {
  const spans: CharSpan[] = [];
  const re = /(https?:\/\/|www\.|doi\.org|\b10\.\d{4,}\/|\bMedline:\s*|[\w.+-]+@[\w-]+\.\w+)\S*/gi;
  for (const m of text.matchAll(re)) {
    const start = codeUnitToCodepoint(text, m.index);
    spans.push({ start, end: start + codepointLength(m[0]) });
  }
  return spans;
}

export async function runDeterministicFixes(manuscriptId: string): Promise<number> {
  let posted = 0;
  const emit = async (
    ctx: { chunkId: number; cellId?: number; text: string; isTableCell?: boolean },
    urls: CharSpan[],
  ): Promise<void> => {
    for (const s of runFormatEngine(ctx, spanRuleHandlers)) {
      if (urls.some((u) => spansOverlap(u, s.draft.span))) continue; // skip fixes inside a URL/DOI
      await ledger.postSuggestion(s.draft, s.autoApply ? 'auto_applied' : 'pending');
      posted++;
    }
  };

  for (const u of await loadProse(manuscriptId)) {
    await emit({ chunkId: u.chunkId, text: u.text }, urlSpans(u.text));
  }
  for (const c of await loadDataCells(manuscriptId)) {
    await emit(
      { chunkId: c.chunkId, cellId: c.cellId, text: c.text, isTableCell: true },
      urlSpans(c.text),
    );
  }
  return posted;
}

// ---------- Phase B: extraction (persist + return for reconciliation) ----------

export async function extractAndPersist(manuscriptId: string): Promise<StatExtraction[]> {
  const pool = getPool();
  const all: StatExtraction[] = [];

  for (const u of await loadProse(manuscriptId)) {
    for (const s of extractStatistics({
      chunkId: u.chunkId,
      text: u.text,
      locationContext: locationFor(u.section),
    })) {
      const key = guessLabelBefore(sliceByCodepoint(u.text, 0, s.span.start));
      const stat: StatExtraction = { ...s, ...(key ? { logicalKey: key } : {}) };
      all.push(stat);
    }
  }
  for (const c of await loadDataCells(manuscriptId)) {
    for (const s of extractStatistics({
      chunkId: c.chunkId,
      cellId: c.cellId,
      text: c.text,
      locationContext: 'table_cell',
    })) {
      const key = c.label ? deriveLogicalKey(c.label) : undefined;
      all.push({ ...s, ...(key ? { logicalKey: key } : {}) });
    }
  }

  for (const s of all) {
    await pool.query(
      `INSERT INTO extracted_statistics
         (manuscript_id, source_chunk_id, source_cell_id, location_context, stat_type, logical_key,
          raw_value_string, numeric_value_primary, numeric_value_secondary, char_start_index, char_end_index)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        manuscriptId,
        s.chunkId,
        s.cellId ?? null,
        s.locationContext,
        s.statType,
        s.logicalKey ?? null,
        s.rawValueString,
        s.numericPrimary ?? null,
        s.numericSecondary ?? null,
        s.span.start,
        s.span.end,
      ],
    );
  }
  return all;
}

// ---------- Phase B.1 + B.2: reconciliation & consistency ----------

async function post(drafts: SuggestionDraft[]): Promise<number> {
  for (const d of drafts) await ledger.postSuggestion(d, 'pending');
  return drafts.length;
}

export async function reconcile(manuscriptId: string, stats: StatExtraction[]): Promise<number> {
  let n = 0;
  // B.1a derived checks over prose + cell text.
  for (const u of await loadProse(manuscriptId))
    n += await post(runDerivedChecks(u.chunkId, u.text));
  for (const c of await loadDataCells(manuscriptId)) {
    n += await post(runDerivedChecks(c.chunkId, c.text).map((d) => ({ ...d, cellId: c.cellId })));
  }
  // B.1b cross-location agreement.
  n += await post(runCrossLocation(stats));
  return n;
}

export async function runConsistency(
  manuscriptId: string,
  stats: StatExtraction[],
): Promise<number> {
  let n = 0;
  // B.2 table range-style: per table, over its data cells.
  const cells = await loadDataCells(manuscriptId);
  const byChunk = new Map<number, CellText[]>();
  for (const c of cells)
    (byChunk.get(c.chunkId) ?? byChunk.set(c.chunkId, []).get(c.chunkId)!).push({
      chunkId: c.chunkId,
      cellId: c.cellId,
      text: c.text,
    });
  for (const group of byChunk.values()) n += await post(tableRangeStyleConsistency(group));

  // B.2 decimal-place consistency over all percentage occurrences.
  const pct: PercentOccurrence[] = stats
    .filter((s) => s.statType === 'percentage')
    .map((s) => ({
      chunkId: s.chunkId,
      ...(s.cellId !== undefined ? { cellId: s.cellId } : {}),
      span: s.span,
      rawValueString: s.rawValueString,
    }));
  n += await post(decimalPlacesConsistency(pct));
  return n;
}

// ---------- Phase E: merge ----------

export async function mergeAll(manuscriptId: string): Promise<void> {
  const r = await getPool().query(`SELECT chunk_id FROM manuscript_chunks WHERE manuscript_id=$1`, [
    manuscriptId,
  ]);
  for (const row of r.rows) await mergeChunkInDb(row.chunk_id);
}

// ---------- Full pipeline ----------

export interface PipelineSummary {
  deterministic: number;
  reconciliation: number;
  consistency: number;
}

export async function runFullPipeline(manuscriptId: string): Promise<PipelineSummary> {
  const deterministic = await runDeterministicFixes(manuscriptId);
  const stats = await extractAndPersist(manuscriptId);
  const reconciliation = await reconcile(manuscriptId, stats);
  const consistency = await runConsistency(manuscriptId, stats);
  await mergeAll(manuscriptId);
  await getPool().query(
    `UPDATE manuscripts SET status='review', updated_at=now() WHERE manuscript_id=$1`,
    [manuscriptId],
  );
  return { deterministic, reconciliation, consistency };
}
