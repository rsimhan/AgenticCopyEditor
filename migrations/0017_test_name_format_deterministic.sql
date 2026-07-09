-- Up Migration
-- Curation note 14: test_name_format becomes a deterministic handler that italicizes the statistic
-- symbols W, F, t, z, χ in statistical context. Flip is_deterministic to match the code handler and
-- bump the version (§10). is_auto_applicable stays FALSE (surfaced, not auto-applied). Subscripting
-- the df (t15 -> t_15) remains a later enhancement noted in the description.
UPDATE style_rules
   SET is_deterministic = TRUE,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP,
       description = 'Italicize test-statistic symbols W, F, t, z, χ when followed by an optional df and an operator (t = 2.68 -> *t* = 2.68). Subscripting the df is a later enhancement.'
 WHERE rule_id = 'test_name_format';

-- Down Migration
UPDATE style_rules
   SET is_deterministic = FALSE,
       version = version - 1,
       updated_at = CURRENT_TIMESTAMP,
       description = 'Format test names: italicize and subscript df for t, F, chi-square; Cohen d, Hedges g, etc. (t15=2.68 -> t_15 = 2.68).'
 WHERE rule_id = 'test_name_format';
