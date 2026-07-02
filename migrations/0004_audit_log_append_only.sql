-- Up Migration
-- Append-only action audit ledger + a trigger enforcing immutability (SPEC §4 part 6, §4 notes).

CREATE TABLE action_audit_log (
    audit_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    suggestion_id INT REFERENCES editing_suggestions(suggestion_id) ON DELETE SET NULL,
    chunk_id      INT REFERENCES manuscript_chunks(chunk_id) ON DELETE SET NULL,
    rule_id       VARCHAR(50) REFERENCES style_rules(rule_id),
    editor_id     INT REFERENCES editors(editor_id),
    action        VARCHAR(20) NOT NULL
        CHECK (action IN ('auto_applied','proposed','accepted','rejected','overridden','raise_query')),
    detail        JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_rule_time ON action_audit_log (rule_id, created_at);

-- Enforce append-only: any UPDATE or DELETE raises. This is the source of truth for flywheel
-- metrics; only INSERT/SELECT are legitimate.
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'action_audit_log is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_append_only
    BEFORE UPDATE OR DELETE ON action_audit_log
    FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

-- Down Migration
DROP TRIGGER IF EXISTS trg_audit_append_only ON action_audit_log;
DROP FUNCTION IF EXISTS reject_audit_mutation();
DROP TABLE IF EXISTS action_audit_log;
