-- Up Migration
-- Extensions + identity/registry tables (SPEC §4 parts 0–1).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- 0. Editors / Users (identity for feedback + audit)
CREATE TABLE editors (
    editor_id    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    display_name TEXT NOT NULL,
    email        TEXT UNIQUE NOT NULL,
    role         VARCHAR(20) NOT NULL DEFAULT 'editor'
        CHECK (role IN ('editor', 'admin')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 1. Editorial Style Rules Registry
CREATE TABLE style_rules (
    rule_id            VARCHAR(50) PRIMARY KEY,
    section            VARCHAR(100) NOT NULL,
    description        TEXT NOT NULL,
    is_deterministic   BOOLEAN NOT NULL DEFAULT FALSE,
    -- Auto-apply is per-rule, decoupled from tier (SPEC §2/§5C).
    is_auto_applicable BOOLEAN NOT NULL DEFAULT FALSE,
    -- Scope drives which pipeline stage owns the rule (SPEC §5).
    scope              VARCHAR(20) NOT NULL DEFAULT 'span'
        CHECK (scope IN ('span', 'section', 'document', 'table')),
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    version            INT NOT NULL DEFAULT 1,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Down Migration
DROP TABLE IF EXISTS style_rules;
DROP TABLE IF EXISTS editors;
-- Extensions are left in place (may be shared); dropping them is intentionally omitted.
