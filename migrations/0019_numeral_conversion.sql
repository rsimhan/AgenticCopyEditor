-- Up Migration
-- numeral_conversion (curation note 9 / UAT gap: "five" -> "5"). A hybrid rule: deterministic
-- detection of spelled cardinal numbers, but the keep-or-convert decision is context-sensitive
-- (sentence-initial and idiomatic numbers stay spelled), so it routes to the reasoning tier
-- (is_deterministic=false). Posts pending; runs only when an LLM provider is configured.
INSERT INTO style_rules (rule_id, section, description, is_deterministic, is_auto_applicable, scope) VALUES
    ('numeral_conversion', 'Numbers',
     'Spelled-out cardinal numbers become numerals in reporting (five -> 5), except sentence-initial or idiomatic numbers. Context-sensitive; resolved by the reasoning tier.',
     FALSE, FALSE, 'span');

-- Down Migration
DELETE FROM style_rules WHERE rule_id = 'numeral_conversion';
