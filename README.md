# Agentic Copy Editor

An active-learning, **human-in-the-loop** copy-editing platform that enforces publication style
guides for **statistical, numerical, and mathematical reporting** in scientific manuscripts
(JMIR house style + statistics guidelines). Deterministic-first, non-destructive, auditable.

## Documentation (read in this order)

1. [`docs/Agentic Copy Editor - SPEC.md`](docs/Agentic%20Copy%20Editor%20-%20SPEC.md) — data model, pipeline phases, MCP tool surface, build plan.
2. [`docs/ARCHITECTURE-REVIEW.md`](docs/ARCHITECTURE-REVIEW.md) — why the rule model looks the way it does (spec vs. real guidelines).
3. [`docs/AGENT-ARCHITECTURE.md`](docs/AGENT-ARCHITECTURE.md) — the multi-agent orchestration layer and the **stable seams** that keep it extensible.

## Stack

TypeScript / Node 22+ · PostgreSQL 16 + pgvector · MCP server (tools) · Anthropic Claude
(reasoning tier) · Google Gemini (embeddings). Claude Code is the build environment; production
is a queue-driven worker that calls the MCP tools.

## Getting started

```bash
corepack enable pnpm        # pnpm is the package manager
pnpm install
cp .env.example .env        # fill in ANTHROPIC_API_KEY / GEMINI_API_KEY when needed
pnpm db:up                  # start Postgres 16 + pgvector (Docker)
pnpm migrate:up             # apply migrations (Milestone 1+)
pnpm test                   # run the deterministic unit suite
pnpm typecheck              # strict tsc, no emit
```

## Architecture in one paragraph

The system is modeled on a seasoned copy editor: a fast **deterministic engine** (System 1)
handles the mechanical majority of edits; a **reasoning tier** (System 2, Claude) is invoked only
for genuine ambiguity; anything needing data not in the manuscript becomes an **author query**
rather than a fabricated value. Specialist agents (structural, extraction, reconciliation,
consistency, ambiguity resolver, reflection) are coordinated by a **deterministic orchestrator**
and communicate only through a non-destructive **suggestion ledger + append-only audit log** (the
blackboard). New guidelines are added as `style_rules` rows + rule handlers behind stable seams —
no pipeline refactor. See [`docs/AGENT-ARCHITECTURE.md`](docs/AGENT-ARCHITECTURE.md).

## Build status

- **Milestone 0 — Scaffold & seams** ✅ project + Docker + migration runner; the stable seams
  (blackboard, rule registry, agent contract + ToolBelt, deterministic orchestrator, provider
  abstraction, MCP boundary) as typed interfaces with the workflow phases stubbed; codepoint-offset
  utility (Principle 8); Vitest suite green.
- **Milestone 1 — Schema** ✅ 6 ordered up/down migrations from SPEC §4 (all 12 tables + table
  geometry + precision policy), append-only trigger on `action_audit_log`, seeded `style_rules`
  (24), `stat_precision_policy` (9), editors. Integration smoke test inserts one row per table and
  exercises the `kind`/`proposed_text` and append-only invariants; full down→up cycle verified.
- **Milestone 2 — Deterministic engine** ✅ 15 span-scoped rule handlers (pure `detect`/`resolve`)
  covering statistical + mechanical house-style rules, each with an `(input, expected)` test table
  including the tricky cases (`6500` unchanged, `25.0%→25%`, P/α/β leading-zero exception,
  equation-safe operator spacing, codepoint-correct spans). Per-rule auto-apply enforced. Registry
  ↔ DB metadata guarded by an integration test. 79 unit + 20 integration tests green.
- **Milestone 3 — Extraction + reconciliation + consistency** ✅ Phase B extractor (p-values,
  percentages, proportions, CI bounds, sample sizes) with codepoint spans; heuristic `logical_key`;
  B.1a deterministic derived checks (n/N↔%, CI ordering) using per-stat-type precision so it never
  false-alarms on rounding (25% vs 24.8%); B.1b fuzzy cross-location agreement → `author_query` at
  `base_inference`; B.2 consistency normalizers (table range-style, decimal-place). 106 unit + 29
  integration tests green (incl. the abstract-vs-table E2E: mismatch → 1 flag, consistent → 0).
- Milestones 4–7 — merge & arbitration → MCP server → flywheel + curation → thin LLM tier.

## Layout

```
docs/            design docs (SPEC, reviews)
migrations/      ordered SQL migrations (node-pg-migrate)
src/
  config/        env loading + validation
  domain/        shared contract types (blackboard vocabulary)
  db/            pool + ledger (blackboard) repository seam
  rules/         rule registry (routing table)
  agents/        agent contract
  orchestrator/  deterministic phase workflow
  tools/         ToolBelt: math checks, injected capabilities
  llm/           LlmClient seam (Claude)
  embedding/     Embedder seam (Gemini)
  mcp/           external MCP tool surface
  util/          codepoint-offset utilities
tests/           unit (deterministic) + integration (Postgres)
```
