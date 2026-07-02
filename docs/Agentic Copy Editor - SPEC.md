# Active-Learning Copy-Editing Platform (HITL) — Build Specification

> **Purpose of this document.** This is a production build specification written to be handed
> directly to Claude Code. It is self-contained: it defines the problem, the data model, the
> processing pipeline, the MCP tool surface, and a phased, test-driven build plan. Read this
> file first, then work the plan in Section 9 top to bottom.
>
> **Target stack (pinned):** PostgreSQL 16+ with the `vector` (pgvector) extension ·
> a **TypeScript / Node.js** worker service for the runtime pipeline · a custom MCP server
> exposing the platform as tools. Embeddings use **Google Gemini** (`gemini-embedding-001`),
> written into the polymorphic vector store as a config value. LLM tiers (ambiguity resolver,
> reflection agent) use **Anthropic Claude**. Claude Code is the *build* environment, not the
> production runtime.
>
> **Revision note (2026-07-02).** This spec was revised after reading the two source
> guidelines (`userinputfiles/`). See `docs/ARCHITECTURE-REVIEW.md` for the rationale and
> Appendix A for the change log. The revisions add an author-query suggestion class,
> per-rule auto-apply gating, a structured table model, reconciliation re-tiering, and a
> document/section consistency pass.

---

## 1. Problem & Intent

The platform is an agentic assistant for copy-language editors. It enforces granular publication
style guides for **statistical, numerical, and mathematical reporting** in scientific manuscripts.

It must:

- Ingest long-form manuscripts up to ~25 pages (~10,000 words).
- Programmatically flag deviations from style protocols.
- Verify quantitative values are consistent across the abstract, body prose, and tables.
- Present suggestions to a human editor as side-by-side diffs (Human-in-the-Loop).
- Learn from editor overrides via a curated feedback flywheel, reducing editor load over time.

### Scope (v1)

The engine enforces two rule families drawn from the source guidelines:

1. **Statistical / numerical reporting** (the core) — from *Guidelines for Reporting Statistics*.
2. **Mechanical house-style** — the *purely deterministic* subset of *JMIR House Style*
   (trademark ™/®/℠ removal, `ie.`/`eg.` → `ie,`/`eg,`, Word ellipsis → three periods,
   controlled-term swaps like `towards→toward` and `e-health→eHealth`, currency `US$`
   spacing and no trailing zeros, temperature `°C` spacing).

### Non-goals (v1)

- Not a general grammar/prose editor. Semantic house-style rules (voice, tense,
  abbreviation-expansion logic, title-case capitalization) are **out of scope**; only the
  mechanical subset above is enforced.
- No autonomous publishing. Every non-trivial change is surfaced to a human.
- **The system does not invent data.** Where a fix requires information not in the manuscript
  (an exact P value, a missing `n/N`, a table's absolute values), it raises an *author query*
  rather than fabricating a value (see the `author_query` suggestion kind).
- No distributed/sharded infrastructure. Single Postgres instance is sufficient at this volume.

---

## 2. Core Design Principles

1. **Deterministic-first.** Mechanical formatting (spacing, thousands separators, trailing-zero
   stripping, percentage recomputation) is handled by a regex/string engine. LLM calls are
   reserved for genuine semantic ambiguity. This is the primary cost and accuracy lever.
   *Being deterministic does not imply being auto-applicable:* some deterministic rules are
   context-sensitive (the leading-zero exception for P/α/β; operator spacing that must be kept
   in equations but stripped in prose) and post as `pending` for review. Auto-apply is a
   per-rule property (`style_rules.is_auto_applicable`), not a property of the tier — see §5C.
2. **Non-destructive delta tracking.** Every edit is a character-span *suggestion*, never an
   in-place overwrite of the manuscript. Parallel analyzers cannot corrupt shared text.
3. **Append-only audit trail.** Editor actions (accept/reject/override) and engine actions are
   recorded in an immutable ledger, separate from mutable suggestion state, so the flywheel can
   be measured and the pipeline audited.
4. **Curation-gated memory.** Lessons learned from overrides are stored as vectors but are
   inert until a human reviewer verifies them. The production context library is never fed
   unverified, potentially-hallucinated lessons.
5. **Unified Postgres.** Relational state, normalized statistics, and vector memory live in one
   ACID boundary. No MongoDB/Pinecone split; no cross-store synchronization drift.
6. **Build-time vs. run-time separation.** Claude Code builds and tests this system. The
   production pipeline runs as a queue-driven worker service that *calls* the MCP tools; it is
   not orchestrated by an interactive developer tool.
7. **Rules span four scopes, not one.** A rule's `scope` is `span` (local, e.g. `%` spacing),
   `section` / `document` (consistency, e.g. uniform decimal places or negative-symbol style),
   or `table` (e.g. `n (%)` format, "% only in header"). The engine has a distinct stage per
   scope (§5): local regex, aggregate consistency normalizers, and table-aware checks. A flat
   span-only model cannot express "this fix is forced by a sibling elsewhere."
8. **Codepoint-exact offsets.** All character indices are Unicode **codepoint** offsets into the
   immutable original text — never byte or UTF-16 code-unit offsets. The guidelines are
   non-ASCII-heavy (`– − ≤ ≥ × °C χ α β ρ κ`); one offset-basis mistake silently corrupts every
   downstream span. Every engine and the DB write path use the same basis.

---

## 3. High-Level Dataflow

```
[ Manuscript upload ]
        │
        ▼
Phase A — Ingestion & Segmentation ──► manuscript_chunks
        │
        ▼
Phase B — Statistical Extraction ─────► extracted_statistics (ground-truth registry)
        │
        ├──► Cross-Reference Reconciliation ──► editing_suggestions (mismatch flags)
        │
        ▼
Phase C — Deterministic Pre-Fix Engine ──► editing_suggestions (regex_engine_v1)
        │
        ▼
Phase D — Ambiguous Fallback (Thin LLM) ──► editing_suggestions (llm_* engines)
        │        ▲
        │        └── retrieve_curated_lessons (few-shot from verified memory)
        ▼
Phase E — Merge & Arbitration Engine ──► reconciled, non-overlapping suggestion set
        │
        ▼
Phase F — Editor Dashboard (HITL) ── accept / reject / override
        │                                   │
        │                                   ▼ (on override)
        │                         Async Reflection Agent
        │                                   │
        ▼                                   ▼
   action_audit_log            feedback_memory_records (is_verified = FALSE)
                                            │
                                   Curation Gate (admin review)
                                            │
                                            ▼
                              feedback_memory_records (is_verified = TRUE) + vectors
```

---

## 4. Database Schema (DDL)

The schema is the contract. Generate migrations from this; do not deviate without updating
this section. All enum-like columns are constrained with `CHECK` so integrity is enforced at the
database, not just in application code.

```sql
-- ============================================================
-- Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 0. Editors / Users (identity for feedback + audit)
-- ============================================================
CREATE TABLE editors (
    editor_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    display_name TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    role        VARCHAR(20) NOT NULL DEFAULT 'editor'
        CHECK (role IN ('editor', 'admin')),   -- 'admin' may operate the curation gate
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 1. Editorial Style Rules Registry
-- ============================================================
CREATE TABLE style_rules (
    rule_id          VARCHAR(50) PRIMARY KEY,       -- e.g. 'range_negative', 'p_value_leading_zero'
    section          VARCHAR(100) NOT NULL,         -- e.g. 'Ranges', 'P-values', 'Percentages'
    description      TEXT NOT NULL,                 -- Rule text used for LLM context injection
    is_deterministic BOOLEAN NOT NULL DEFAULT FALSE,-- TRUE if enforceable by pure regex/code
    -- Auto-apply is a PER-RULE property, decoupled from tier. A rule may be deterministic yet
    -- context-sensitive (leading-zero exception for P/α/β; operator spacing in equations) and
    -- therefore NOT auto-applicable. Only is_auto_applicable=TRUE rules bypass editor review.
    is_auto_applicable BOOLEAN NOT NULL DEFAULT FALSE,
    -- Scope drives which pipeline stage owns the rule (§5): span=local regex,
    -- section/document=consistency normalizer, table=table-aware check.
    scope            VARCHAR(20) NOT NULL DEFAULT 'span'
        CHECK (scope IN ('span','section','document','table')),
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    version          INT NOT NULL DEFAULT 1,        -- bump when rule text changes
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 2. Manuscript Master Record
-- ============================================================
CREATE TABLE manuscripts (
    manuscript_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title         TEXT,
    raw_content_markdown TEXT NOT NULL,
    status        VARCHAR(30) NOT NULL DEFAULT 'ingested'
        CHECK (status IN ('ingested', 'processing', 'review', 'completed', 'failed')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 3. Document Chunk Segments
-- ============================================================
CREATE TABLE manuscript_chunks (
    chunk_id      INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    manuscript_id UUID NOT NULL REFERENCES manuscripts(manuscript_id) ON DELETE CASCADE,
    section_name  VARCHAR(100) NOT NULL,            -- 'Abstract', 'Methods', 'Results', ...
    sequence_order INT NOT NULL,
    chunk_type    VARCHAR(20) NOT NULL DEFAULT 'prose'  -- prose chunks vs. table placeholders
        CHECK (chunk_type IN ('prose','table')),
    chunk_text    TEXT NOT NULL,
    UNIQUE (manuscript_id, sequence_order)
);

-- ============================================================
-- 3.1 Structured Table Model
--     Tables are first-class: many rules are table-scoped (n (%) format,
--     "% only in header", per-table range-style consistency, df in parentheses).
--     A flattened text blob cannot express cell geometry; this can.
-- ============================================================
CREATE TABLE manuscript_tables (
    table_id      INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    manuscript_id UUID NOT NULL REFERENCES manuscripts(manuscript_id) ON DELETE CASCADE,
    chunk_id      INT NOT NULL REFERENCES manuscript_chunks(chunk_id) ON DELETE CASCADE,
    caption       TEXT,
    n_rows        INT NOT NULL,
    n_cols        INT NOT NULL
);

CREATE TABLE table_cells (
    cell_id       INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_id      INT NOT NULL REFERENCES manuscript_tables(table_id) ON DELETE CASCADE,
    row_idx       INT NOT NULL,                     -- 0-based
    col_idx       INT NOT NULL,                     -- 0-based
    is_header     BOOLEAN NOT NULL DEFAULT FALSE,
    cell_text     TEXT NOT NULL,
    UNIQUE (table_id, row_idx, col_idx)
);
CREATE INDEX idx_table_cells_lookup ON table_cells (table_id, row_idx, col_idx);

-- ============================================================
-- 4. Normalized Ground-Truth Statistical Extraction
--    Populated in Phase B; read by the reconciliation step.
-- ============================================================
CREATE TABLE extracted_statistics (
    stat_id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    manuscript_id   UUID NOT NULL REFERENCES manuscripts(manuscript_id) ON DELETE CASCADE,
    source_chunk_id INT  NOT NULL REFERENCES manuscript_chunks(chunk_id) ON DELETE CASCADE,
    -- For values inside tables, address the exact cell so table-scoped rules and
    -- header/body distinctions work. NULL for prose-sourced statistics.
    source_cell_id  INT  REFERENCES table_cells(cell_id) ON DELETE CASCADE,
    location_context VARCHAR(50) NOT NULL
        CHECK (location_context IN ('abstract', 'body_prose', 'table_header', 'table_cell', 'figure')),
    stat_type       VARCHAR(50) NOT NULL
        CHECK (stat_type IN ('p_value','mean','mean_difference','percentage',
                             'proportion','ci_bound','sample_size','test_statistic','other')),
    -- logical_key groups values that MUST agree across locations
    -- (e.g. 'primary_outcome_mortality_pct'). Reconciliation compares within a key.
    logical_key     VARCHAR(120),
    raw_value_string VARCHAR(100) NOT NULL,          -- exactly as it appears in the text
    numeric_value_primary NUMERIC,                   -- parsed value for math verification
    numeric_value_secondary NUMERIC,                 -- optional (e.g. CI upper bound, denominator)
    -- Codepoint offsets (see Principle 8). Relative to source cell_text when
    -- source_cell_id is set, otherwise relative to the source chunk_text.
    char_start_index INT NOT NULL,
    char_end_index   INT NOT NULL
);
CREATE INDEX idx_extracted_stats_key ON extracted_statistics (manuscript_id, logical_key);

-- ============================================================
-- 5. Non-Destructive Span-Scoped Editing Suggestions
--    All engines (regex, LLM, reconciler) write here.
-- ============================================================
CREATE TABLE editing_suggestions (
    suggestion_id    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chunk_id         INT NOT NULL REFERENCES manuscript_chunks(chunk_id) ON DELETE CASCADE,
    -- For table-scoped suggestions, address the cell; spans are then relative to cell_text.
    cell_id          INT REFERENCES table_cells(cell_id) ON DELETE CASCADE,
    rule_id          VARCHAR(50) NOT NULL REFERENCES style_rules(rule_id) ON DELETE RESTRICT,
    originator_engine VARCHAR(100) NOT NULL,         -- 'regex_engine_v1','reconciler_v1','llm_boundary_linter'
    origin_tier      VARCHAR(20) NOT NULL            -- drives merge precedence (see Section 6)
        CHECK (origin_tier IN ('deterministic','verified_memory','base_inference')),
    -- kind distinguishes an applyable edit from a flag the system cannot fix itself.
    -- 'author_query' = the fix needs information not in the manuscript (exact P value,
    -- missing n/N, a table's absolute values); proposed_text is NULL and the editor's
    -- action is to raise the query, not apply an edit.
    kind             VARCHAR(20) NOT NULL DEFAULT 'edit'
        CHECK (kind IN ('edit','author_query')),
    char_start_index INT NOT NULL,                   -- codepoint offset (Principle 8), rel. to chunk_text or cell_text
    char_end_index   INT NOT NULL,
    original_text    TEXT NOT NULL,
    proposed_text    TEXT,                            -- NULL iff kind = 'author_query'
    confidence       NUMERIC,                         -- optional; 0..1 for LLM tiers
    status           VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','auto_applied','accepted','rejected','overridden','superseded','queried')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (char_end_index >= char_start_index),
    -- an edit must propose text; an author_query must not
    CHECK ((kind = 'edit' AND proposed_text IS NOT NULL)
        OR (kind = 'author_query' AND proposed_text IS NULL))
);
CREATE INDEX idx_suggestions_chunk ON editing_suggestions (chunk_id, char_start_index);

-- ============================================================
-- 6. Append-Only Action Audit Ledger
--    Immutable. The flywheel and platform analytics read from here.
--    Never UPDATE this table; only INSERT.
-- ============================================================
CREATE TABLE action_audit_log (
    audit_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    suggestion_id INT REFERENCES editing_suggestions(suggestion_id) ON DELETE SET NULL,
    chunk_id      INT REFERENCES manuscript_chunks(chunk_id) ON DELETE SET NULL,
    rule_id       VARCHAR(50) REFERENCES style_rules(rule_id),
    editor_id     INT REFERENCES editors(editor_id),   -- NULL for machine actions
    action        VARCHAR(20) NOT NULL
        CHECK (action IN ('auto_applied','proposed','accepted','rejected','overridden','raise_query')),
    detail        JSONB,                                -- e.g. {"final_text": "...", "diff": "..."}
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_rule_time ON action_audit_log (rule_id, created_at);

-- ============================================================
-- 7. Feedback Memory Master Record (curation-gated)
-- ============================================================
CREATE TABLE feedback_memory_records (
    memory_id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rule_id            VARCHAR(50) NOT NULL REFERENCES style_rules(rule_id) ON DELETE RESTRICT,
    editor_id          INT NOT NULL REFERENCES editors(editor_id),
    source_suggestion_id INT REFERENCES editing_suggestions(suggestion_id) ON DELETE SET NULL,
    original_span_text TEXT NOT NULL,                  -- sentence/span granularity
    editor_corrected_text TEXT NOT NULL,
    editor_rationale   TEXT,
    is_verified        BOOLEAN NOT NULL DEFAULT FALSE, -- curation gate barrier
    verified_by        INT REFERENCES editors(editor_id),
    verified_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_memory_active ON feedback_memory_records (rule_id, is_verified);

-- ============================================================
-- 8. Polymorphic Vector Store (avoids embedding-model lock-in)
--    vector_data is dimension-agnostic: a swap of embedding model does not
--    require a schema migration. NOTE: because the column has no fixed
--    dimension, pgvector ANN indexes (HNSW/IVFFlat) cannot be built on it.
--    Exact KNN over the small, rule-filtered candidate set is intentional
--    (see Section 7). If volume grows, partition by (embedding_model,
--    vector_dimensions) into fixed-dimension child tables and index those.
-- ============================================================
CREATE TABLE feedback_memory_vectors (
    vector_id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    memory_id        INT NOT NULL REFERENCES feedback_memory_records(memory_id) ON DELETE CASCADE,
    embedding_model  VARCHAR(100) NOT NULL,            -- 'text-embedding-3-small', 'cohere-embed-v3', ...
    vector_dimensions INT NOT NULL,                    -- 1536, 3072, ...
    vector_data      VECTOR NOT NULL                   -- flexible (unindexed) vector type
);
CREATE INDEX idx_feedback_vectors_lookup
    ON feedback_memory_vectors (embedding_model, vector_dimensions, memory_id);

-- ============================================================
-- 9. Per-Stat-Type Precision & Rounding Policy
--    Reconciliation (§5 B.1) MUST NOT use one global tolerance: P rounds to 2 dp
--    (except <.01), χ² to 1 dp but keeps the first significant digit for tiny values,
--    percentages to a consistent dp, whole-number % takes no trailing zero. Encoding
--    this per stat_type prevents false mismatches (abstract "25%" vs computed "24.8%")
--    that would flood the editor and destroy trust in the highest-value feature.
-- ============================================================
CREATE TABLE stat_precision_policy (
    stat_type        VARCHAR(50) PRIMARY KEY,          -- matches extracted_statistics.stat_type
    decimal_places   INT,                              -- canonical dp; NULL = context/consistency-driven
    keep_first_sig_digit BOOLEAN NOT NULL DEFAULT FALSE,-- e.g. χ² tiny values
    strip_trailing_zero  BOOLEAN NOT NULL DEFAULT FALSE,-- e.g. whole-number percentages
    tolerance_rule   TEXT NOT NULL                     -- human-readable comparison rule for the reconciler
);
```

### Schema notes

- **`ON DELETE RESTRICT`** on every `rule_id` FK: lessons and suggestions must never be
  orphaned from the rule that the retrieval query filters on.
- **`action_audit_log` is append-only by convention.** Enforce with a trigger that raises on
  `UPDATE`/`DELETE`, or with table permissions (grant `INSERT, SELECT` only). This is the
  source of truth for flywheel metrics; mutable `editing_suggestions.status` is not.
- **`origin_tier`** is stored on each suggestion so the merge engine (Section 6) resolves
  precedence without re-deriving it from the engine name.
- **`logical_key`** on `extracted_statistics` is what makes cross-reference reconciliation
  possible: values sharing a key must agree across locations. **Note:** *assigning* a stable
  `logical_key` across the abstract, prose, and tables is fuzzy entity resolution, not a
  deterministic step (§5 B.1) — it is a heuristic/LLM sub-task, and matches based on it post at
  `origin_tier = 'base_inference'`, not `'deterministic'`.
- **`kind`** on `editing_suggestions` separates applyable edits from `author_query` flags the
  system cannot fix itself. Queries carry `proposed_text = NULL` (enforced by CHECK) and drive
  the `raise_query` editor action.
- **`is_auto_applicable`** on `style_rules` — auto-apply is per-rule, not per-tier. A
  deterministic-but-context-sensitive rule (P/α/β leading-zero exception; operator spacing in
  equations) is `is_auto_applicable = FALSE` and posts as `pending`.
- **Table geometry** (`manuscript_tables`, `table_cells`) makes table-scoped rules and
  header/body distinctions expressible; suggestions and statistics can address a cell.
- **`stat_precision_policy`** supplies per-stat-type rounding so reconciliation does not raise
  false mismatches.

---

## 5. Processing Pipeline

The runtime is a queue-driven worker. Each manuscript flows through the phases below. Phases
A–E are automated; Phase F is the human loop.

### Phase A — Ingestion & Segmentation

Split the manuscript into sections (`Abstract`, `Introduction`, `Methods`, `Results`,
`Discussion`) and then into semantic chunks of ~250–500 words. Persist to `manuscript_chunks`
with a stable `sequence_order`. Set manuscript `status = 'processing'`.

**Segmentation must be statistic- and table-aware:** never split a statistical unit (e.g.
`(95% CI 2.2-4.8)`) or a table across a chunk boundary. Markdown tables are extracted into the
structured model (`manuscript_tables` + `table_cells`) and represented in the chunk stream as a
`chunk_type = 'table'` placeholder chunk, so table-scoped rules operate on cell geometry rather
than a flattened text blob. All offsets recorded here are codepoint offsets (Principle 8).

### Phase B — Statistical Extraction (ground-truth registry)

Sweep every chunk for reported quantitative values (p-values, means, differences, percentages,
proportions `n/N`, CI bounds, sample sizes, test statistics). For each, insert an
`extracted_statistics` row with:

- `raw_value_string` — the literal text,
- `numeric_value_primary` (and `_secondary` where applicable, e.g. CI upper bound or the
  denominator of a proportion),
- `location_context` (abstract / body_prose / table_cell / …),
- `source_cell_id` — set when the value is inside a table, so table-scoped rules and
  reconciliation can use cell geometry (row/col/header) rather than prose offsets.
- `logical_key` — a normalized identifier for the quantity being reported, so the same
  outcome mentioned in the abstract, prose, and a table shares one key.

> **`logical_key` assignment is a heuristic/LLM sub-step, not deterministic.** Recognizing that
> "mortality was 25%" in the abstract and a table cell "50/200" under a "Deaths" column are the
> *same quantity* is entity resolution. Do it with normalization heuristics first (unit, stat
> type, section proximity, matching numerator/denominator) and fall back to an LLM pass for
> ambiguous cases. Because keying is fuzzy, cross-location agreement checks built on it do **not**
> get deterministic authority (see B.1).

### Phase B.1 — Cross-Reference Reconciliation (the previously missing piece)

This closes the "Cross-Section Consistency" driver. It reads the registry and flags
disagreements; it does **not** rely on declarative DB constraints for the semantic comparison.
Reconciliation is **two distinct sub-passes** with different authority, because they have
different reliability:

**B.1a — Derived-relationship checks (genuinely deterministic).** These compare values *within a
single reported statement* using math, with no fuzzy cross-location matching:
- proportions: `numeric_value_primary (n) / numeric_value_secondary (N)` must equal the stated
  percentage, rounded per `stat_precision_policy` for that stat type.
- CI bounds: lower ≤ point estimate ≤ upper.
These post at `origin_tier = 'deterministic'`. Where the correct value is computable (e.g. the
percentage from `n/N`), emit an `edit`; where it is not (the underlying data is absent), emit an
`author_query`.

**B.1b — Cross-location agreement (fuzzy, needs review).** For each `logical_key`, gather all
rows and compare `numeric_value_primary` across locations, using the **per-stat-type tolerance**
from `stat_precision_policy` (never a single global formula — that would raise false mismatches
like abstract "25%" vs computed "24.8%"). Because grouping depends on fuzzy `logical_key`
assignment, a detected disagreement posts as an `author_query` at
`origin_tier = 'base_inference'` (never `'deterministic'`, never auto-applied) with a
`proposed_text = NULL` flag that states the discrepancy (e.g. "Abstract reports 25%; table
computes 50/200 = 25%; prose reports 26% — please reconcile").

Both sub-passes run *before* the LLM tier so mismatches become context for later phases.

### Phase B.2 — Consistency Normalizers (document/section/table scope)

Some rules cannot be decided from a single span — they require an **aggregate view** to pick a
canonical style and normalize the outliers. This pass handles `scope IN ('section','document',
'table')` rules:

- **Uniform decimal places** for percentages across the paper (guideline: "rounded to a
  consistent number of decimal places").
- **Consistent negative symbol** throughout (en dash vs hyphen vs minus).
- **Per-table range style:** if any range in a table contains a negative value, *all* ranges in
  that table must use "to" (a `table`-scoped rule using `table_cells` geometry).

Algorithm: aggregate occurrences per rule → infer the document's chosen convention (or fall back
to the house default) → emit span/cell suggestions for the deviations. These are deterministic
*given the aggregate*, but are **not auto-applied** (choosing the canonical style can be a
judgment call): they post at `origin_tier = 'deterministic'`, `status = 'pending'`.

### Phase C — Deterministic Pre-Fix Engine (span scope)

A pure regex/string engine applies clear, local `scope = 'span'` fixes and records each as an
`editing_suggestions` row with `originator_engine = 'regex_engine_v1'`,
`origin_tier = 'deterministic'`. In addition to the statistical rules below, this engine also
covers the **mechanical house-style** subset in scope (§1): trademark ™/®/℠ removal, `ie.`/`eg.`
→ `ie,`/`eg,`, Word ellipsis → three periods, controlled-term swaps (`towards→toward`,
`e-health→eHealth`, `codesign→co-design`), currency `US$` spacing / no trailing zeros, and
temperature `°C` spacing. Covered statistical rules include:

- **Thousands separators:** integers > 9999 get grouping commas (`36127 → 36,127`; `6500`
  unchanged).
- **Percent spacing:** strip space before `%` (`18 % → 18%`); repeat `%` across ranges
  (`15-20% → 15%-20%`).
- **Operator padding:** remove spaces around `=`, `<`, `>` in running prose
  (`P < .001 → P<.001`).
- **Whole-number percent rounding:** strip trailing `.0` from sample-derived whole-number
  percentages (`50/200=25.0% → 25%`).
- **Leading-zero policy:** enforce a leading zero for values `< 1` **except** p-values, α, and
  β levels (which take no leading zero).

> **Auto-apply policy (per-rule, not per-tier).** Only rules with
> `style_rules.is_auto_applicable = TRUE` are applied automatically (insert with
> `status = 'auto_applied'` + an `action_audit_log` `auto_applied` row); they appear in the
> editor diff as already-applied, reversible changes. This set is the **context-free** rules:
> thousands separators, `%` spacing, `%`-repeat in ranges, trailing-zero-on-whole-percent, and
> the mechanical house-style swaps.
>
> **Context-sensitive deterministic rules are NOT auto-applied** — they post `status = 'pending'`
> despite being deterministic:
> - **Leading-zero exception** for P/α/β: `.05 → 0.05` is correct for a proportion but *wrong*
>   for an α level; the statistic type isn't always locally decidable.
> - **Operator spacing "except in equations"** (§6): prose strips spaces around `=`, equations
>   keep them; a regex cannot reliably tell them apart, so auto-applying would corrupt equations.
>
> All `base_inference` (LLM) suggestions and all `author_query` flags also default to `pending`.

### Phase D — Ambiguous Fallback (Thin LLM)

Only spans the deterministic engine cannot resolve are routed to a targeted LLM call. Typical
cases:

- **Interval vs. subtraction:** decide whether `-3.4-1.1` is an interval whose lower bound is
  negative (→ `-3.4 to 1.1`) or an arithmetic expression.
- **Subscript reformatting:** context-dependent conversion of degrees-of-freedom expressions
  (`t15=2.68` → `t₁₅ = 2.68`) based on surrounding text.

Before each LLM call, retrieve curated few-shot examples via `retrieve_curated_lessons`
(Section 8) — filtered to the relevant `rule_id` and `is_verified = TRUE`. LLM outputs are
inserted with `origin_tier = 'base_inference'` (or `'verified_memory'` when the suggestion is a
direct application of a retrieved verified lesson) and `status = 'pending'`.

### Phase E — Merge & Arbitration Engine

Multiple engines produce suggestions over the same `chunk_text`. Before anything reaches the
editor, reconcile overlapping character spans. **Priority alone is not enough** — partial
overlaps must be split, not discarded.

**Precedence (highest first):**
`deterministic` > `verified_memory` > `base_inference`.

> **Only genuinely deterministic output earns `deterministic` precedence.** Fuzzy
> cross-location reconciliation (B.1b) posts at `base_inference` precisely so it cannot outrank a
> real span fix. `author_query` suggestions do not compete for a text span (they carry no
> `proposed_text`) and so are exempt from interval arbitration — they pass through to the editor
> alongside the reconciled edit set.

**Algorithm (per chunk):**

1. Acquire a per-chunk lock to serialize merges (see concurrency note below).
2. Load all `status = 'pending'`/`auto_applied` suggestions for the chunk, sorted by
   `char_start_index`.
3. Build an interval map over the chunk's character range. Walk left to right:
   - For each character span, if only one suggestion covers it, keep it.
   - Where suggestions overlap, the higher-`origin_tier` suggestion owns the overlapping
     sub-span. **Split** the lower-tier suggestion around the conflict so its
     non-overlapping remainder survives, rather than dropping the whole suggestion.
   - If two suggestions of equal tier conflict on the same span, prefer higher `confidence`,
     then earlier `created_at`; mark the loser `status = 'superseded'` and log it.
4. Emit the reconciled, non-overlapping set to the editor dashboard.

> **Concurrency.** Engines write concurrently, and the merge does read-then-write. Wrap the
> merge for a chunk in a transaction guarded by a per-chunk advisory lock
> (`pg_advisory_xact_lock(chunk_id)`), or run it at `SERIALIZABLE` isolation with retry.
> This prevents two mergers from racing on the same chunk.

### Phase F — Editor Dashboard (HITL)

Suggestions are shown as side-by-side diffs. For each, the editor chooses:

- **Accept** → `editing_suggestions.status = 'accepted'`; append `action_audit_log` (`accepted`).
- **Reject** → `status = 'rejected'` (false positive; text unchanged); append `rejected`.
- **Override** → editor supplies a manual correction; `status = 'overridden'`; append
  `overridden` with the final text in `detail`. **This triggers the flywheel (Section 7).**

For `kind = 'author_query'` suggestions (no `proposed_text`), the editor's action is
**Raise query** → `status = 'queried'`; append `action_audit_log` (`raise_query`) with the query
text in `detail`. The query is routed to the author, not applied as an edit. (Accept/Reject still
apply if the editor resolves or dismisses the flag directly.)

When all suggestions in a manuscript are resolved, set manuscript `status = 'completed'`.

---

## 6. Active-Learning Flywheel & Curation

### 6.1 Asynchronous reflection (on override)

An override enqueues a background job. A reflection agent receives the original span, the failed
system suggestion, and the editor's final text, and produces a concise, rule-anchored rationale.
The record is written **behind the curation gate** (`is_verified = FALSE`):

```sql
INSERT INTO feedback_memory_records (
    rule_id, editor_id, source_suggestion_id,
    original_span_text, editor_corrected_text, editor_rationale, is_verified
) VALUES (
    'range_negative',
    104,
    88231,
    'The mean difference was -1.2 (95% CI -3.4-1.1) mm Hg.',
    'The mean difference was -1.2 (95% CI -3.4 to 1.1) mm Hg.',
    'Lower CI boundary is negative; per style rule 2.3.4 negative intervals use the word "to", not a hyphen.',
    FALSE   -- held for admin verification
);
```

Then embed **`original_span_text`** (sentence/span granularity, matching the read-time
granularity — see 6.3) and store the vector:

```sql
INSERT INTO feedback_memory_vectors (memory_id, embedding_model, vector_dimensions, vector_data)
VALUES (:memory_id, 'text-embedding-3-small', 1536, :embedding);
```

### 6.2 The curation gate

New records are inert (`is_verified = FALSE`). An admin reviews the staging queue on a
validation dashboard and, when correct, sets `is_verified = TRUE`, `verified_by`, `verified_at`.
Only verified records are ever retrieved for context injection. This prevents a mistaken
reflection (or a logged human error) from poisoning future prompts.

### 6.3 Precision-filtered retrieval

At read time, the system embeds the **current sentence/span** (same granularity as stored
originals) and runs a rule-filtered, model-filtered KNN:

```sql
SELECT r.original_span_text, r.editor_corrected_text, r.editor_rationale
FROM feedback_memory_records r
JOIN feedback_memory_vectors v ON r.memory_id = v.memory_id
WHERE r.rule_id = :rule_id
  AND r.is_verified = TRUE
  AND v.embedding_model = 'text-embedding-3-small'
  AND v.vector_dimensions = 1536
ORDER BY v.vector_data <=> :current_sentence_embedding
LIMIT 2;
```

The `rule_id` + `is_verified` pre-filter narrows candidates to a handful before the vector sort,
so exact KNN is fast without an ANN index. The `embedding_model`/`vector_dimensions` filter
guarantees the `<=>` operator only ever compares same-dimension vectors.

---

## 7. Embedding Strategy

- The embedding model is a **configuration value**, pinned in one place and written into
  `feedback_memory_vectors.embedding_model` on every insert. Read-time queries filter on the
  same configured model, so retrieval never mixes vector spaces.
- **Vendor note:** the default `text-embedding-3-small` (OpenAI) introduces a second vendor
  and a data-egress path. The polymorphic vector store makes swapping providers a config
  change plus a re-embed job, not a schema migration. Choose the provider deliberately; if
  data residency matters, a self-hosted embedding model drops in without DDL changes.
- **Re-embedding:** changing models means embedding existing verified records under the new
  `embedding_model` and letting the read filter switch over. Old vectors remain for rollback.

---

## 8. MCP Server — Tool Surface

The MCP server exposes intent-scoped tools (not raw SQL passthrough). Each tool validates
inputs, runs inside a transaction, and returns structured results.

**`ingest_manuscript`**
- Input: `title` (TEXT, optional), `raw_content_markdown` (TEXT).
- Op: creates the `manuscripts` row, runs Phase A segmentation, returns `manuscript_id` and
  chunk count.

**`extract_manuscript_statistics`**
- Input: `manuscript_id` (UUID).
- Op: runs Phase B, populating `extracted_statistics`. Returns per-`logical_key` counts.

**`reconcile_statistics`**
- Input: `manuscript_id` (UUID).
- Op: runs Phase B.1a (deterministic derived checks) and B.1b (fuzzy cross-location agreement).
  Derived-math violations post as `deterministic` edits/queries; cross-location disagreements
  post as `base_inference` `author_query` flags. Returns the list of detected discrepancies.

**`run_consistency_normalizers`**
- Input: `manuscript_id` (UUID).
- Op: runs Phase B.2 over `scope IN ('section','document','table')` rules. Infers the canonical
  style per rule (or house default) and inserts `pending` normalization suggestions for
  deviations. Returns per-rule counts and the chosen convention.

**`run_deterministic_fixes`**
- Input: `chunk_id` (INT) or `manuscript_id` (UUID).
- Op: runs Phase C, inserting `auto_applied` suggestions + audit rows. Returns changes made.

**`retrieve_curated_lessons`**
- Input: `text_span` (TEXT), `rule_id` (VARCHAR).
- Op: embeds `text_span` with the configured model and runs the 6.3 query. Returns up to N
  verified few-shot examples. Embedding model is pinned server-side, not a caller argument.

**`post_suggestion`**
- Input: `chunk_id`, `rule_id`, `origin_tier`, `kind` (`edit`|`author_query`), `char_start`,
  `char_end`, `original`, `proposed` (required for `edit`, omitted for `author_query`),
  `originator_engine`, `cell_id` (optional, for table-scoped), `confidence` (optional).
- Op: inserts an `editing_suggestions` row. Rejects `edit` without `proposed` and
  `author_query` with `proposed` (mirrors the DB CHECK). Does **not** merge (a separate,
  chunk-locked step) but validates codepoint span bounds against `chunk_text` (or `cell_text`
  when `cell_id` is set).

**`merge_chunk_suggestions`**
- Input: `chunk_id` (INT).
- Op: runs Phase E under a per-chunk advisory lock; returns the reconciled suggestion set.

**`record_editor_action`**
- Input: `suggestion_id`, `editor_id`, `action` (accept/reject/override/raise_query),
  `final_text` (required for override).
- Op: updates suggestion status (`accepted`/`rejected`/`overridden`/`queried`), appends
  `action_audit_log`, and — on override — enqueues the reflection job. `raise_query` is valid
  only for `kind = 'author_query'` suggestions.

**`verify_memory_record`** (admin only)
- Input: `memory_id`, `verifying_editor_id`.
- Op: flips the curation gate to `is_verified = TRUE` and stamps `verified_by`/`verified_at`.

---

## 9. Build Plan for Claude Code

Work these milestones in order. Each ends with tests that must pass before moving on. Prefer
plan-then-implement per milestone.

**Milestone 0 — Scaffold.**
Create the repo: `/migrations`, `/engine` (deterministic rules), `/pipeline` (worker phases),
`/mcp` (server + tools), `/tests`. Add a `docker-compose.yml` with Postgres 16 + pgvector.
Add a migration runner. Commit this SPEC as `SPEC.md`.

**Milestone 1 — Schema.**
Translate Section 4 into ordered migration files (including `manuscript_tables`, `table_cells`,
`stat_precision_policy`). Add the append-only trigger on `action_audit_log`. Seed `style_rules`
(each row with `is_deterministic`, `is_auto_applicable`, and `scope` set from the rule catalog),
`stat_precision_policy` (per stat type), and a couple of `editors`. Test: migrations apply
cleanly on an empty DB; a smoke test inserts one row per table respecting all FKs and CHECKs
(including the `kind`/`proposed_text` CHECK and the `author_query` path).

**Milestone 2 — Deterministic engine (highest ROI, fully testable).**
Implement each Phase C rule as a pure function with a unit test table of `(input, expected)`
cases, including the tricky ones (`6500` unchanged; `50/200=25.0% → 25%`; leading-zero
exception for p/α/β; operator spacing kept in equations). Cover both the statistical rules and
the in-scope mechanical house-style rules. Each rule declares `is_auto_applicable`; the tests
assert context-sensitive rules produce `pending` (not auto-applied) suggestions. Codepoint-offset
correctness is tested against non-ASCII fixtures (`–`, `≤`, `χ²`, `°C`). This engine carries most
of the product value; make it airtight.

**Milestone 3 — Extraction + reconciliation + consistency.**
Implement Phase B extraction (with table geometry + `logical_key` heuristics), Phase B.1a/B.1b
reconciliation (deterministic derived checks + fuzzy cross-location agreement using
`stat_precision_policy`), and Phase B.2 consistency normalizers. Test: a fixture with a
deliberate abstract-vs-table mismatch produces exactly one `author_query` cross-location flag; a
consistent fixture produces none; a table with one negative range flags all its ranges for "to";
a per-stat-type rounding fixture does **not** raise a false mismatch (25% vs 24.8% within
tolerance).

**Milestone 4 — Merge & arbitration.**
Implement Phase E with interval splitting and the advisory-lock transaction. Test:
overlapping deterministic + LLM suggestions on one chunk resolve so the higher tier wins the
overlap while the lower tier's non-overlapping remainder survives; a concurrency test fires two
merges at one chunk and asserts no lost/duplicated spans.

**Milestone 5 — MCP server.**
Expose the Section 8 tools. Test each tool end-to-end against the test DB. Verify
`post_suggestion` rejects out-of-bounds spans and `record_editor_action` writes both the status
update and the audit row atomically.

**Milestone 6 — Flywheel + curation.**
Implement the reflection job, the vector write, the curation gate, and `retrieve_curated_lessons`.
Test: an override with `is_verified = FALSE` is *not* retrieved; after `verify_memory_record`
it *is*; retrieval returns same-dimension vectors only.

**Milestone 7 — Thin LLM tier.**
Wire Phase D last, once deterministic + retrieval are solid. Keep prompts small and
rule-scoped; inject curated lessons as few-shot examples. Test with recorded fixtures so the
suite stays deterministic.

**Testing conventions.**
Unit tests for the deterministic engine and reconciler must be fully deterministic (no live LLM
or embedding calls — stub/record them). Every migration has an up/down and a smoke test. CI
runs against the pgvector container.

---

## 10. Open Decisions (resolve before/early in the build)

1. ~~**Language/runtime**~~ — **RESOLVED: TypeScript / Node.js.**
2. ~~**Embedding provider**~~ — **RESOLVED: Google Gemini (`gemini-embedding-001`).** Written
   into the polymorphic vector store as a config value; a residency-driven swap remains a
   config + re-embed job, not a migration.
3. **Reconciliation tolerance** — partially resolved: represented per stat type in
   `stat_precision_policy` (Section 4/9). Still to finalize: the concrete dp/tolerance values
   seeded per `stat_type`.
4. ~~**Editor identity source**~~ — **RESOLVED: local `editors` table is the system of record**
   for v1; SSO mapping deferred.
5. **Reflection-agent model** and its guardrails (Anthropic Claude; max output length, refusal
   to invent rules not in `style_rules`). Model family chosen; guardrail limits still to pin.
6. **`logical_key` assignment strategy** — how far heuristics go before the LLM fallback engages
   (Section 5 B). Affects reconciliation precision.

---

## Appendix A — Change Log vs. Prior Draft

### Revision 2 (2026-07-02) — after reading the source guidelines

Driven by `docs/ARCHITECTURE-REVIEW.md`. The data-flow backbone was kept; the rule model was
made to match the real guidelines:

- **Author-query suggestion class.** `editing_suggestions.kind ∈ (edit, author_query)` with
  nullable `proposed_text` (CHECK-enforced), a `queried` status, and a `raise_query` audit
  action / editor action. The system flags-but-does-not-invent when data is absent.
- **Per-rule auto-apply.** Added `style_rules.is_auto_applicable`; auto-apply is decoupled from
  `origin_tier`. Context-sensitive deterministic rules (P/α/β leading-zero, operator spacing in
  equations) now post `pending`.
- **Structured table model.** Added `manuscript_tables` + `table_cells`; statistics and
  suggestions can address a cell; `manuscript_chunks.chunk_type` marks table placeholders.
- **Reconciliation re-tiered.** Phase B.1 split into B.1a (deterministic derived math) and B.1b
  (fuzzy cross-location agreement → `base_inference` `author_query`). `logical_key` assignment is
  documented as a heuristic/LLM step, not deterministic.
- **Consistency pass (Phase B.2).** New stage for `section`/`document`/`table`-scoped rules; added
  `style_rules.scope` and the `run_consistency_normalizers` tool.
- **Per-stat-type precision.** Added `stat_precision_policy` so reconciliation avoids false
  mismatches.
- **Codepoint-offset discipline** (Principle 8) for the non-ASCII-heavy guidelines.
- **Scope extended** to the mechanical house-style subset (trademark removal, ie/eg commas,
  ellipsis, term swaps, currency/temperature spacing).
- **Decisions pinned:** TypeScript runtime, Gemini embeddings, local `editors` table.

### Revision 1 — relative to the previous draft

Incorporated fixes relative to the previous revision:

- **Re-added the append-only audit ledger** (`action_audit_log`) that the prior revision
  dropped; flywheel metrics and traceability now read from an immutable source, not mutable
  suggestion status.
- **Specified cross-reference reconciliation** (Phase B.1 + `logical_key`) so the
  Cross-Section Consistency driver has an actual mechanism, not just storage.
- **Tightened the merge engine** with interval splitting (partial-overlap survival) and a
  per-chunk advisory-lock concurrency model.
- **Deterministic auto-apply policy** to prevent editor review fatigue.
- **Added `editors` table + FKs** for `editor_id`; added `CHECK` constraints on all enum
  columns; added rule `version` and manuscript `updated_at`.
- Documented the **unindexed polymorphic vector** tradeoff and the growth path (fixed-dim
  partitions) explicitly.
```
