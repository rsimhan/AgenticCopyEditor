-- Up Migration
-- Idempotency for suggestion writes (AGENT-ARCHITECTURE §10): re-running a phase (queue retry,
-- re-ingest) must not duplicate a suggestion. De-dupe key = (chunk, cell, span, rule, engine).
-- Expression index so a NULL cell_id collapses to 0 (Postgres would otherwise treat NULLs as
-- distinct and defeat the constraint). post_suggestion uses ON CONFLICT on this key.
CREATE UNIQUE INDEX uq_suggestion_dedupe
    ON editing_suggestions (
        chunk_id,
        COALESCE(cell_id, 0),
        char_start_index,
        char_end_index,
        rule_id,
        originator_engine
    );

-- Down Migration
DROP INDEX IF EXISTS uq_suggestion_dedupe;
