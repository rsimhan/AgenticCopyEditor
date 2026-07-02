import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import pgvector from 'pgvector/pg';
import { loadConfig } from '../../src/config/index.js';

/**
 * Milestone 1 smoke test (SPEC §9 M1): insert one row per table respecting every FK and CHECK,
 * and exercise the key invariants (kind/proposed_text, append-only audit). Everything runs inside
 * ONE transaction that is rolled back, so the test is idempotent and never mutates the DB (the
 * rollback also side-steps the append-only trigger, which fires on DELETE, not ROLLBACK).
 *
 * Requires a live migrated DB: `pnpm db:up && pnpm migrate:up`.
 */
describe('schema smoke test', () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;

  beforeAll(async () => {
    const cfg = loadConfig();
    pool = new pg.Pool({ connectionString: cfg.DATABASE_URL });
    pool.on('connect', (c) => void pgvector.registerType(c));
    client = await pool.connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    if (pool) await pool.end();
  });

  it('has the seeded rule catalog and precision policy', async () => {
    const rules = await client.query('SELECT count(*)::int AS n FROM style_rules');
    expect(rules.rows[0].n).toBeGreaterThanOrEqual(24);
    const policy = await client.query('SELECT count(*)::int AS n FROM stat_precision_policy');
    expect(policy.rows[0].n).toBe(9);
  });

  it('inserts one row per table respecting all FKs and CHECKs', async () => {
    const editor = await client.query(
      `SELECT editor_id FROM editors WHERE email = 'admin@example.com'`,
    );
    const editorId = editor.rows[0].editor_id as number;

    const ms = await client.query(
      `INSERT INTO manuscripts (title, raw_content_markdown) VALUES ($1, $2) RETURNING manuscript_id`,
      ['Smoke Manuscript', '# Results\nMortality was 25% (50/200).'],
    );
    const manuscriptId = ms.rows[0].manuscript_id as string;

    const chunk = await client.query(
      `INSERT INTO manuscript_chunks (manuscript_id, section_name, sequence_order, chunk_type, chunk_text)
       VALUES ($1,'Results',0,'prose',$2) RETURNING chunk_id`,
      [manuscriptId, 'Mortality was 25% (50/200).'],
    );
    const chunkId = chunk.rows[0].chunk_id as number;

    const table = await client.query(
      `INSERT INTO manuscript_tables (manuscript_id, chunk_id, caption, n_rows, n_cols)
       VALUES ($1,$2,'Table 1',2,2) RETURNING table_id`,
      [manuscriptId, chunkId],
    );
    const tableId = table.rows[0].table_id as number;

    const cell = await client.query(
      `INSERT INTO table_cells (table_id, row_idx, col_idx, is_header, cell_text)
       VALUES ($1,1,1,false,'25.0%') RETURNING cell_id`,
      [tableId],
    );
    const cellId = cell.rows[0].cell_id as number;

    await client.query(
      `INSERT INTO extracted_statistics
        (manuscript_id, source_chunk_id, source_cell_id, location_context, stat_type,
         logical_key, raw_value_string, numeric_value_primary, char_start_index, char_end_index)
       VALUES ($1,$2,$3,'table_cell','percentage','mortality_pct','25.0%',25.0,0,5)`,
      [manuscriptId, chunkId, cellId],
    );

    const edit = await client.query(
      `INSERT INTO editing_suggestions
        (chunk_id, cell_id, rule_id, originator_engine, origin_tier, kind,
         char_start_index, char_end_index, original_text, proposed_text)
       VALUES ($1,$2,'whole_number_percent','regex_engine_v1','deterministic','edit',0,5,'25.0%','25%')
       RETURNING suggestion_id`,
      [chunkId, cellId],
    );
    const suggestionId = edit.rows[0].suggestion_id as number;

    // author_query variant: proposed_text NULL is required and allowed.
    await client.query(
      `INSERT INTO editing_suggestions
        (chunk_id, rule_id, originator_engine, origin_tier, kind,
         char_start_index, char_end_index, original_text, proposed_text)
       VALUES ($1,'p_value_reporting','regex_engine_v1','base_inference','author_query',0,5,'P<.05',NULL)`,
      [chunkId],
    );

    await client.query(
      `INSERT INTO action_audit_log (suggestion_id, chunk_id, rule_id, editor_id, action, detail)
       VALUES ($1,$2,'whole_number_percent',$3,'accepted','{"final_text":"25%"}'::jsonb)`,
      [suggestionId, chunkId, editorId],
    );

    const mem = await client.query(
      `INSERT INTO feedback_memory_records
        (rule_id, editor_id, source_suggestion_id, original_span_text, editor_corrected_text, editor_rationale)
       VALUES ('whole_number_percent',$1,$2,'25.0%','25%','Whole-number percentage takes no trailing zero.')
       RETURNING memory_id`,
      [editorId, suggestionId],
    );
    const memoryId = mem.rows[0].memory_id as number;

    await client.query(
      `INSERT INTO feedback_memory_vectors (memory_id, embedding_model, vector_dimensions, vector_data)
       VALUES ($1,'gemini-embedding-001',3,$2)`,
      [memoryId, pgvector.toSql([0.1, 0.2, 0.3])],
    );

    const counts = await client.query(
      `SELECT
         (SELECT count(*) FROM extracted_statistics WHERE manuscript_id=$1)::int AS stats,
         (SELECT count(*) FROM editing_suggestions WHERE chunk_id=$2)::int AS suggestions,
         (SELECT count(*) FROM feedback_memory_vectors WHERE memory_id=$3)::int AS vectors`,
      [manuscriptId, chunkId, memoryId],
    );
    expect(counts.rows[0]).toEqual({ stats: 1, suggestions: 2, vectors: 1 });
  });

  it('rejects an edit with no proposed_text (kind CHECK)', async () => {
    await client.query('SAVEPOINT sp');
    const chunk = await freshChunk(client);
    await expect(
      client.query(
        `INSERT INTO editing_suggestions
          (chunk_id, rule_id, originator_engine, origin_tier, kind, char_start_index, char_end_index, original_text)
         VALUES ($1,'thousands_separator','regex_engine_v1','deterministic','edit',0,4,'test')`,
        [chunk],
      ),
    ).rejects.toThrow();
    await client.query('ROLLBACK TO SAVEPOINT sp');
  });

  it('rejects an author_query that carries proposed_text (kind CHECK)', async () => {
    await client.query('SAVEPOINT sp2');
    const chunk = await freshChunk(client);
    await expect(
      client.query(
        `INSERT INTO editing_suggestions
          (chunk_id, rule_id, originator_engine, origin_tier, kind, char_start_index, char_end_index, original_text, proposed_text)
         VALUES ($1,'p_value_reporting','regex_engine_v1','base_inference','author_query',0,4,'P<.05','nope')`,
        [chunk],
      ),
    ).rejects.toThrow();
    await client.query('ROLLBACK TO SAVEPOINT sp2');
  });

  it('enforces append-only on action_audit_log (UPDATE rejected)', async () => {
    await client.query('SAVEPOINT sp3');
    await client.query(`INSERT INTO action_audit_log (action) VALUES ('proposed')`);
    await expect(client.query(`UPDATE action_audit_log SET action='accepted'`)).rejects.toThrow(
      /append-only/,
    );
    await client.query('ROLLBACK TO SAVEPOINT sp3');
  });
});

async function freshChunk(client: pg.PoolClient): Promise<number> {
  const ms = await client.query(
    `INSERT INTO manuscripts (raw_content_markdown) VALUES ('x') RETURNING manuscript_id`,
  );
  const chunk = await client.query(
    `INSERT INTO manuscript_chunks (manuscript_id, section_name, sequence_order, chunk_text)
     VALUES ($1,'Results',0,'text') RETURNING chunk_id`,
    [ms.rows[0].manuscript_id],
  );
  return chunk.rows[0].chunk_id as number;
}
