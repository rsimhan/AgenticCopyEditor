-- Up Migration
-- Junior execution status (UI-DESIGN §6): tracked separately from the senior's decision. Juniors
-- transcribe accepted changes into kriyadocs by hand and tick each one off here, so we can show
-- "applied X/Y" progress independently of "reviewed X/Y".
ALTER TABLE editing_suggestions
    ADD COLUMN applied_in_kriyadocs BOOLEAN NOT NULL DEFAULT FALSE;

-- Down Migration
ALTER TABLE editing_suggestions DROP COLUMN IF EXISTS applied_in_kriyadocs;
