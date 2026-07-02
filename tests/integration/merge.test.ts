import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getPool, closePool } from '../../src/db/pool.js';
import { mergeChunkInDb } from '../../src/pipeline/merge-db.js';

/**
 * Phase E persistence + concurrency (SPEC §9 M4). Requires a live migrated DB.
 * Each test creates its own manuscript/chunk so runs are independent.
 */
describe('merge & arbitration (DB)', () => {
  const pool = getPool();
  let chunkId: number;
  let editorId: number;

  beforeAll(async () => {
    const e = await pool.query(`SELECT editor_id FROM editors WHERE email='admin@example.com'`);
    editorId = e.rows[0].editor_id;
  });

  afterAll(async () => {
    await closePool();
  });

  async function freshChunk(text: string): Promise<number> {
    const ms = await pool.query(
      `INSERT INTO manuscripts (raw_content_markdown) VALUES ($1) RETURNING manuscript_id`,
      [text],
    );
    const c = await pool.query(
      `INSERT INTO manuscript_chunks (manuscript_id, section_name, sequence_order, chunk_text)
       VALUES ($1,'Results',0,$2) RETURNING chunk_id`,
      [ms.rows[0].manuscript_id, text],
    );
    return c.rows[0].chunk_id;
  }

  async function addSuggestion(
    cId: number,
    ruleId: string,
    tier: string,
    start: number,
    end: number,
    original: string,
  ): Promise<number> {
    const r = await pool.query(
      `INSERT INTO editing_suggestions
        (chunk_id, rule_id, originator_engine, origin_tier, kind, char_start_index, char_end_index, original_text, proposed_text)
       VALUES ($1,$2,'test',$3,'edit',$4,$5,$6,$7) RETURNING suggestion_id`,
      [cId, ruleId, tier, start, end, original, original.toUpperCase()],
    );
    return r.rows[0].suggestion_id;
  }

  async function nonSupersededSpans(cId: number) {
    const r = await pool.query(
      `SELECT char_start_index AS s, char_end_index AS e FROM editing_suggestions
        WHERE chunk_id=$1 AND status IN ('pending','auto_applied')
        ORDER BY char_start_index`,
      [cId],
    );
    return r.rows as Array<{ s: number; e: number }>;
  }

  beforeEach(async () => {
    // A 30-char chunk gives room for the spans below.
    chunkId = await freshChunk('0123456789012345678901234567890');
  });

  it('higher tier keeps its span; lower tier is split to its remainder', async () => {
    const det = await addSuggestion(
      chunkId,
      'thousands_separator',
      'deterministic',
      10,
      20,
      '0123456789',
    );
    const llm = await addSuggestion(
      chunkId,
      'negative_range_to',
      'base_inference',
      15,
      25,
      '5678901234',
    );

    const summary = await mergeChunkInDb(chunkId);
    expect(summary).toMatchObject({ kept: 1, split: 1 });

    const rows = await pool.query(
      `SELECT suggestion_id, char_start_index, char_end_index, status FROM editing_suggestions WHERE chunk_id=$1`,
      [chunkId],
    );
    const byId = new Map(rows.rows.map((r) => [r.suggestion_id, r]));
    expect(byId.get(det)).toMatchObject({ char_start_index: 10, char_end_index: 20 });
    // LLM claim truncated to [20,25) — its non-overlapping remainder survived.
    expect(byId.get(llm)).toMatchObject({ char_start_index: 20, char_end_index: 25 });

    const spans = await nonSupersededSpans(chunkId);
    for (let i = 1; i < spans.length; i++)
      expect(spans[i]!.s).toBeGreaterThanOrEqual(spans[i - 1]!.e);
  });

  it('supersedes a fully-covered lower-tier suggestion', async () => {
    await addSuggestion(
      chunkId,
      'thousands_separator',
      'deterministic',
      5,
      25,
      '01234567890123456789',
    );
    const loser = await addSuggestion(
      chunkId,
      'negative_range_to',
      'base_inference',
      10,
      18,
      '01234567',
    );
    await mergeChunkInDb(chunkId);
    const r = await pool.query(`SELECT status FROM editing_suggestions WHERE suggestion_id=$1`, [
      loser,
    ]);
    expect(r.rows[0].status).toBe('superseded');
  });

  it('two concurrent merges do not lose or duplicate spans (advisory lock)', async () => {
    await addSuggestion(chunkId, 'thousands_separator', 'deterministic', 0, 10, '0123456789');
    await addSuggestion(chunkId, 'negative_range_to', 'base_inference', 5, 20, '567890123456789');
    await addSuggestion(
      chunkId,
      'cross_reference_mismatch',
      'verified_memory',
      18,
      30,
      '890123456789',
    );

    // Fire two merges at the same chunk simultaneously.
    const [a, b] = await Promise.all([mergeChunkInDb(chunkId), mergeChunkInDb(chunkId)]);
    // The advisory lock serializes them; the second sees an already-reconciled, non-overlapping set.
    expect(a.kept + a.split + a.superseded).toBeGreaterThan(0);
    expect(b).toBeDefined();

    const spans = await nonSupersededSpans(chunkId);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.s).toBeGreaterThanOrEqual(spans[i - 1]!.e); // no overlaps
    }
    // Idempotent: a third merge changes nothing further.
    const third = await mergeChunkInDb(chunkId);
    expect(third.superseded).toBe(0);
    expect(third.split).toBe(0);
  });
});
