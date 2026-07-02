-- Up Migration
-- Rule refinements from the first UAT run (AGENT-ARCHITECTURE §8.1: autonomy earned per-rule).
-- thousands_separator over-fired on IDs/DOIs/dates (manuscript DOI 95374, Medline IDs, submission
-- date metadata) and was auto-applying them. Demote it to pending until it proves clean on real
-- data. Add two rules the real editor applied that we lacked: thousands_strip and time_12hour.

UPDATE style_rules
   SET is_auto_applicable = FALSE, version = version + 1, updated_at = CURRENT_TIMESTAMP
 WHERE rule_id = 'thousands_separator';

INSERT INTO style_rules (rule_id, section, description, is_deterministic, is_auto_applicable, scope) VALUES
    ('thousands_strip', 'Numbers', 'Remove grouping commas from integers <=9999 (1,076 -> 1076); commas are reserved for values >9999.', TRUE, FALSE, 'span'),
    ('time_12hour', 'Units', 'Report time on the 12-hour clock with AM/PM; 00:00 -> midnight, 12:00 -> noon (14:00 -> 2:00 PM).', TRUE, FALSE, 'span');

-- Down Migration
DELETE FROM style_rules WHERE rule_id IN ('thousands_strip', 'time_12hour');
UPDATE style_rules
   SET is_auto_applicable = TRUE, version = version - 1, updated_at = CURRENT_TIMESTAMP
 WHERE rule_id = 'thousands_separator';
