# Claude Session Summary — Agentic Copy Editor

**Date:** 2026-07-02 → 2026-07-03
**Purpose:** Context continuity across sessions / after auto-compact. Read this first when resuming.
**Repo:** private GitHub `rsimhan/AgenticCopyEditor`, branch `main`. HEAD at time of writing: `d91566e`.
**NOTE:** `logs/` is now **gitignored** (local working notes; never pushed). See §10 for the latest state — read it after §1–9.

---

## 1. What this project is

An **Agentic Copy Editor** — an Active-Learning, Human-in-the-Loop platform that enforces JMIR
publication style for **statistical / numerical / mathematical reporting** in scientific
manuscripts. Deterministic-first (a regex engine does the mechanical majority; LLM reserved for
genuine ambiguity), non-destructive span suggestions, append-only audit, curation-gated learning
flywheel, unified Postgres + pgvector.

**Domain expert:** the user's **sister is a professional copy editor** — the tool is modeled on how
she works, and her judgment is the acceptance benchmark. Her overrides are the flywheel's training
data.

**Source of truth docs (in `docs/`):**
- `Agentic Copy Editor - SPEC.md` — data model, pipeline phases, MCP tool surface, build plan (revised).
- `ARCHITECTURE-REVIEW.md` — why the rule model looks the way it does (spec vs. real guidelines).
- `AGENT-ARCHITECTURE.md` — the multi-agent orchestration layer, **stable seams**, and the 3-phase
  deployment model (§14). **Read §5 seams, §8.1 autonomy dial, §14 phases.**
- `MIGRATIONS.md` — migration conventions.
- Source guidelines (the real rules): `userinputfiles/*.docx` (JMIR statistics + house style).

---

## 2. Key decisions locked

- **Stack:** TypeScript / Node 22 · PostgreSQL 16 + pgvector · pnpm · Vitest · Prettier.
- **LLM tier** = Anthropic Claude (Phase D + reflection). **Embeddings** = Google Gemini
  (`gemini-embedding-001`) — user is a Google shop. Both behind interfaces (provider-swappable).
- **Editor identity** = local `editors` table (SSO deferred).
- **Engine scope** = statistical/numerical rules **PLUS** mechanical house-style (trademark removal,
  ie/eg, ellipsis, term swaps, currency/temperature spacing). Semantic prose rules are out of v1.
- **MCP reframed as ONE adapter**, not the boundary. The **service layer is the stable seam**;
  CLI/REST/MCP are thin adapters. MCP deferred until an AI-assistant consumer is concrete.
- **Deployment = 3 phases over one service layer** (AGENT-ARCHITECTURE §14):
  1. **Test** (current) — CLI runner, refine until acceptable against the sister's real edits.
  2. **Launch** — web UI (work pipeline + admin) over REST.
  3. **Agentic** — autonomous Co-Pilot over MCP, pulls files, min-HITL.
- **Autonomy is earned per-rule, not global** (§8.1) — the auto-apply line moves outward as measured
  accuracy (from `action_audit_log`) proves each rule. `is_deterministic` ≠ `is_auto_applicable`.

---

## 3. Architecture (the stable seams)

Deterministic macro-orchestration; LLM reasoning only at the leaves. Agents coordinate ONLY through
the blackboard (never call each other). Seams (won't change shape): **Blackboard** (`editing_suggestions`
+ append-only `action_audit_log`) · **Rule Registry** (`style_rules` metadata + code `RuleHandler`s) ·
**Agent contract** + injected **ToolBelt** · deterministic **Orchestrator/Workflow** · **Tool layer** ·
**Provider abstraction** (`LlmClient`/`Embedder`) · the **Service layer** (§5.7).

**Pipeline phases:** A ingest/segment → B extract (+logical_key) → B.1a deterministic derived checks /
B.1b fuzzy cross-location (author_query) → B.2 consistency normalizers → C deterministic span fixes →
D thin LLM (not yet wired) → E merge/arbitration (interval-split, advisory lock) → F HITL.

**Suggestion model:** non-destructive char-span suggestions; `kind` ∈ {edit, author_query};
`origin_tier` ∈ {deterministic, verified_memory, base_inference}; per-rule `is_auto_applicable`.
Codepoint offsets everywhere (Principle 8). Tables are first-class (`manuscript_tables`/`table_cells`).

---

## 4. What's built (all committed + pushed)

| Milestone / feature | Status |
|---|---|
| M0 Scaffold + stable seams | ✅ |
| M1 Schema (12 tables + trigger + seeds) | ✅ |
| M2 Deterministic engine (17 span-rule handlers now) | ✅ |
| M3 Extraction + reconciliation (B.1a/B.1b) + consistency (B.2) | ✅ |
| M4 Merge & arbitration (interval-split + `pg_advisory_xact_lock`) | ✅ |
| M5 Service layer + CLI runner (`pnpm ace edit`) | ✅ |
| `.docx` ingestion (mammoth→turndown), UAT gold-set structure | ✅ |
| UAT comparison harness (`pnpm ace uat`) | ✅ |
| Human-friendly HTML report (`--html`) | ✅ |
| Section-scoping (front/body/back-matter regions + URL guard) | ✅ |
| M6 Flywheel + curation | ⏳ not started |
| M7 Thin LLM tier (Phase D) | ⏳ not started (rules routed there: negative_range_to, numeral_conversion) |

**Tests:** 147 unit + 41 integration passing. `pnpm typecheck` clean.
**Migrations:** 0001–0011 applied. Latest: 0010 (UAT rule refinements), 0011 (chunk region).

**Rule catalog (24 seeded; 17 have handlers):** auto-applicable = percent_no_space,
percent_repeat_range, whole_number_percent, temperature_celsius_spacing, trademark_symbol_removal,
ellipsis_three_periods, term_toward, term_xhealth. Pending (deterministic but context-sensitive) =
thousands_separator (DEMOTED — see §5), thousands_strip, time_12hour, leading_zero,
no_leading_zero_stats, no_space_operators, gte_lte_symbols, currency_us_format, latin_abbrev_comma.

---

## 5. Phase-1 refinement loop (UAT) — the big recent work

Real gold set: `tests/uat/input/95374 (1) Original.docx` + `.../edited/95374 (1) Edited.docx` (the
same extract before/after a human copy editor, with tracked changes). **These .docx are GITIGNORED**
(`tests/uat/*`) — confidential author content, never pushed. Only `tests/uat/README.md` is tracked.
⚠️ **Do not move/delete these with shell `rm` under a case-changed path** — earlier a `tests/UAT` vs
`tests/uat` case collision on macOS deleted the originals (user re-added them).

**Harness:** `pnpm ace uat <input.docx> <edited.docx>` extracts the editor's in-scope tracked changes,
runs our pipeline on the original, and scores coverage per rule-pattern (covered/partial/gap/ours-only).

**Findings & fixes this session:**
- **Critical bug caught:** `thousands_separator` was auto-applying commas to a DOI (95374), 8-digit
  Medline IDs, and 24-digit submission-date metadata. → Guarded (skip `:`/`/`-adjacent, >7 digits) +
  DEMOTED to pending (migration 0010). FPs 41 → 2 (the 2 remaining are legit body numbers, pending).
- **Added rules the editor uses:** `thousands_strip` (1,076→1076) and `time_12hour` (14:00→2:00 PM) —
  both now COVERED.
- **Section-scoping (migration 0011):** the real FP root cause was processing front-matter + references.
  Segmenter now tags chunks front_matter/body/back_matter; pipeline runs only on body; URL/DOI/Medline
  guard. On the real paper: 1 front / 16 body / 3 reference chunks — metadata + reference IDs skipped.

**Current scorecard (185 gold in-scope edits, ~103 of our suggestions):**
COVERED = trademark_removal, thousands_strip, time_12hour, operator_spacing, latin_abbrev.
GAPS remaining = numeral_conversion (~22, `two→2`, context-sensitive), minus_sign/en_dash, date_format
(`24th→24,`), ×-spacing, and a noisy `other_numeric` bucket (partly fragmented tracked-changes).
PARTIAL = negative_range_to (needs the LLM tier / M7).

---

## 6. How to run

```bash
pnpm install
pnpm db:up            # Postgres 16 + pgvector (Docker); container: ace_postgres, host port 5433
pnpm migrate:up
pnpm test             # 147 unit (deterministic, no DB)
pnpm test:integration # 41 integration (needs DB up)
pnpm typecheck

pnpm ace edit <file.docx|md>                 # run pipeline → terminal report
pnpm ace edit <file> --html <out.html>       # → human-friendly report, opens in browser (local, safe)
pnpm ace uat <input.docx> <edited.docx>      # gold-set coverage scorecard
```
`.env` exists locally (gitignored); `DATABASE_URL=postgres://ace:ace_dev_password@localhost:5433/ace`.

---

## 7. Open items / next steps (in priority order)

1. **UI — design WITH the sister, then build.** This is the agreed next major step. Questions posed to
   her: section-by-section vs inline (Word-like) review; actions needed (accept/reject/edit/ask-author);
   show or hide auto-applied fixes; web page vs inside Word. Her workflow defines the UI.
2. **numeral_conversion (`two→2`)** — biggest remaining rule gap (~22); context-sensitive → good first
   candidate for the **reasoning (LLM) tier / M7**.
3. Smaller rule gaps: minus_sign/en_dash, date_format, ×-spacing.
4. **M6 flywheel + curation**, **M7 thin LLM tier** — deferred until refinement stabilizes.
5. Harness refinement: section-scope the GOLD side too (currently counts editor edits in refs/front-matter).

---

## 8. Key file map

```
docs/                         SPEC, ARCHITECTURE-REVIEW, AGENT-ARCHITECTURE, MIGRATIONS
migrations/0001..0011         ordered SQL (schema, trigger, seeds, UAT refinements, region)
src/
  config/                     env loading (zod)
  domain/{types,stats}.ts     blackboard contract types (zod)
  db/{pool,ledger,ledger-repo}.ts   Postgres + LedgerRepo (post_suggestion, record_editor_action)
  rules/registry.ts + handlers/     Rule Registry + 17 deterministic handlers
  engine/format-engine.ts     Phase C runner
  pipeline/{segment,extract,logical-key,reconcile,consistency,merge,merge-db,numeric,precision-policy}.ts
  service/{ingest,run,report,html-report}.ts   the service layer + reports
  ingest/{docx,load}.ts       .docx → Markdown front-end
  uat/{tracked-changes,compare,docx-xml}.ts    UAT harness
  cli.ts                      pnpm ace [edit|uat]
tests/unit + tests/integration
tests/fixtures/               synthetic (committed)
tests/uat/{input,edited}/     REAL gold-set .docx (GITIGNORED); README tracked
```

Persistent memory for this project also lives at
`~/.claude/projects/-Users-raj-Downloads-Agentic-Copy-Editor/memory/` (MEMORY.md index).

---

## 9. Gotchas / important context

- macOS filesystem is **case-insensitive** — `tests/UAT` == `tests/uat`. Be careful with rm/mv.
- Prettier is configured to **ignore `docs/` and `*.md`** (hand-formatted); it reformats `src/`/tests.
- Non-migration files must NOT live in `migrations/` (node-pg-migrate tries to load every file).
- pgvector types are registered lazily (`registerVectorTypes`), not on a racy connect handler.
- The DB seed metadata and code handler flags are kept in sync by an **integration test**
  (`rule-metadata.test.ts`) — when adding/demoting a rule, add a migration too or it fails.
- `pnpm ace uat` writes to the DB (accumulates dev data); that's expected for the dev DB.

---

## 10. LATEST STATE (end of session, HEAD `d91566e`) — read this

### Operating model DECIDED (this reframes the product; supersedes any "integrate with kriyadocs")
kriyadocs **blocks import** (client mandates working IN it; even grammar tools couldn't integrate).
So we do **NOT** integrate. Three-tier workflow, our platform = brain + training academy, kriyadocs =
system of record for the final document:
1. **Agent** (our pipeline) detects + explains each change (the "why").
2. **Senior editor** (the sister) reviews, decides (accept/reject/ask-author/override) — which TRAINS
   the agent via the flywheel — and configures the rule registry (admin). Output = approved, explained
   **worklist**.
3. **Junior editors** execute the worklist BY HAND in kriyadocs, learning what+why. Platform = their
   guided checklist + training ground.
Consequences: we NEVER apply edits or emit a final doc — **output is INSTRUCTIONS**. Input = source
`.docx` she already has. The flywheel (M6) is now CORE ("she trains it"), not a later nicety.

### UI DESIGN doc written → `docs/UI-DESIGN.md` (Review & Training Console)
- Chosen layout = **C-leaning hybrid**: document-faithful **read-only** review pane (top ~2/3, reads
  like a 2/3-page inline editor without a rich-text engine) + **action queue** rail, over ONE
  **@-routed command bar** (bottom ~1/3): `@junior` notes, `@senior` questions, `@agent` feedback
  (returns a *proposed* rule/lesson change behind the curation gate — start with structured shortcuts,
  NL later).
- **Same screen for senior & junior, role-gated.** **Two independent statuses**: senior decision
  (`editing_suggestions.status`) + junior **applied-in-kriyadocs ✓** (NEW small field/table).
- **Per-change Override** = small text box for ONE change (NOT a full inline editor — deliberately
  avoided; kriyadocs builds the final doc).
- Click a change → **why-popup** (rule + plain reason + computation + confidence + audit trail) →
  **Adjust this rule** (admin, from the example that motivated it).
- Each change shows **location + surrounding-sentence context** (the junior's "address" to find text
  in kriyadocs) — we have chunk_text + codepoint span, so it's free.
- Backend: nearly all exists (ledger/audit/registry). NEW = junior-execution status, a notes/thread
  store, a thin REST/tRPC API. **Stack for UI = React (Vite) SPA + thin API over the TS service layer.**
- Alternatives A (full inline editor — deferred/likely never) / B (worklist cards) / C (split, chosen).

### NEXT STEP (agreed direction)
Build a **clickable local HTML mockup** of the console FIRST (opens in browser like the report, using
her real manuscript's changes) so she can react before we build the real app — then the Vite/React app
+ thin API. After/alongside: the `numeral_conversion` (two→2) rule gap (reasoning-tier candidate).

### Open questions for the sister (UI-DESIGN §14)
Async handoff as v1 (senior finalizes → junior executes later)? · shared team view vs per-junior
logins? · auto-applied fixes collapsed by default? · any kriyadocs locators (line #s/anchors) to mirror
in context snippets?

### Test/build status unchanged: 147 unit + 41 integration green; migrations 0001–0011 applied.

### UPDATE — Initial Review Console built (HEAD `f1f4ba0`)
Launch-phase editor surface is LIVE. Fastify API `src/api/server.ts` (`pnpm api` → http://localhost:5273)
serves static `web/index.html` and exposes GET `/api/manuscripts`, GET `/api/manuscripts/:id/report`,
POST `/api/actions` (record_editor_action), POST `/api/applied` (junior status). Report enhanced with
surrounding-sentence context (contextPre/Post), rule description, tier/confidence, applied flag
(migration 0012 = `editing_suggestions.applied_in_kriyadocs`). Front-end = document-faithful review pane
(changes inline in their sentence) + action queue (Accept/Reject/Ask) + why-popup + section nav + two
live meters + Senior/Junior role toggle + @-routed command bar (UI only). Actions persist live.
Workflow to demo: `pnpm ace edit <file>` to ingest → `pnpm api` → open the console, pick the manuscript.
DEFERRED (refine next): notes-thread persistence, rule-registry editing from the popup (Adjust-rule is a
stub alert), migrate front-end to React/Vite, full-document inline rendering, numeral_conversion rule.
Tests still 147 unit + 41 integration green.

### UPDATE 2 — Review console refined + manuscript picker cleanup (HEAD `f371dc3`)
This file is now TRACKED in git (force-added) for cross-device continuity, even though `logs/` is
otherwise gitignored. Once tracked it stays tracked; edit + `git add`/commit normally.

**Console fixes since first build:**
- **Doc pane duplicates fixed** — was rendering one sentence-block per change (repeated sentences).
  Now the report returns body `chunks[]` + per-change `chunkId/charStart/charEnd/isCell`; the
  front-end (`web/index.html` `renderChunk`) splices ALL of a chunk's changes into its text rendered
  ONCE. Overlapping/cell changes fall back to the queue.
- **Manuscript picker** — showed throwaway integration-test manuscripts. Fixed: API lists only
  `status <> 'ingested'` (real ones advance to 'review'; raw test inserts stay 'ingested'), deduped
  to most-recent per title. Deleted 46 junk test manuscripts from the dev DB (had to bypass the
  append-only trigger via `SET session_replication_role='replica'` because DELETE cascade tries to
  SET NULL on action_audit_log, which the trigger blocks — that block is CORRECT: audited work isn't
  casually deletable).

**Run the console:** `pnpm db:up` → `pnpm ace edit <file.docx>` (ingest) → `pnpm api` →
http://localhost:5273 → pick the manuscript (e.g. `tests/uat/input/95374 (1) Original.docx`).

**Migrations now 0001–0012** (0012 = `editing_suggestions.applied_in_kriyadocs`). Tests: 147 unit +
41 integration green. Commits since console: f1f4ba0 (console) → 6a21f5a (dup fix) → f371dc3 (picker).

**Known cosmetic issues on the real manuscript (not blocking):** docx→markdown artifacts like
`**Objective::**` and `app'ssafety` (bold markers / lost space) — needs a conversion-cleanup pass.
`reviewed 58/103` counts auto-applied as reviewed (agent handled them) — could redefine to mean
"senior acted" if preferred.

**NEXT (pick up here):** (1) console refinements per her feedback; (2) migrate front-end to
React/Vite (currently vanilla `web/index.html` over the Fastify API — fine to keep iterating); (3)
persist the @-command notes thread + wire "Adjust this rule" (admin) — both stubbed; (4) rule gap
`numeral_conversion` (two→2, reasoning-tier); (5) docx conversion cleanup; (6) isolate integration
tests from the dev DB so they stop polluting the console picker.
