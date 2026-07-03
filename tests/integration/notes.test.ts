import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../../src/db/pool.js';
import { PgLedgerRepo } from '../../src/db/ledger-repo.js';
import { addNote, listNotes } from '../../src/service/notes.js';
import type { SuggestionDraft } from '../../src/domain/types.js';

describe('review notes service (NEXT #3)', () => {
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

  async function freshManuscript(text: string): Promise<{ manuscriptId: string; chunkId: number }> {
    // Leave status at the default 'ingested' so these test manuscripts stay OUT of the console
    // picker (which lists status <> 'ingested'); notes don't depend on manuscript status.
    const ms = await pool.query(
      `INSERT INTO manuscripts (raw_content_markdown) VALUES ($1) RETURNING manuscript_id`,
      [text],
    );
    const manuscriptId = ms.rows[0].manuscript_id as string;
    const c = await pool.query(
      `INSERT INTO manuscript_chunks (manuscript_id, section_name, sequence_order, chunk_text)
       VALUES ($1,'Results',0,$2) RETURNING chunk_id`,
      [manuscriptId, text],
    );
    return { manuscriptId, chunkId: c.rows[0].chunk_id as number };
  }

  const editDraft = (chunkId: number): SuggestionDraft => ({
    chunkId,
    ruleId: 'thousands_separator',
    originatorEngine: 'test',
    originTier: 'deterministic',
    kind: 'edit',
    span: { start: 0, end: 5 },
    originalText: '36127',
    proposedText: '36,127',
  });

  it('persists an unattached note and lists it', async () => {
    const { manuscriptId } = await freshManuscript('12345 abcdef');
    const n = await addNote({ manuscriptId, editorId, routedTo: 'note', body: '  hello team  ' });
    expect(n.body).toBe('hello team'); // trimmed
    expect(n.suggestionId).toBeNull();
    expect(n.ruleId).toBeNull();

    const list = await listNotes(manuscriptId);
    expect(list).toHaveLength(1);
    expect(list[0]!.noteId).toBe(n.noteId);
  });

  it('attaches a note to a change and denormalizes that change rule', async () => {
    const { manuscriptId, chunkId } = await freshManuscript('36127 people');
    const s = await repo.postSuggestion(editDraft(chunkId));
    const n = await addNote({
      manuscriptId,
      suggestionId: s.suggestionId,
      editorId,
      routedTo: 'agent',
      body: 'skip IDs like this',
    });
    expect(n.suggestionId).toBe(s.suggestionId);
    expect(n.ruleId).toBe('thousands_separator'); // pulled from the attached suggestion
    expect(n.routedTo).toBe('agent');
  });

  it('orders notes by creation and scopes them to their manuscript', async () => {
    const a = await freshManuscript('aaa');
    const b = await freshManuscript('bbb');
    await addNote({ manuscriptId: a.manuscriptId, editorId, routedTo: 'note', body: 'first' });
    await addNote({ manuscriptId: a.manuscriptId, editorId, routedTo: 'junior', body: 'second' });
    await addNote({ manuscriptId: b.manuscriptId, editorId, routedTo: 'note', body: 'other paper' });

    const listA = await listNotes(a.manuscriptId);
    expect(listA.map((x) => x.body)).toEqual(['first', 'second']);
    const listB = await listNotes(b.manuscriptId);
    expect(listB).toHaveLength(1);
  });

  it('rejects an empty body and an unknown suggestion', async () => {
    const { manuscriptId } = await freshManuscript('x');
    await expect(
      addNote({ manuscriptId, editorId, routedTo: 'note', body: '   ' }),
    ).rejects.toThrow(/empty/);
    await expect(
      addNote({ manuscriptId, suggestionId: 999999999, editorId, routedTo: 'agent', body: 'x' }),
    ).rejects.toThrow(/not found/);
  });
});
