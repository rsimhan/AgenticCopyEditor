# House-Rules Curation — 2026-07-03

> **Curation gate (AGENT-ARCHITECTURE §9).** Source: 19 `@agent` rule-feedback notes entered in the
> Review Console by the domain expert (the senior copy editor) against manuscript
> `89166-1430822-1-ED.docx`. This document maps each note to a rule-registry action **before** any
> `style_rules` write, so the registry is never seeded from an unconfirmed reading of free text.
> **Nothing here is applied yet.** Confirm/adjust the mappings and answer the open questions (§4),
> then the ✅-marked rows are encoded via one migration; handlers/LLM-tier follow (§3).

## Legend

- **Type** — `deterministic` (total function over local context) · `reasoning` (LLM tier, needs
  judgment) · `out-of-v1` (semantic prose, explicitly deferred, SPEC).
- **Action** — `activate` (rule exists + handler exists) · `refine-handler` (rule exists, behavior
  needs work) · `new-handler` (new deterministic rule + code) · `new-reasoning-rule` (registry
  description + few-shot; **no code**, LLM tier consumes it) · `defer` (out of scope / future
  specialist).
- **Confirm?** — ✅ mapping looks safe to encode · ⚠️ needs the expert's decision first (see §4).

---

## 1. Already in the engine — her rule confirms it

| # | Her rule | rule_id | Type | Action | Confirm |
|---|---|---|---|---|---|
| 15 | No leading zero for P values (`P .03`) | `no_leading_zero_stats` | deterministic | activate (already implemented, currently *surfaced*) | ✅ |
| 7 | 24h → 12h clock, format `8 AM … midnight` | `time_12hour` | deterministic | refine-handler (output wording: AM/PM, `midnight`/`noon`) | ✅ |

## 2. Maps to an existing rule — needs handler/metadata work

| # | Her rule | rule_id | Type | Action | Confirm |
|---|---|---|---|---|---|
| 13 | P italic; round to 2 dp; keep `P=.045….049`; `P=0`→`P<.001`; `P=1`→`P>.99` | `p_value_reporting` | deterministic (mostly) | refine-handler (rounding + bound mapping; italics) | ⚠️ (italics rendering) |
| 14 | Statistic symbols `W, F, t, z, χ²` in italics | `test_name_format` | deterministic | new-handler (stub today; italic markup) | ⚠️ (italics rendering) |
| 19 | No dots in `et al, ie, eg, Inc, Corp, US, UK` | `latin_abbrev_comma` → extend, or new `abbrev_no_dots` | deterministic | refine-handler / new-handler | ✅ |
| 20 | Use the minus sign (−), not a hyphen, where appropriate | `minus_sign` (**known gap**) | deterministic | new-handler | ✅ |
| 22 | US date style | `date_format_us` (**known gap**) | deterministic | new-handler | ⚠️ (exact target format) |

## 3. New deterministic rules — need new handlers (code)

| # | Her rule | proposed rule_id | Type | Action | Confirm |
|---|---|---|---|---|---|
| 9 | `n (%)` always kept together; hyphen in numeric ranges | `n_percent_together` | deterministic | new-handler | ✅ (see few-shot, §5) |
| 21 | US quotes: double `"…"` with single `'…'` nested | `us_quote_style` | deterministic | new-handler | ✅ |
| 23/24 | Months, days, years always spelled out (not abbreviated) | `date_terms_expanded` | deterministic | new-handler | ⚠️ (overlaps 22) |
| 25 | `hours/minutes/seconds` spelled in running text; `h/min/s` inside parentheses | `time_unit_format` | deterministic | new-handler | ✅ |
| 16 | Hyphen + en dash for open compound modifiers; em dash for parentheticals | `dash_usage` | hybrid (det. + judgment) | new-handler (partial) + reasoning for ambiguous | ⚠️ |
| 18 | US style: prefixes/suffixes closed up, except double vowels & triple consonants | `affix_closed_up` | deterministic (+ exceptions) | new-handler | ⚠️ (exception list) |

## 4. Needs the reasoning (LLM) tier, or out of v1 scope

| # | Her rule | Disposition | Confirm |
|---|---|---|---|
| 8 | Use `n (%)` vs `n/N (%)` by paragraph context (intro sets N, then `n (%)` until a new N) | `new-reasoning-rule` `count_denominator_context` — context-sensitive; capture her worked example as few-shot (§5) | ⚠️ |
| 11 | Abbreviation policy: >3 instances → expand at first occurrence per section (Abstract/main/back), then abbrev; <3 → always expanded | `defer` → the **abbreviation first-mention tracker** specialist (AGENT-ARCH §6, named future competency) | ✅ (defer) |
| 12 | Remove all eponyms | `defer` → needs an eponym list + judgment; reasoning tier | ✅ (defer) |
| 17 | Spelling, US spelling, grammar (subject-verb, tense, prepositions), punctuation consistency | `out-of-v1` — semantic prose, explicitly out of scope (SPEC) | ✅ (defer) |

## 4b. Open questions for the expert (blockers for the ⚠️ rows)

1. **Ranges (note 10 vs existing `negative_range_to`).** Her *"ranges always hyphen"* — does it mean
   hyphen for **positive** ranges but keep **"to"** when a bound is **negative** (current JMIR rule),
   or hyphen everywhere? Her examples (`10-19 years`, `20-29 years`) are all positive.
2. **Italics (13, 14).** The pipeline works on Markdown; italic = `*x*`. OK to emit Markdown italics
   for P and statistic symbols, or is italics a kriyadocs-only instruction (flag, don't rewrite)?
3. **US date format (22) + expansion (23/24).** Confirm the exact target, e.g. `March 3, 2026`
   (month spelled, `M D, YYYY`). Do 22 and 23/24 collapse into one `date_format_us` rule?
4. **Affix exceptions (18).** Provide the closed-up vs hyphenated list (e.g. `nonrandom` vs
   `anti-inflammatory`) so the deterministic handler is safe; otherwise this becomes reasoning-tier.

## 5. Worked examples captured as few-shot (her verbatim edits)

These are training data for the reasoning tier / handler tests (AGENT-ARCH §9: reasoning rule =
description + few-shot). Kept verbatim from notes 8 and 9.

- **`count_denominator_context` (note 8):** "At baseline, 58 staff members completed the
  questionnaire: 28 (48%) from the dementia care unit, 17 (29%) …; leaving 49 (84%) participants in
  the analytic sample: 25 of 49 (51%) …" — i.e. give `n (%)` under the current N; switch to
  `n/N (%)` only when re-anchoring to a different denominator.
- **`n_percent_together` (note 9):** "Among the 49 analyzed participants, 40 (82%) were women and 9
  (18%) were men … 2 (4%) participants were aged 10-19 years … 19 of 49 (39%) were in their 50-59
  years … (n=41, 84%) …" — `n (%)` never split across a line/break; ranges use a hyphen.

## 6. Proposed registry migration (only after §4 is answered)

A single `0014_house_rules_from_expert` migration would:
- **activate** `no_leading_zero_stats` (15); no row change needed for `time_12hour` (7, handler-only).
- **add reasoning-rule rows** (description + `is_deterministic=false`) for: `count_denominator_context`
  (8), plus register the deferred ones as inactive placeholders so they're tracked, not lost:
  `abbreviation_tracker` (11), `eponym_removal` (12).
- **add deterministic-rule rows** (`is_deterministic=true`, `is_auto_applicable=false` until proven)
  for: `abbrev_no_dots` (19), `minus_sign` (20), `date_format_us` (22), `n_percent_together` (9),
  `us_quote_style` (21), `date_terms_expanded` (23/24), `time_unit_format` (25), `dash_usage` (16),
  `affix_closed_up` (18) — each paired with a handler in a follow-up (the registry↔handler sync test
  will fail until the handler exists, so rows land **with** their handlers, rule-by-rule).
- note 17 is **not** added (out of v1 scope).

> Handler implementation is incremental after the rows land: buckets ①/② first (cheapest, highest
> confidence), then ③, with ④ waiting on the LLM tier. Each rule graduates `surface → auto_applied`
> per §8.1 as its accuracy is proven on her gold edits.
