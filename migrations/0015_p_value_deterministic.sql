-- Up Migration
-- Batch 3 (curation note 13): p_value_reporting becomes a deterministic handler — italicize P and
-- normalize the value (2 dp; keep 3 dp in the .045–.049 significance band; P=0→P<.001, P=1→P>.99;
-- < / > thresholds kept; no leading zero). Flip is_deterministic to match the code handler and bump
-- the version so the change is auditable (§10). is_auto_applicable stays FALSE (surfaced, not
-- auto-applied). The author-query aspect (requesting an exact P when only "P<.05" is given) is a
-- separate future concern, not this rule.
UPDATE style_rules
   SET is_deterministic = TRUE,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP,
       description = 'Italicize P; = values to 2 dp (keep 3 dp in the .045–.049 significance band); P=0→P<.001, P=1→P>.99, =values <.001→<.001 and >.99→>.99; < / > thresholds kept; no leading zero.'
 WHERE rule_id = 'p_value_reporting';

-- Down Migration
UPDATE style_rules
   SET is_deterministic = FALSE,
       version = version - 1,
       updated_at = CURRENT_TIMESTAMP,
       description = 'Report P<.001 and P>.99 at bounds; P to 2 decimals with exceptions; exact P preferred (exact value may require an author query).'
 WHERE rule_id = 'p_value_reporting';
