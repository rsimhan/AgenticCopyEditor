/**
 * Postgres implementation of the blackboard write path (LedgerRepo seam, AGENT-ARCHITECTURE §5.1).
 * All suggestion writes are non-destructive and idempotent; editor actions update status and append
 * to the append-only audit log atomically.
 */
import type { PoolClient } from './pool.js';
import { getPool, withTransaction } from './pool.js';
import type { LedgerRepo, PersistedSuggestion, RecordActionInput } from './ledger.js';
import type { SuggestionDraft, SuggestionStatus } from '../domain/types.js';
import { codepointLength, assertValidSpan } from '../util/offsets.js';

interface Row {
  suggestion_id: number;
  chunk_id: number;
  cell_id: number | null;
  rule_id: string;
  originator_engine: string;
  origin_tier: string;
  kind: string;
  char_start_index: number;
  char_end_index: number;
  original_text: string;
  proposed_text: string | null;
  query_message: string | null;
  confidence: string | null;
  status: string;
  created_at: Date;
}

function rowToPersisted(r: Row): PersistedSuggestion {
  return {
    suggestionId: r.suggestion_id,
    chunkId: r.chunk_id,
    ...(r.cell_id !== null ? { cellId: r.cell_id } : {}),
    ruleId: r.rule_id,
    originatorEngine: r.originator_engine,
    originTier: r.origin_tier as PersistedSuggestion['originTier'],
    kind: r.kind as PersistedSuggestion['kind'],
    span: { start: r.char_start_index, end: r.char_end_index },
    originalText: r.original_text,
    ...(r.proposed_text !== null ? { proposedText: r.proposed_text } : {}),
    ...(r.query_message !== null ? { queryMessage: r.query_message } : {}),
    ...(r.confidence !== null ? { confidence: Number(r.confidence) } : {}),
    status: r.status as SuggestionStatus,
    createdAt: r.created_at.toISOString(),
  };
}

const SELECT_COLS = `suggestion_id, chunk_id, cell_id, rule_id, originator_engine, origin_tier,
  kind, char_start_index, char_end_index, original_text, proposed_text, query_message, confidence,
  status, created_at`;

export class PgLedgerRepo implements LedgerRepo {
  async postSuggestion(
    draft: SuggestionDraft,
    status: SuggestionStatus = 'pending',
  ): Promise<PersistedSuggestion> {
    return withTransaction(async (client) => {
      // 1. Validate the span against the target text length (codepoints).
      const targetLen = await this.targetTextLength(client, draft);
      assertValidSpan(draft.span, targetLen);

      // 2. Idempotent insert on the de-dupe key.
      const inserted = await client.query<Row>(
        `INSERT INTO editing_suggestions
           (chunk_id, cell_id, rule_id, originator_engine, origin_tier, kind,
            char_start_index, char_end_index, original_text, proposed_text, query_message,
            confidence, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (chunk_id, COALESCE(cell_id, 0), char_start_index, char_end_index, rule_id, originator_engine)
         DO NOTHING
         RETURNING ${SELECT_COLS}`,
        [
          draft.chunkId,
          draft.cellId ?? null,
          draft.ruleId,
          draft.originatorEngine,
          draft.originTier,
          draft.kind,
          draft.span.start,
          draft.span.end,
          draft.originalText,
          draft.proposedText ?? null,
          draft.queryMessage ?? null,
          draft.confidence ?? null,
          status,
        ],
      );

      if (inserted.rows.length === 0) {
        // Conflict: return the existing row (idempotent).
        const existing = await client.query<Row>(
          `SELECT ${SELECT_COLS} FROM editing_suggestions
            WHERE chunk_id=$1 AND COALESCE(cell_id,0)=COALESCE($2,0)
              AND char_start_index=$3 AND char_end_index=$4 AND rule_id=$5 AND originator_engine=$6`,
          [
            draft.chunkId,
            draft.cellId ?? null,
            draft.span.start,
            draft.span.end,
            draft.ruleId,
            draft.originatorEngine,
          ],
        );
        return rowToPersisted(existing.rows[0]!);
      }

      const row = inserted.rows[0]!;
      // 3. Auto-applied deterministic fixes get an audit row (machine action; editor_id NULL).
      if (status === 'auto_applied') {
        await client.query(
          `INSERT INTO action_audit_log (suggestion_id, chunk_id, rule_id, action)
           VALUES ($1,$2,$3,'auto_applied')`,
          [row.suggestion_id, row.chunk_id, row.rule_id],
        );
      }
      return rowToPersisted(row);
    });
  }

  private async targetTextLength(client: PoolClient, draft: SuggestionDraft): Promise<number> {
    if (draft.cellId !== undefined) {
      const r = await client.query<{ cell_text: string }>(
        `SELECT cell_text FROM table_cells WHERE cell_id=$1`,
        [draft.cellId],
      );
      if (r.rows.length === 0) throw new Error(`table cell ${draft.cellId} not found`);
      return codepointLength(r.rows[0]!.cell_text);
    }
    const r = await client.query<{ chunk_text: string }>(
      `SELECT chunk_text FROM manuscript_chunks WHERE chunk_id=$1`,
      [draft.chunkId],
    );
    if (r.rows.length === 0) throw new Error(`chunk ${draft.chunkId} not found`);
    return codepointLength(r.rows[0]!.chunk_text);
  }

  async pendingForChunk(chunkId: number): Promise<PersistedSuggestion[]> {
    const r = await getPool().query<Row>(
      `SELECT ${SELECT_COLS} FROM editing_suggestions
        WHERE chunk_id=$1 AND status IN ('pending','auto_applied')
        ORDER BY char_start_index, suggestion_id`,
      [chunkId],
    );
    return r.rows.map(rowToPersisted);
  }

  async recordAction(input: RecordActionInput): Promise<void> {
    const map: Record<string, { status: SuggestionStatus; requiresFinal?: boolean }> = {
      accepted: { status: 'accepted' },
      rejected: { status: 'rejected' },
      overridden: { status: 'overridden', requiresFinal: true },
      raise_query: { status: 'queried' },
    };
    const spec = map[input.action];
    if (!spec) throw new Error(`recordAction: unsupported action '${input.action}'`);
    if (spec.requiresFinal && input.finalText === undefined) {
      throw new Error('override requires finalText');
    }

    await withTransaction(async (client) => {
      const sel = await client.query<{ chunk_id: number; rule_id: string }>(
        `SELECT chunk_id, rule_id FROM editing_suggestions WHERE suggestion_id=$1 FOR UPDATE`,
        [input.suggestionId],
      );
      if (sel.rows.length === 0) throw new Error(`suggestion ${input.suggestionId} not found`);
      const { chunk_id, rule_id } = sel.rows[0]!;

      await client.query(`UPDATE editing_suggestions SET status=$2 WHERE suggestion_id=$1`, [
        input.suggestionId,
        spec.status,
      ]);

      const detail = input.finalText !== undefined ? { final_text: input.finalText } : null;
      await client.query(
        `INSERT INTO action_audit_log (suggestion_id, chunk_id, rule_id, editor_id, action, detail)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [input.suggestionId, chunk_id, rule_id, input.editorId, input.action, detail],
      );
      // On override, Milestone 6 enqueues the async reflection job here (feeds the flywheel).
    });
  }
}
