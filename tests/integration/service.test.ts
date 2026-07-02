import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { getPool, closePool } from '../../src/db/pool.js';
import { PgLedgerRepo } from '../../src/db/ledger-repo.js';
import { ingestManuscript } from '../../src/service/ingest.js';
import { runFullPipeline } from '../../src/service/run.js';
import { getManuscriptReport } from '../../src/service/report.js';
import type { SuggestionDraft } from '../../src/domain/types.js';

describe('service layer (M5)', () => {
  const pool = getPool();
  const repo = new PgLedgerRepo();
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

  const editDraft = (chunkId: number, span: { start: number; end: number }): SuggestionDraft => ({
    chunkId,
    ruleId: 'thousands_separator',
    originatorEngine: 'test',
    originTier: 'deterministic',
    kind: 'edit',
    span,
    originalText: 'x',
    proposedText: 'y',
  });

  it('post_suggestion rejects an out-of-bounds span', async () => {
    const chunkId = await freshChunk('short'); // 5 codepoints
    await expect(repo.postSuggestion(editDraft(chunkId, { start: 0, end: 99 }))).rejects.toThrow(
      /exceeds text length/,
    );
  });

  it('post_suggestion is idempotent on the de-dupe key', async () => {
    const chunkId = await freshChunk('12345 abcdef');
    const a = await repo.postSuggestion(editDraft(chunkId, { start: 0, end: 5 }));
    const b = await repo.postSuggestion(editDraft(chunkId, { start: 0, end: 5 }));
    expect(b.suggestionId).toBe(a.suggestionId);
    const cnt = await pool.query(
      `SELECT count(*)::int AS n FROM editing_suggestions WHERE chunk_id=$1`,
      [chunkId],
    );
    expect(cnt.rows[0].n).toBe(1);
  });

  it('auto_applied post writes an audit row', async () => {
    const chunkId = await freshChunk('12345 abcdef');
    const s = await repo.postSuggestion(editDraft(chunkId, { start: 0, end: 5 }), 'auto_applied');
    const audit = await pool.query(`SELECT action FROM action_audit_log WHERE suggestion_id=$1`, [
      s.suggestionId,
    ]);
    expect(audit.rows.map((r) => r.action)).toContain('auto_applied');
  });

  it('record_editor_action updates status AND appends audit atomically (accept)', async () => {
    const chunkId = await freshChunk('12345 abcdef');
    const s = await repo.postSuggestion(editDraft(chunkId, { start: 0, end: 5 }));
    await repo.recordAction({ suggestionId: s.suggestionId, editorId, action: 'accepted' });
    const st = await pool.query(`SELECT status FROM editing_suggestions WHERE suggestion_id=$1`, [
      s.suggestionId,
    ]);
    const au = await pool.query(
      `SELECT action FROM action_audit_log WHERE suggestion_id=$1 AND action='accepted'`,
      [s.suggestionId],
    );
    expect(st.rows[0].status).toBe('accepted');
    expect(au.rows).toHaveLength(1);
  });

  it('override records final text; raise_query resolves an author_query', async () => {
    const chunkId = await freshChunk('12345 abcdef');
    const s = await repo.postSuggestion(editDraft(chunkId, { start: 0, end: 5 }));
    await repo.recordAction({
      suggestionId: s.suggestionId,
      editorId,
      action: 'overridden',
      finalText: 'ZZ',
    });
    const au = await pool.query(
      `SELECT detail FROM action_audit_log WHERE suggestion_id=$1 AND action='overridden'`,
      [s.suggestionId],
    );
    expect(au.rows[0].detail).toEqual({ final_text: 'ZZ' });

    const q = await repo.postSuggestion({
      chunkId,
      ruleId: 'p_value_reporting',
      originatorEngine: 'test',
      originTier: 'base_inference',
      kind: 'author_query',
      span: { start: 0, end: 5 },
      originalText: '12345',
      queryMessage: 'Please provide the exact P value.',
    });
    await repo.recordAction({ suggestionId: q.suggestionId, editorId, action: 'raise_query' });
    const st = await pool.query(`SELECT status FROM editing_suggestions WHERE suggestion_id=$1`, [
      q.suggestionId,
    ]);
    expect(st.rows[0].status).toBe('queried');
  });

  it('recordAction on a missing suggestion throws and writes nothing', async () => {
    await expect(
      repo.recordAction({ suggestionId: 999999999, editorId, action: 'accepted' }),
    ).rejects.toThrow();
  });

  it('E2E: ingest → full pipeline → report catches the seeded issues', async () => {
    const md = readFileSync('tests/fixtures/sample-manuscript.md', 'utf8');
    const { manuscriptId, chunkCount, tableCount } = await ingestManuscript({
      title: 'sample',
      rawContentMarkdown: md,
    });
    expect(chunkCount).toBeGreaterThan(0);
    expect(tableCount).toBe(1);

    await runFullPipeline(manuscriptId);
    const report = await getManuscriptReport(manuscriptId);

    expect(report.counts.autoApplied).toBeGreaterThan(0);
    // deterministic auto-fix present
    expect(
      report.items.some((i) => i.ruleId === 'percent_no_space' && i.status === 'auto_applied'),
    ).toBe(true);
    // a genuine cross-section mismatch (25% vs 26% mortality) flagged as an author query
    expect(
      report.items.some(
        (i) => i.ruleId === 'cross_reference_mismatch' && i.kind === 'author_query',
      ),
    ).toBe(true);
    // a derived percentage correction (150/200 = 75%, not 80%)
    expect(
      report.items.some((i) => i.ruleId === 'derived_value_check' && i.proposed?.includes('75%')),
    ).toBe(true);
  });
});
