# Active-Learning Copy-Editing Platform (HITL) — Build Specification

> **Purpose of this document.** This is a production build specification written to be handed
> directly to Claude Code. It is self-contained: it defines the problem, the data model, the
> processing pipeline, the MCP tool surface, and a phased, test-driven build plan. Read this
> file first, then work the plan in Section 9 top to bottom.
>
> **Target stack:** PostgreSQL 16+ with the `vector` (pgvector) extension · a Python (or
> TypeScript) worker service for the runtime pipeline · a custom MCP server exposing the
> platform as tools. Claude Code is the *build* environment, not the production runtime.

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

### Non-goals (v1)

- Not a general grammar/prose editor. Scope is quantitative/statistical formatting.
- No autonomous publishing. Every non-trivial change is surfaced to a human.
- No distributed/sharded infrastructure. Single Postgres instance is sufficient at this volume.

---

## 2. Core Design Principles

1. **Deterministic-first.** Mechanical formatting (spacing, thousands separators, trailing-zero
   stripping, percentage recomputation) is handled by a regex/string engine. LLM calls are
   reserved for genuine semantic ambiguity. This is the primary cost and accuracy lever.
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
    chunk_text    TEXT NOT NULL,
    UNIQUE (manuscript_id, sequence_order)
);

-- ============================================================
-- 4. Normalized Ground-Truth Statistical Extraction
--    Populated in Phase B; read by the reconciliation step.
-- ============================================================
CREATE TABLE extracted_statistics (
    stat_id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    manuscript_id   UUID NOT NULL REFERENCES manuscripts(manuscript_id) ON DELETE CASCADE,
    source_chunk_id INT  NOT NULL REFERENCES manuscript_chunks(chunk_id) ON DELETE CASCADE,
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
    rule_id          VARCHAR(50) NOT NULL REFERENCES style_rules(rule_id) ON DELETE RESTRICT,
    originator_engine VARCHAR(100) NOT NULL,         -- 'regex_engine_v1','reconciler_v1','llm_boundary_linter'
    origin_tier      VARCHAR(20) NOT NULL            -- drives merge precedence (see Section 6)
        CHECK (origin_tier IN ('deterministic','verified_memory','base_inference')),
    char_start_index INT NOT NULL,                   -- relative to chunk_text
    char_end_index   INT NOT NULL,
    original_text    TEXT NOT NULL,
    proposed_text    TEXT NOT NULL,
    confidence       NUMERIC,                         -- optional; 0..1 for LLM tiers
    status           VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','auto_applied','accepted','rejected','overridden','superseded')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (char_end_index >= char_start_index)
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
        CHECK (action IN ('auto_applied','proposed','accepted','rejected','overridden')),
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
  possible: values sharing a key must agree across locations.

---

## 5. Processing Pipeline

The runtime is a queue-driven worker. Each manuscript flows through the phases below. Phases
A–E are automated; Phase F is the human loop.

### Phase A — Ingestion & Segmentation

Split the manuscript into sections (`Abstract`, `Introduction`, `Methods`, `Results`,
`Discussion`) and then into semantic chunks of ~250–500 words. Persist to `manuscript_chunks`
with a stable `sequence_order`. Set manuscript `status = 'processing'`.

### Phase B — Statistical Extraction (ground-truth registry)

Sweep every chunk for reported quantitative values (p-values, means, differences, percentages,
proportions `n/N`, CI bounds, sample sizes, test statistics). For each, insert an
`extracted_statistics` row with:

- `raw_value_string` — the literal text,
- `numeric_value_primary` (and `_secondary` where applicable, e.g. CI upper bound or the
  denominator of a proportion),
- `location_context` (abstract / body_prose / table_cell / …),
- `logical_key` — a normalized identifier for the quantity being reported, so the same
  outcome mentioned in the abstract, prose, and a table shares one key.

### Phase B.1 — Cross-Reference Reconciliation (the previously missing piece)

This closes the "Cross-Section Consistency" driver. It reads the registry and flags
disagreements; it does **not** rely on declarative DB constraints for the semantic comparison.

Algorithm:

1. For each `logical_key` in a manuscript, gather all `extracted_statistics` rows.
2. Group by the quantity they should represent. Compare `numeric_value_primary` across
   locations within a tolerance (default: exact for whole numbers; `abs(a-b) <= 0.5 * 10^-dp`
   where `dp` is the lower reported decimal precision).
3. Also verify **derived** relationships:
   - proportions: `numeric_value_primary (n) / numeric_value_secondary (N)` must equal the
     stated percentage, rounded per the whole-number rule.
   - CI bounds: lower ≤ point estimate ≤ upper.
4. On any mismatch, insert an `editing_suggestions` row against the offending chunk/span with
   `rule_id = 'cross_reference_mismatch'`, `origin_tier = 'deterministic'`, and a
   `proposed_text` that states the discrepancy (e.g. "Abstract reports 25%; table computes
   50/200 = 25.0% → 25%; prose reports 26%").

Reconciliation runs *before* the LLM tier so mismatches become context for later phases.

### Phase C — Deterministic Pre-Fix Engine

A pure regex/string engine applies clear, rule-based fixes and records each as an
`editing_suggestions` row with `originator_engine = 'regex_engine_v1'`,
`origin_tier = 'deterministic'`. Covered rules include:

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

> **Auto-apply policy.** Deterministic suggestions are high-confidence. To avoid review
> fatigue, they are applied automatically: insert with `status = 'auto_applied'` and write an
> `action_audit_log` row with `action = 'auto_applied'`. They appear in the editor diff as
> already-applied (reversible) changes, not as pending approvals. Only `base_inference`
> (LLM) suggestions default to `status = 'pending'` and require an explicit editor action.

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
- Op: runs Phase B.1, inserting `cross_reference_mismatch` suggestions. Returns the list of
  detected discrepancies.

**`run_deterministic_fixes`**
- Input: `chunk_id` (INT) or `manuscript_id` (UUID).
- Op: runs Phase C, inserting `auto_applied` suggestions + audit rows. Returns changes made.

**`retrieve_curated_lessons`**
- Input: `text_span` (TEXT), `rule_id` (VARCHAR).
- Op: embeds `text_span` with the configured model and runs the 6.3 query. Returns up to N
  verified few-shot examples. Embedding model is pinned server-side, not a caller argument.

**`post_suggestion`**
- Input: `chunk_id`, `rule_id`, `origin_tier`, `char_start`, `char_end`, `original`,
  `proposed`, `originator_engine`, `confidence` (optional).
- Op: inserts an `editing_suggestions` row. Does **not** merge (merging is a separate,
  chunk-locked step) but validates span bounds against `chunk_text` length.

**`merge_chunk_suggestions`**
- Input: `chunk_id` (INT).
- Op: runs Phase E under a per-chunk advisory lock; returns the reconciled suggestion set.

**`record_editor_action`**
- Input: `suggestion_id`, `editor_id`, `action` (accept/reject/override), `final_text`
  (required for override).
- Op: updates suggestion status, appends `action_audit_log`, and — on override — enqueues the
  reflection job.

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
Translate Section 4 into ordered migration files. Add the append-only trigger on
`action_audit_log`. Seed `style_rules` and a couple of `editors`. Test: migrations apply
cleanly on an empty DB; a smoke test inserts one row per table respecting all FKs and CHECKs.

**Milestone 2 — Deterministic engine (highest ROI, fully testable).**
Implement each Phase C rule as a pure function with a unit test table of `(input, expected)`
cases, including the tricky ones (`6500` unchanged; `50/200=25.0% → 25%`; leading-zero
exception for p/α/β). This engine carries most of the product value; make it airtight.

**Milestone 3 — Extraction + reconciliation.**
Implement Phase B extraction into `extracted_statistics` and Phase B.1 reconciliation. Test:
a fixture manuscript with a deliberate abstract-vs-table mismatch produces exactly one
`cross_reference_mismatch` suggestion; a consistent fixture produces none.

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

1. **Language/runtime** for the worker + MCP server (Python vs. TypeScript). Pick one and
   pin it in Milestone 0.
2. **Embedding provider** and whether data residency rules out a hosted API (Section 7).
3. **Reconciliation tolerance** defaults and how to represent rounding precision per stat type.
4. **Editor identity source** — is `editors` the system of record, or synced from an external
   auth provider (SSO)? If external, add the mapping in Milestone 1.
5. **Reflection-agent model** and its guardrails (max output length, refusal to invent rules
   not in `style_rules`).

---

## Appendix A — Change Log vs. Prior Draft

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
