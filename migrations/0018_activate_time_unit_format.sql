-- Up Migration
-- Curation note 25: activate time_unit_format now that its handler exists (abbreviate a written-out
-- time unit after a number inside parentheses: 30 minutes → 30 min). The row was recorded inactive
-- in 0014; flip it active so the registry↔handler sync holds. Metadata (deterministic, pending,
-- span) already matches the handler; bump the version for auditability.
UPDATE style_rules
   SET is_active = TRUE, version = version + 1, updated_at = CURRENT_TIMESTAMP
 WHERE rule_id = 'time_unit_format';

-- Down Migration
UPDATE style_rules
   SET is_active = FALSE, version = version - 1, updated_at = CURRENT_TIMESTAMP
 WHERE rule_id = 'time_unit_format';
