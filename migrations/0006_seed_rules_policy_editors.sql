-- Up Migration
-- Initial seed data (SPEC §9 M1). The style_rules catalog is derived from the two source
-- guidelines; rule handlers (behavior) are implemented in M2 and may refine this metadata.

-- Editors: one admin (operates the curation gate) + one editor.
INSERT INTO editors (display_name, email, role) VALUES
    ('Platform Admin', 'admin@example.com', 'admin'),
    ('Copy Editor',    'editor@example.com', 'editor');

-- Per-stat-type precision policy (drives reconciliation; SPEC §4/§9).
INSERT INTO stat_precision_policy
    (stat_type, decimal_places, keep_first_sig_digit, strip_trailing_zero, tolerance_rule) VALUES
    ('p_value',         2,    FALSE, FALSE, 'Report to 2 dp; P<.001 and P>.99 at bounds; exact P preferred; exceptions when P<.01 or rounding changes significance.'),
    ('mean',            NULL, FALSE, FALSE, 'Match the reported decimal precision of the mean and its variability measure.'),
    ('mean_difference', NULL, FALSE, FALSE, 'Match reported precision; negative sign as an en dash.'),
    ('percentage',      NULL, FALSE, TRUE,  'Consistent dp across the manuscript; whole-number percentages take no trailing zero.'),
    ('proportion',      NULL, FALSE, FALSE, 'n/N rounds to the stated percentage per the percentage policy.'),
    ('ci_bound',        NULL, FALSE, FALSE, 'lower <= point <= upper; match reported precision.'),
    ('sample_size',     0,    FALSE, FALSE, 'Exact integer; thousands separators above 9999.'),
    ('test_statistic',  NULL, TRUE,  FALSE, 'Chi-square to 1 dp but retain the first significant digit for tiny values; t and F to reported precision.'),
    ('other',           NULL, FALSE, FALSE, 'No automatic reconciliation.');

-- Style-rules catalog. Columns default: version=1, is_active=TRUE.
INSERT INTO style_rules (rule_id, section, description, is_deterministic, is_auto_applicable, scope) VALUES
    -- Statistical / numerical (span)
    ('thousands_separator',    'Numbers',              'Integers greater than 9999 take grouping commas (36127 -> 36,127); 6500 is unchanged.', TRUE,  TRUE,  'span'),
    ('percent_no_space',       'Percentages',          'No space before the percent sign (18 % -> 18%).', TRUE,  TRUE,  'span'),
    ('percent_repeat_range',   'Percentages',          'Repeat the percent sign across ranges (15-20% -> 15%-20%).', TRUE,  TRUE,  'span'),
    ('whole_number_percent',   'Percentages',          'Strip trailing .0 from whole-number sample-derived percentages (50/200=25.0% -> 25%).', TRUE,  TRUE,  'span'),
    ('leading_zero',           'Decimals',             'Values less than 1 take a leading zero before the decimal (.7 -> 0.7). Context-sensitive: excludes P/alpha/beta.', TRUE,  FALSE, 'span'),
    ('no_leading_zero_stats',  'Decimals',             'No leading zero for P values, alpha, and beta levels (P 0.03 -> P .03).', TRUE,  FALSE, 'span'),
    ('no_space_operators',     'Equality/Inequality',  'No spaces around = < > <= >= in running prose (P < .001 -> P<.001); keep spaces in equations.', TRUE,  FALSE, 'span'),
    ('gte_lte_symbols',        'Equality/Inequality',  'Use the >= and <= symbols rather than underlined > or <.', TRUE,  FALSE, 'span'),
    ('negative_range_to',      'Ranges',               'If either value in a range is negative, use "to" instead of a hyphen (-3.4-1.1 -> -3.4 to 1.1). Interval-vs-subtraction may need reasoning.', FALSE, FALSE, 'span'),
    ('p_value_reporting',      'P values',             'Report P<.001 and P>.99 at bounds; P to 2 decimals with exceptions; exact P preferred (exact value may require an author query).', FALSE, FALSE, 'span'),
    ('percent_needs_absolute', 'Percentages',          'Percentages in running text must report n/N (75% -> 75% (n=150)); the absolute values may require an author query.', FALSE, FALSE, 'span'),
    ('test_name_format',       'Statistical measures', 'Format test names: italicize and subscript df for t, F, chi-square; Cohen d, Hedges g, etc. (t15=2.68 -> t_15 = 2.68).', FALSE, FALSE, 'span'),
    -- Consistency (document / table)
    ('decimal_places_consistency',   'Decimals', 'Percentages/decimals use a consistent number of decimal places across the manuscript.', TRUE, FALSE, 'document'),
    ('negative_symbol_consistency',  'Numbers',  'Use one consistent negative symbol (en dash) throughout; not a hyphen.', TRUE, FALSE, 'document'),
    ('table_range_style_consistency','Ranges',   'If any range in a table contains a negative value, all ranges in that table use "to".', TRUE, FALSE, 'table'),
    -- Reconciliation
    ('derived_value_check',    'Consistency', 'Deterministic derived checks: n/N equals the stated percentage (per precision policy); CI lower <= point <= upper.', TRUE,  FALSE, 'document'),
    ('cross_reference_mismatch','Consistency','Values sharing a logical key must agree across the abstract, prose, and tables; disagreements are flagged (fuzzy; author query).', FALSE, FALSE, 'document'),
    -- Mechanical house-style (span)
    ('trademark_symbol_removal',    'House style', 'Remove (TM)/(R)/(SM) symbols; capitalize the initial letter of the term instead.', TRUE, TRUE, 'span'),
    ('latin_abbrev_comma',          'House style', 'Latin abbreviations ie and eg take a comma and no periods within parentheses (i.e. -> ie,).', TRUE, TRUE, 'span'),
    ('ellipsis_three_periods',      'House style', 'Use three periods, not the Word ellipsis character.', TRUE, TRUE, 'span'),
    ('term_toward',                 'House style', 'Use "toward", not "towards".', TRUE, TRUE, 'span'),
    ('term_xhealth',                'House style', 'Use eHealth/mHealth/eSource (not e-health, m-health, e-Health).', TRUE, TRUE, 'span'),
    ('currency_us_format',          'Numbers',     'Currency in US$ with a space after the country abbreviation and no trailing zeros (US $99, CAD $125.35).', TRUE, FALSE, 'span'),
    ('temperature_celsius_spacing', 'Units',       'Add a space between the numeral and unit; use Celsius (37.5 -> 37.5 space degC).', TRUE, TRUE, 'span');

-- Down Migration
DELETE FROM style_rules WHERE rule_id IN (
    'thousands_separator','percent_no_space','percent_repeat_range','whole_number_percent',
    'leading_zero','no_leading_zero_stats','no_space_operators','gte_lte_symbols',
    'negative_range_to','p_value_reporting','percent_needs_absolute','test_name_format',
    'decimal_places_consistency','negative_symbol_consistency','table_range_style_consistency',
    'derived_value_check','cross_reference_mismatch',
    'trademark_symbol_removal','latin_abbrev_comma','ellipsis_three_periods','term_toward',
    'term_xhealth','currency_us_format','temperature_celsius_spacing'
);
DELETE FROM stat_precision_policy WHERE stat_type IN (
    'p_value','mean','mean_difference','percentage','proportion','ci_bound',
    'sample_size','test_statistic','other'
);
DELETE FROM editors WHERE email IN ('admin@example.com', 'editor@example.com');
