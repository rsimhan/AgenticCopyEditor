/**
 * Blackboard seam (AGENT-ARCHITECTURE §5.1): the ONLY inter-agent channel.
 *
 * Agents/engines emit `SuggestionDraft`s; the ledger persists them non-destructively and appends
 * to the audit log. No agent calls another agent — they coordinate here. This interface is a
 * stable seam; the Postgres implementation is filled in Milestone 5 (post_suggestion) and the
 * writes are idempotent on the de-dupe key below (AGENT-ARCHITECTURE §10).
 */
import type { SuggestionDraft, SuggestionStatus, EditorAction } from '../domain/types.js';

/** Idempotency key so queue retries never duplicate a suggestion (AGENT-ARCHITECTURE §10). */
export interface SuggestionDedupeKey {
  chunkId: number;
  cellId?: number;
  start: number;
  end: number;
  ruleId: string;
  originatorEngine: string;
}

export interface PersistedSuggestion extends SuggestionDraft {
  suggestionId: number;
  status: SuggestionStatus;
  createdAt: string;
}

export interface RecordActionInput {
  suggestionId: number;
  editorId: number;
  action: EditorAction;
  finalText?: string;
}

/**
 * Repository over `editing_suggestions` + `action_audit_log`. Implemented in Milestone 5.
 */
export interface LedgerRepo {
  /**
   * Insert a suggestion (idempotent on the de-dupe key). Validates codepoint span bounds against
   * the target chunk/cell text and rejects out-of-bounds spans. `status` defaults to 'pending';
   * pass 'auto_applied' for context-free deterministic fixes (also writes an auto_applied audit row).
   */
  postSuggestion(draft: SuggestionDraft, status?: SuggestionStatus): Promise<PersistedSuggestion>;

  /** All pending/auto_applied suggestions for a chunk, ordered by start — input to the merge. */
  pendingForChunk(chunkId: number): Promise<PersistedSuggestion[]>;

  /** Apply an editor decision: update status + append the audit row atomically. */
  recordAction(input: RecordActionInput): Promise<void>;
}
