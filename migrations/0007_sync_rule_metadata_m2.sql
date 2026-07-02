-- Up Migration
-- Milestone 2 refined rule metadata (SPEC §5C, AGENT-ARCHITECTURE §5.2): the latin_abbrev_comma
-- handler is context-sensitive (correct only inside parentheses; running-text usage must be
-- reworded), so it is NOT auto-applicable — it posts pending. Sync the registry row to the
-- implemented behavior. Rules are versioned so this evolution is auditable.
UPDATE style_rules
   SET is_auto_applicable = FALSE, version = version + 1, updated_at = CURRENT_TIMESTAMP
 WHERE rule_id = 'latin_abbrev_comma';

-- Down Migration
UPDATE style_rules
   SET is_auto_applicable = TRUE, version = version - 1, updated_at = CURRENT_TIMESTAMP
 WHERE rule_id = 'latin_abbrev_comma';
