# Architecture Review — Spec vs. Real Guidelines

> Written 2026-07-02 after reading both source guidelines
> (`userinputfiles/Guidelines for Reporting Statistics.docx`,
> `userinputfiles/JMIR House style guidelines.docx`). The SPEC is treated as a
> starting point, not a contract. This document records where the spec's
> architecture holds, where it strains, and the recommended changes.

## Verdict in one line

The **data-flow backbone is sound** (non-destructive span suggestions, append-only
audit, curation-gated memory, single Postgres). But the spec's **rule model is too
flat** for what the guidelines actually demand: it assumes most rules are
*local, context-free, char-span, auto-applicable* fixes. The real rules are a
spectrum — local vs. document-wide, deterministic vs. context-sensitive,
fixable vs. author-query-only, prose vs. tabular. Five structural additions are
needed before Milestone 1 freezes the schema.

---

## What holds well (keep as-is)

- **Non-destructive, span-scoped suggestions over immutable text.** Correct core
  choice; parallel engines can't corrupt shared text.
- **Append-only `action_audit_log`.** Right source of truth for flywheel metrics,
  separate from mutable suggestion status.
- **Curation gate on feedback memory.** Prevents prompt poisoning; important and
  correct.
- **Single Postgres + pgvector; unindexed polymorphic vectors at this volume.**
  Fine. Gemini embeddings drop in as a config value (`embedding_model`), exactly
  what the polymorphic store was for.
- **Merge engine with interval splitting.** Right in principle (but see #4 —
  precedence needs rework).

---

## Structural problems (must address)

### 1. No "author query" / flag-only suggestion class
The guidelines repeatedly require *raising a query to the author*, not applying an
edit: exact P value not derivable from prose ("P<.05" needs the real value),
percentages missing their `n/N`, tables missing absolute values, cross-section
mismatches the system can't adjudicate. The spec's action model is only
**accept / reject / override**, and every suggestion carries a `proposed_text`.
There is no state for "flagged, not machine-fixable, needs author input."

**Change:** allow `proposed_text` to be null; add suggestion `kind` ∈
{`edit`, `author_query`}; add editor action `raise_query` and suggestion status
`queried`. Author queries are a first-class output, not an edit.

### 2. Auto-apply must be per-rule, not per-tier
The spec auto-applies **all** `origin_tier='deterministic'` suggestions. But several
"deterministic" rules are context-sensitive and will misfire:
- **Leading-zero exception** for P/α/β: `.05→0.05` is *correct* for a proportion
  but *wrong* for an α level. Detecting the statistic type from surrounding text is
  not always regex-safe.
- **Operator spacing "except in equations"**: §6 requires spaces around `=` in
  equations; prose requires none. Same characters, opposite fix. A regex cannot
  reliably tell prose from equation → auto-apply would corrupt equations.

**Change:** add `style_rules.is_auto_applicable BOOLEAN`. Only context-free rules
(thousands separator, `%` spacing, trailing-zero-on-whole-percent) auto-apply.
Context-sensitive ones post as `pending` even though they're deterministic.
Decouple auto-apply from `origin_tier`.

### 3. Tables are first-class in the guidelines but second-class in the schema
A large share of rules are *tabular*: `n (%)` format, "% sign only in the header,"
absolute values required in table bodies, df in parentheses in tables vs. subscript
in text, and "if any range in a table is negative, all ranges in that table use
'to'." The schema models a manuscript as prose chunks (`chunk_text TEXT`) with char
offsets; `extracted_statistics.location_context` knows 'table_cell'/'table_header'
but there is **no table geometry** (which table, row, column). Table-scoped
consistency and header/body rules are near-impossible on a flattened text blob.

**Change:** add a structured table representation (e.g. `manuscript_tables` +
`table_cells` with `table_id, row_idx, col_idx, is_header`), and let suggestions /
statistics reference a cell address, not just a char span in prose.

### 4. Reconciliation is not "deterministic" — it depends on fuzzy `logical_key` alignment
Phase B.1 compares values sharing a `logical_key` across abstract/prose/tables. But
*assigning* a stable `logical_key` ("primary_outcome_mortality_pct") to matching
quantities across 25 pages is semantic entity resolution — recognizing that
"mortality was 25%" and a table cell "50/200" under a "Deaths" column are the same
quantity. That is an **LLM/heuristic task, not deterministic**, yet the spec (a)
runs reconciliation *before* the LLM tier and (b) stamps its output
`origin_tier='deterministic'` — the highest merge precedence. A fuzzy match would
then outrank everything.

**Change:** split reconciliation into two steps — *deterministic numeric/derived
checks* (proportion↔percentage math, CI ordering: genuinely deterministic) vs.
*cross-location value agreement* (depends on fuzzy keying → `base_inference` tier,
posts as `author_query`, never auto-applied). Don't grant fuzzy matches
deterministic authority in the merge.

### 5. Document/section-level consistency is a missing rule class
The spec handles two scopes: local char-span fixes (Phase C) and numeric-value
cross-reference (B.1). But many guideline rules are **"pick one canonical style and
normalize all occurrences"**: consistent decimal places for percentages across the
paper, en-dash-vs-hyphen consistency for negatives, one range style per table,
consistent negative symbol throughout. These can't be decided from a single span —
they need an aggregate pass that (a) infers the document's chosen convention or the
house default, then (b) emits normalization suggestions for the outliers.

**Change:** add a consistency-pass stage (call it Phase B.2 / "normalizers") that
operates on aggregated occurrences and emits span suggestions, distinct from both
local regex fixes and value reconciliation.

---

## Correctness risks (address in implementation)

### 6. Unicode / codepoint offset discipline
The guidelines are saturated with non-ASCII: `–` `−` `≤` `≥` `×` `°C` `χ` `α` `β`
`ρ` `κ` `⋅`. All `char_start_index`/`char_end_index` must be **codepoint-based and
consistent** end-to-end (JS strings are UTF-16 — surrogate pairs for some symbols).
A byte/codeunit/codepoint mismatch silently corrupts every downstream span. Pick one
(codepoint) and enforce it in every engine and in the DB write path.

### 7. Per-stat-type rounding policy is load-bearing (spec open decision #3)
Reconciliation tolerance can't be one global formula. P: 2 dp except <.01; χ²: 1 dp
but keep first significant digit for tiny values (`χ²=0.007`, `χ²<0.001`);
percentages: consistent dp; whole-number %: no trailing zero. Without a per-stat-type
precision policy, reconciliation will raise **false mismatches** (abstract "25%" vs
computed "24.8%") and flood the editor — destroying trust in the highest-value
feature. This is more central than "open decision #3" implies.

### 8. Segmentation must not split statistics or tables
Fixed 250–500-word chunks can split `(95% CI 2.2-4.8)` or a table across a boundary,
breaking extraction and reconciliation. Chunk boundaries must respect
statistical-unit and table integrity.

---

## Design gaps (worth deciding, lower urgency)

### 9. The flywheel only improves the minority (LLM) tier
Overrides feed vector memory, which **only Phase D reads**. But deterministic rules
carry most of the value and volume. An editor rejecting a bad auto-applied fix has
nowhere useful to route that signal except the audit log — the engine never learns.
Consider a deterministic false-positive path: per-`rule_id` audit metrics that flag
rules needing code/exception tuning, and/or a suppression list of known false-positive
patterns. The learning loop should cover the tier that does the most work.

### 10. Vector memory may be over-built for v1
Given how deterministic-heavy the real workload is, the full embed→curate→retrieve
loop is a lot of machinery for the thin LLM tier. Keep it (future-proofing, and the
schema cost is paid), but sequence it last (Milestone 6+) and don't let it gate the
high-ROI deterministic work.

---

## Recommended schema deltas before Milestone 1 freezes

1. `editing_suggestions`: `proposed_text` nullable; add `kind VARCHAR` CHECK
   (`edit`,`author_query`); extend `status` CHECK with `queried`.
2. `style_rules`: add `is_auto_applicable BOOLEAN NOT NULL DEFAULT FALSE`;
   add `scope VARCHAR` CHECK (`span`,`section`,`document`,`table`).
3. New tables: `manuscript_tables`, `table_cells` (table geometry).
4. New table: `stat_precision_policy` (per `stat_type` rounding/precision rules for
   reconciliation).
5. `action_audit_log`: extend `action` CHECK with `raise_query`.
6. Reconciliation output: allow `origin_tier='base_inference'` for fuzzy
   cross-location matches; reserve `deterministic` for pure numeric/derived checks.

## Recommended pipeline deltas

- Phase A: statistic/table-aware segmentation.
- Phase B: extraction returns table geometry; `logical_key` assignment is explicitly
  a heuristic/LLM sub-step, not a deterministic one.
- **Phase B.2 (new):** document/section consistency normalizers.
- Phase C: per-rule `is_auto_applicable`; context-sensitive rules post `pending`.
- Phase E: precedence respects that fuzzy reconciliation ≠ deterministic authority.
