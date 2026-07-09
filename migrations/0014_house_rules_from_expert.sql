-- Up Migration
-- Encode the domain expert's house-style ruleset into the registry (curation gate;
-- docs/HOUSE-RULES-CURATION-2026-07-03.md). Source: 19 @agent console notes on manuscript
-- 89166-1430822-1-ED.docx. Rules that HAVE a handler in this batch land ACTIVE; the rest are
-- recorded INACTIVE (is_active=false) so her feedback is captured and versioned, then flipped active
-- as their handler / LLM-tier support lands (the registry↔handler sync test only checks active
-- handlers, so inactive rows are inert and safe). Note 17 (spelling/US-spelling/grammar/punctuation)
-- is deliberately NOT added — semantic prose, explicitly out of v1 scope (SPEC).

-- Active now: implemented deterministic handlers (all posts-pending; auto-apply earned later, §8.1).
INSERT INTO style_rules (rule_id, section, description, is_deterministic, is_auto_applicable, scope) VALUES
    ('abbrev_no_dots', 'House style',
     'Drop periods from closed-up abbreviations: et al., Inc., Corp., etc., vs., U.S., U.S.A., U.K. (ie/eg handled by latin_abbrev_comma).',
     TRUE, FALSE, 'span'),
    ('minus_sign', 'Numbers',
     'Use a true minus sign (−, U+2212) not a hyphen for negative values in an unambiguous negative context (after = < > ≤ ≥ ( [ , ). Range hyphens and prose negatives are out of scope here.',
     TRUE, FALSE, 'span'),
    ('date_format_us', 'Dates',
     'US date style: month spelled out, "Month D, YYYY" (March 3, 2026); expand abbreviated months and spell days/years. Numeric slash dates are ambiguous and deferred to reasoning.',
     TRUE, FALSE, 'span');

-- Recorded but inactive: confirmed rules awaiting a handler (deterministic) or the reasoning tier.
INSERT INTO style_rules (rule_id, section, description, is_deterministic, is_auto_applicable, scope, is_active) VALUES
    -- Deterministic, handler pending
    ('us_quote_style', 'House style',
     'US quotes: double "…" as primary, single ''…'' nested. Needs apostrophe-vs-quote disambiguation before it is safe deterministically.',
     TRUE, FALSE, 'span', FALSE),
    ('n_percent_together', 'Numbers',
     'Keep n and (%) together as "n (%)"; hyphen in numeric ranges. (Note 9; worked example captured as few-shot.)',
     TRUE, FALSE, 'span', FALSE),
    ('time_unit_format', 'Units',
     'Spell hours/minutes/seconds in running text; use h, min, s inside parentheses. (Note 25.)',
     TRUE, FALSE, 'span', FALSE),
    ('dash_usage', 'Punctuation',
     'Hyphen and en dash for open compound modifiers; em dash for parenthetical phrases. Hybrid: compound-modifier detection needs judgment. (Note 16.)',
     TRUE, FALSE, 'span', FALSE),
    -- Reasoning tier (context/judgment)
    ('count_denominator_context', 'Numbers',
     'Use n (%) under the current denominator; switch to n/N (%) only when re-anchoring to a new N. Context-sensitive; reasoning tier. (Note 8; worked example is few-shot.)',
     FALSE, FALSE, 'span', FALSE),
    ('affix_closed_up', 'House style',
     'US style: prefixes/suffixes closed up, except double vowels and triple consonants. Needs the expert''s exception list; reasoning tier until then. (Note 18.)',
     FALSE, FALSE, 'span', FALSE),
    -- Deferred future competencies
    ('abbreviation_tracker', 'House style',
     'Abbreviation policy: >3 instances → expand at first occurrence per section (abstract/main/back) then abbreviate; <3 → always expanded. Future document-scope specialist. (Note 11.)',
     FALSE, FALSE, 'document', FALSE),
    ('eponym_removal', 'House style',
     'Remove eponyms (use the non-eponymous term). Needs an eponym list + judgment; reasoning tier. (Note 12.)',
     FALSE, FALSE, 'span', FALSE);

-- Down Migration
DELETE FROM style_rules WHERE rule_id IN (
    'abbrev_no_dots', 'minus_sign', 'date_format_us', 'us_quote_style', 'n_percent_together',
    'time_unit_format', 'dash_usage', 'count_denominator_context', 'affix_closed_up',
    'abbreviation_tracker', 'eponym_removal'
);
