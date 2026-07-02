-- Up Migration
-- Curation-gated feedback memory, polymorphic vector store, per-stat-type precision policy
-- (SPEC §4 parts 7–9).

CREATE TABLE feedback_memory_records (
    memory_id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rule_id               VARCHAR(50) NOT NULL REFERENCES style_rules(rule_id) ON DELETE RESTRICT,
    editor_id             INT NOT NULL REFERENCES editors(editor_id),
    source_suggestion_id  INT REFERENCES editing_suggestions(suggestion_id) ON DELETE SET NULL,
    original_span_text    TEXT NOT NULL,
    editor_corrected_text TEXT NOT NULL,
    editor_rationale      TEXT,
    is_verified           BOOLEAN NOT NULL DEFAULT FALSE,
    verified_by           INT REFERENCES editors(editor_id),
    verified_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_memory_active ON feedback_memory_records (rule_id, is_verified);

-- Polymorphic vector store: dimension-agnostic so an embedding-model swap needs no migration.
-- The unindexed VECTOR column means exact KNN over the small rule-filtered candidate set.
CREATE TABLE feedback_memory_vectors (
    vector_id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    memory_id         INT NOT NULL REFERENCES feedback_memory_records(memory_id) ON DELETE CASCADE,
    embedding_model   VARCHAR(100) NOT NULL,
    vector_dimensions INT NOT NULL,
    vector_data       VECTOR NOT NULL
);
CREATE INDEX idx_feedback_vectors_lookup
    ON feedback_memory_vectors (embedding_model, vector_dimensions, memory_id);

-- Per-stat-type precision & rounding policy for reconciliation (avoids false mismatches).
CREATE TABLE stat_precision_policy (
    stat_type            VARCHAR(50) PRIMARY KEY,
    decimal_places       INT,
    keep_first_sig_digit BOOLEAN NOT NULL DEFAULT FALSE,
    strip_trailing_zero  BOOLEAN NOT NULL DEFAULT FALSE,
    tolerance_rule       TEXT NOT NULL
);

-- Down Migration
DROP TABLE IF EXISTS stat_precision_policy;
DROP TABLE IF EXISTS feedback_memory_vectors;
DROP TABLE IF EXISTS feedback_memory_records;
