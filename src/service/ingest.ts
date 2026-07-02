/**
 * Service operation: ingest_manuscript (SPEC §8). Creates the manuscript, runs Phase A
 * segmentation, and persists chunks + table geometry. Transport-agnostic (called by the CLI now,
 * REST/MCP later). Transactional: a manuscript is either fully ingested or not at all.
 */
import { withTransaction } from '../db/pool.js';
import { segmentManuscript } from '../pipeline/segment.js';

export interface IngestInput {
  title?: string;
  rawContentMarkdown: string;
}

export interface IngestResult {
  manuscriptId: string;
  chunkCount: number;
  tableCount: number;
}

export async function ingestManuscript(input: IngestInput): Promise<IngestResult> {
  return withTransaction(async (client) => {
    const ms = await client.query<{ manuscript_id: string }>(
      `INSERT INTO manuscripts (title, raw_content_markdown, status)
       VALUES ($1,$2,'processing') RETURNING manuscript_id`,
      [input.title ?? null, input.rawContentMarkdown],
    );
    const manuscriptId = ms.rows[0]!.manuscript_id;

    const { chunks } = segmentManuscript(input.rawContentMarkdown);
    let tableCount = 0;

    for (const ch of chunks) {
      const cr = await client.query<{ chunk_id: number }>(
        `INSERT INTO manuscript_chunks (manuscript_id, section_name, sequence_order, chunk_type, chunk_text)
         VALUES ($1,$2,$3,$4,$5) RETURNING chunk_id`,
        [manuscriptId, ch.sectionName, ch.sequenceOrder, ch.chunkType, ch.chunkText],
      );
      const chunkId = cr.rows[0]!.chunk_id;

      if (ch.chunkType === 'table' && ch.table) {
        tableCount++;
        const nRows = ch.table.rows.length;
        const nCols = ch.table.rows.reduce((m, r) => Math.max(m, r.length), 0);
        const tr = await client.query<{ table_id: number }>(
          `INSERT INTO manuscript_tables (manuscript_id, chunk_id, n_rows, n_cols)
           VALUES ($1,$2,$3,$4) RETURNING table_id`,
          [manuscriptId, chunkId, nRows, nCols],
        );
        const tableId = tr.rows[0]!.table_id;
        for (let r = 0; r < ch.table.rows.length; r++) {
          const isHeader = r < ch.table.headerRowCount;
          const row = ch.table.rows[r]!;
          for (let c = 0; c < row.length; c++) {
            await client.query(
              `INSERT INTO table_cells (table_id, row_idx, col_idx, is_header, cell_text)
               VALUES ($1,$2,$3,$4,$5)`,
              [tableId, r, c, isHeader, row[c]!],
            );
          }
        }
      }
    }

    return { manuscriptId, chunkCount: chunks.length, tableCount };
  });
}
