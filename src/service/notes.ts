/**
 * Service operation: the review-console notes thread (UI-DESIGN §5). Transport-agnostic functions
 * over the ledger DB (AGENT-ARCHITECTURE §5.7) — the console API is a thin adapter over these.
 * A note may be attached to a specific change (suggestion) and carries a routing target
 * (@junior/@senior/@agent, or an unrouted note). When attached to a change, the change's rule is
 * recorded too, so @agent feedback is retrievable per-rule as flywheel signal. Acting on that
 * feedback (adjusting the rule registry) is a separate, gated admin step — not done here.
 */
import { getPool } from '../db/pool.js';

export type NoteRoute = 'note' | 'junior' | 'senior' | 'agent';
const ROUTES: readonly NoteRoute[] = ['note', 'junior', 'senior', 'agent'];

export interface AddNoteInput {
  manuscriptId: string;
  /** The change this note is about (optional). */
  suggestionId?: number;
  editorId: number;
  routedTo: NoteRoute;
  body: string;
}

export interface ReviewNote {
  noteId: number;
  manuscriptId: string;
  suggestionId: number | null;
  ruleId: string | null;
  editorId: number;
  routedTo: NoteRoute;
  body: string;
  createdAt: string;
}

interface Row {
  note_id: number;
  manuscript_id: string;
  suggestion_id: number | null;
  rule_id: string | null;
  editor_id: number;
  routed_to: NoteRoute;
  body: string;
  created_at: Date;
}

const rowToNote = (r: Row): ReviewNote => ({
  noteId: r.note_id,
  manuscriptId: r.manuscript_id,
  suggestionId: r.suggestion_id,
  ruleId: r.rule_id,
  editorId: r.editor_id,
  routedTo: r.routed_to,
  body: r.body,
  createdAt: r.created_at.toISOString(),
});

const SELECT_COLS = `note_id, manuscript_id, suggestion_id, rule_id, editor_id, routed_to, body,
  created_at`;

export async function addNote(input: AddNoteInput): Promise<ReviewNote> {
  const body = input.body.trim();
  if (!body) throw new Error('note body is empty');
  if (!ROUTES.includes(input.routedTo)) throw new Error(`invalid route '${input.routedTo}'`);
  const pool = getPool();

  // If the note is attached to a change, denormalize that change's rule for per-rule retrieval.
  let ruleId: string | null = null;
  if (input.suggestionId !== undefined) {
    const s = await pool.query<{ rule_id: string }>(
      `SELECT rule_id FROM editing_suggestions WHERE suggestion_id=$1`,
      [input.suggestionId],
    );
    if (s.rows.length === 0) throw new Error(`suggestion ${input.suggestionId} not found`);
    ruleId = s.rows[0]!.rule_id;
  }

  const r = await pool.query<Row>(
    `INSERT INTO review_notes (manuscript_id, suggestion_id, rule_id, editor_id, routed_to, body)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${SELECT_COLS}`,
    [input.manuscriptId, input.suggestionId ?? null, ruleId, input.editorId, input.routedTo, body],
  );
  return rowToNote(r.rows[0]!);
}

export async function listNotes(manuscriptId: string): Promise<ReviewNote[]> {
  const r = await getPool().query<Row>(
    `SELECT ${SELECT_COLS} FROM review_notes WHERE manuscript_id=$1 ORDER BY created_at, note_id`,
    [manuscriptId],
  );
  return r.rows.map(rowToNote);
}
