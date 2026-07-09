-- Up Migration
-- Curation note 10 (clarified: hyphens for ranges): numeric ranges take a tight hyphen. Normalizes
-- an en/em dash or a spaced hyphen between two digits to '-'. Negative ranges keep "to"
-- (negative_range_to), so this only fires with a digit on the left. Deterministic, posts pending.
INSERT INTO style_rules (rule_id, section, description, is_deterministic, is_auto_applicable, scope) VALUES
    ('range_hyphen', 'Ranges',
     'Numeric ranges take a tight hyphen: normalize an en/em dash or a spaced hyphen between digits to "-" (2825-2836, 5-7). A plain tight hyphen is already correct; negative ranges keep "to".',
     TRUE, FALSE, 'span');

-- Down Migration
DELETE FROM style_rules WHERE rule_id = 'range_hyphen';
