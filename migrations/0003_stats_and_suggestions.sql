-- Up Migration
-- Ground-truth statistics registry + non-destructive editing suggestions (SPEC §4 parts 4–5).

CREATE TABLE extracted_statistics (
    stat_id                 INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    manuscript_id           UUID NOT NULL REFERENCES manuscripts(manuscript_id) ON DELETE CASCADE,
    source_chunk_id         INT  NOT NULL REFERENCES manuscript_chunks(chunk_id) ON DELETE CASCADE,
    -- Address the exact table cell for values inside tables; NULL for prose-sourced stats.
    source_cell_id          INT  REFERENCES table_cells(cell_id) ON DELETE CASCADE,
    location_context        VARCHAR(50) NOT NULL
        CHECK (location_context IN ('abstract', 'body_prose', 'table_header', 'table_cell', 'figure')),
    stat_type               VARCHAR(50) NOT NULL
        CHECK (stat_type IN ('p_value','mean','mean_difference','percentage',
                             'proportion','ci_bound','sample_size','test_statistic','other')),
    logical_key             VARCHAR(120),
    raw_value_string        VARCHAR(100) NOT NULL,
    numeric_value_primary   NUMERIC,
    numeric_value_secondary NUMERIC,
    -- Codepoint offsets (Principle 8), relative to cell_text when source_cell_id is set,
    -- otherwise relative to source chunk_text.
    char_start_index        INT NOT NULL,
    char_end_index          INT NOT NULL
);
CREATE INDEX idx_extracted_stats_key ON extracted_statistics (manuscript_id, logical_key);

CREATE TABLE editing_suggestions (
    suggestion_id     INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chunk_id          INT NOT NULL REFERENCES manuscript_chunks(chunk_id) ON DELETE CASCADE,
    -- For table-scoped suggestions; spans are then relative to cell_text.
    cell_id           INT REFERENCES table_cells(cell_id) ON DELETE CASCADE,
    rule_id           VARCHAR(50) NOT NULL REFERENCES style_rules(rule_id) ON DELETE RESTRICT,
    originator_engine VARCHAR(100) NOT NULL,
    origin_tier       VARCHAR(20) NOT NULL
        CHECK (origin_tier IN ('deterministic', 'verified_memory', 'base_inference')),
    -- 'author_query' = fix needs data not in the manuscript; proposed_text is NULL.
    kind              VARCHAR(20) NOT NULL DEFAULT 'edit'
        CHECK (kind IN ('edit', 'author_query')),
    char_start_index  INT NOT NULL,
    char_end_index    INT NOT NULL,
    original_text     TEXT NOT NULL,
    proposed_text     TEXT,
    confidence        NUMERIC,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','auto_applied','accepted','rejected','overridden','superseded','queried')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (char_end_index >= char_start_index),
    -- an edit must propose text; an author_query must not
    CHECK ((kind = 'edit' AND proposed_text IS NOT NULL)
        OR (kind = 'author_query' AND proposed_text IS NULL))
);
CREATE INDEX idx_suggestions_chunk ON editing_suggestions (chunk_id, char_start_index);

-- Down Migration
DROP TABLE IF EXISTS editing_suggestions;
DROP TABLE IF EXISTS extracted_statistics;
