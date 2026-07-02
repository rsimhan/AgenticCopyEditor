-- Up Migration
-- Manuscript master record, chunk segments, and structured table model (SPEC §4 parts 2–3.1).

CREATE TABLE manuscripts (
    manuscript_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title                TEXT,
    raw_content_markdown TEXT NOT NULL,
    status               VARCHAR(30) NOT NULL DEFAULT 'ingested'
        CHECK (status IN ('ingested', 'processing', 'review', 'completed', 'failed')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE manuscript_chunks (
    chunk_id       INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    manuscript_id  UUID NOT NULL REFERENCES manuscripts(manuscript_id) ON DELETE CASCADE,
    section_name   VARCHAR(100) NOT NULL,
    sequence_order INT NOT NULL,
    chunk_type     VARCHAR(20) NOT NULL DEFAULT 'prose'
        CHECK (chunk_type IN ('prose', 'table')),
    chunk_text     TEXT NOT NULL,
    UNIQUE (manuscript_id, sequence_order)
);

-- 3.1 Structured table model — tables are first-class (SPEC §4).
CREATE TABLE manuscript_tables (
    table_id      INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    manuscript_id UUID NOT NULL REFERENCES manuscripts(manuscript_id) ON DELETE CASCADE,
    chunk_id      INT NOT NULL REFERENCES manuscript_chunks(chunk_id) ON DELETE CASCADE,
    caption       TEXT,
    n_rows        INT NOT NULL,
    n_cols        INT NOT NULL
);

CREATE TABLE table_cells (
    cell_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_id  INT NOT NULL REFERENCES manuscript_tables(table_id) ON DELETE CASCADE,
    row_idx   INT NOT NULL,
    col_idx   INT NOT NULL,
    is_header BOOLEAN NOT NULL DEFAULT FALSE,
    cell_text TEXT NOT NULL,
    UNIQUE (table_id, row_idx, col_idx)
);
CREATE INDEX idx_table_cells_lookup ON table_cells (table_id, row_idx, col_idx);

-- Down Migration
DROP TABLE IF EXISTS table_cells;
DROP TABLE IF EXISTS manuscript_tables;
DROP TABLE IF EXISTS manuscript_chunks;
DROP TABLE IF EXISTS manuscripts;
