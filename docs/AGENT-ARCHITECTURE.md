# Agent Architecture

> **Status:** foundational design (2026-07-02; updated 2026-07-03 with the deployment-phase model,
> §14, and the service-layer reframing of §5.7). Companion to `Agentic Copy Editor - SPEC.md`
> (data model + pipeline) and `ARCHITECTURE-REVIEW.md` (why the rule model looks the way it does).
> This document defines the **agent orchestration layer** and, above all, the **stable seams** —
> the contracts we commit to now so that features can be built iteratively without a foundational
> refactor. Read §5 (Stable Seams), §12 (Foundational vs Iterative), and §14 (Deployment phases) first.

---

## 1. Purpose & non-negotiables

The goal is a **robust, extensible foundation**. Functionality is built iteratively; the
*architecture* must not have to be rewritten to add the next competency. Three non-negotiables:

1. **Deterministic-first.** The mechanical majority of edits never touches an LLM. Reasoning is
   reserved, targeted, and justified by genuine ambiguity. This is the primary cost and accuracy
   lever — not an optimization to add later.
2. **Non-destructive & auditable.** Every agent output is a *suggestion* over immutable text,
   recorded in an append-only ledger. Nothing overwrites the manuscript; everything is traceable.
3. **Human-in-the-loop authority.** The system proposes and flags; a human editor decides. Where
   information is absent, the system *queries the author* — it never invents data.

Everything below serves these three.

---

## 2. Mental model: the seasoned copy editor

The design is modeled on how an expert copy editor actually works — **dual-process cognition**:

- **System 1 (fast, automatic):** internalized mechanical rules applied without deliberation —
  thousands separators, `%` spacing, trailing-zero stripping. Cheap, high-confidence, ~80% of edits.
- **System 2 (slow, deliberate):** engaged only when System 1 *flags* something ambiguous —
  "is `−3.4-1.1` a negative range or a subtraction?" Expensive, invoked rarely, by exception.

A seasoned editor also: holds the **whole paper in working memory** (cross-section consistency),
knows when she **lacks the data** (queries the author rather than guessing), and **improves with
experience** (internalizes house preferences). She is not one process — she is **several
specialist competencies plus the judgment to route between them and to stop and ask.**

That is the architecture: **specialist agents + a managing-editor orchestrator**, with a
deterministic engine as System 1 and reasoning agents as System 2.

> **Domain-expert input required.** The escalation thresholds (when to auto-fix vs. surface vs.
> query) and the author-query taxonomy cannot be derived from the guideline PDFs — they live in an
> expert editor's head. These must be elicited from a practicing copy editor and encoded; her
> overrides are also the flywheel's training data.

---

## 3. Architectural principles

1. **Regex is a tool agents call, never LLM-ified.** The LLM never applies a comma rule or does
   arithmetic. Its job is to *recognize the situation and route* to the right deterministic tool.
   Cognition lives at the leaves, not everywhere.
2. **Deterministic macro-orchestration; agentic micro-reasoning.** The phase graph is a fixed,
   debuggable workflow in *code*. An LLM never decides "what runs next." Agents reason *within* a
   step. This is the single most important reliability decision.
3. **Coordinate through the shared desk, not chatter.** Agents communicate by reading/writing the
   shared **suggestion ledger + audit log** (a blackboard), not by passing large messages to each
   other. This keeps the system debuggable, auditable, and free of coordination drift.
4. **Escalation ladder — climb only when stuck.** `deterministic → specialist reasoning → author
   query → human editor`. Each rung costs more; ascend only when the cheaper rung cannot be
   *correct*. This triage *is* the seasoned editor.
5. **Narrow, deep specialists.** One agent per genuine competency (not per rule). A narrow system
   prompt + a scoped rule set + its own tools = higher reliability and lower cost than one
   omniscient agent.
6. **Contracts are schemas, not prose.** Every agent emits validated structured output. Composable
   because typed. This is what makes the system extensible rather than entangled.

---

## 4. System topology

```
                         ┌───────────────────────────────────────────────┐
                         │         ORCHESTRATOR  (deterministic)          │
                         │  queue-driven workflow over phases A→F (§5.4)  │
                         │  routes by rule scope + tier; never an LLM     │
                         └───────────────────────────────────────────────┘
      dispatch │                 │                 │                 │ dispatch
               ▼                 ▼                 ▼                 ▼
      ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
      │  Structural  │  │    Stats     │  │Reconciliation│  │  Ambiguity   │   … specialists
      │    agent     │  │  Extraction  │  │    agent     │  │  Resolver    │   (§6)
      └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
             │ call            │ call            │ call            │ call
             ▼                 ▼                 ▼                 ▼
      ┌───────────────────────────── TOOL LAYER (§5.5) ──────────────────────────────┐
      │  Regex/format engine · math/derived checks · embedding client (Gemini) ·     │
      │  LLM client (Claude) · DB access · precision policy                          │
      └──────────────────────────────────────────────────────────────────────────────┘
             │  read / write (the ONLY inter-agent channel)
             ▼
      ┌──────────────────────── BLACKBOARD (§5.1) — Postgres ────────────────────────┐
      │  editing_suggestions (non-destructive)   ·   action_audit_log (append-only)   │
      │  extracted_statistics · manuscript_tables/table_cells · feedback_memory_*     │
      └──────────────────────────────────────────────────────────────────────────────┘
             ▲
             │  intent-scoped operations (§5.7)
      ┌───────────────────────── SERVICE LAYER (§5.7) ───────────────────────────────┐
      │  transport-agnostic operations: ingest · post_suggestion · run_deterministic  │
      │  · reconcile · merge_chunk · record_editor_action · retrieve_curated_lessons  │
      └──────────────────────────────────────────────────────────────────────────────┘
        ▲                       ▲                          ▲
        │ CLI runner (Phase 1)  │ REST/tRPC (Phase 2 UI)   │ MCP (Phase 3 Co-Pilot)   ← adapters (§14)
```

---

## 5. The stable seams (the anti-refactor contracts)

These are the interfaces we commit to now. Internals behind each seam evolve freely; the **seam
shapes do not**. If a future feature would force a seam to change, that is the signal to design,
not to bolt on.

### 5.1 Seam — the Blackboard (shared state)
**Already exists in the schema.** Every agent's output is a row in `editing_suggestions` (an
`edit` or an `author_query`), and every action is a row in `action_audit_log`. Agents never call
each other directly and never hold private state that matters — the ledger is the single source of
truth. *Consequence:* adding, removing, or re-running an agent cannot corrupt another agent's work,
and a new consumer (e.g. a web dashboard) just reads the ledger. This is why the current
non-destructive design is already multi-agent-ready.

**Contract:** a suggestion is `{ chunk_id | cell_id, rule_id, kind, origin_tier, span, original,
proposed?, confidence?, originator_engine }`. Immutable inputs; append semantics; status is the
only mutable field, changed only via `record_editor_action`.

### 5.2 Seam — the Rule Registry (the routing table)
The `style_rules` table holds **metadata** (`is_deterministic`, `is_auto_applicable`, `scope`,
`description`, `version`); a code-side **registry** binds each `rule_id` to a **handler**. The
orchestrator routes purely on this metadata — it does not know rule internals.

```ts
type RuleScope = 'span' | 'section' | 'document' | 'table';

interface RuleHandler {
  ruleId: string;
  scope: RuleScope;
  isDeterministic: boolean;
  isAutoApplicable: boolean;
  // Cheap detection over a bounded context → candidate sites.
  detect(ctx: RuleContext): Candidate[];
  // Resolution may be a pure function OR an LLM spec OR "cannot resolve → author query".
  resolve(c: Candidate, ctx: RuleContext): Resolution;
}

type Resolution =
  | { kind: 'edit'; proposed: string; confidence?: number }
  | { kind: 'llm'; promptSpec: LlmSpec }        // deferred to the reasoning tier
  | { kind: 'author_query'; message: string }   // data not present; flag, don't fix
  | { kind: 'noop' };
```

**Contract:** adding a guideline rule = add a `style_rules` row + register one `RuleHandler`. The
orchestrator, ledger, merge, audit, and dashboard are untouched. A *hybrid* rule (mechanical
detection, ambiguous resolution) is expressed by `detect()` in code and `resolve()` returning an
`llm` spec — no special case in the pipeline.

### 5.3 Seam — the Agent contract
Every specialist implements the same narrow interface. Its "smarts" (prompt, tools, model) are
internal; its I/O is fixed and typed.

```ts
interface Agent<In, Out> {
  name: string;
  version: string;                         // recorded on outputs for reproducibility
  run(input: In, tools: ToolBelt): Promise<Out>;   // Out is a validated schema
}
```

**Contract:** an agent takes a well-defined context (a chunk, a table, a registry slice) and
returns validated structured output. It reaches the outside world *only* through the injected
`ToolBelt` (§5.5) and the ledger. It never imports another agent. Swapping an agent's
implementation (or model) is invisible to the orchestrator.

### 5.4 Seam — the Orchestrator / Workflow
The orchestrator is a **deterministic, queue-driven workflow** over the phases (SPEC §5:
A → B → B.1 → B.2 → C → D → E → F). It is *code*, not an LLM. Each node dispatches to an agent or
engine, waits on structured output, and advances. Retries, idempotency, and per-chunk locking live
here.

```ts
// A phase is a pure description of {which agent/engine, over what unit, producing what}.
interface Phase { id: string; unit: 'manuscript'|'chunk'|'table'|'span'; run(job): Promise<void>; }
// The workflow is an ordered, branchable list of phases — data-driven, so new phases slot in.
const WORKFLOW: Phase[] = [ ingest, extract, reconcile, normalize, deterministicFix, resolveAmbiguous, merge ];
```

**Contract:** a new competency is a new `Phase` inserted into `WORKFLOW` (or a new branch keyed on
rule scope). Existing phases and their contracts are unchanged. Control flow never moves into an
LLM.

### 5.5 Seam — the Tool Layer
Deterministic capabilities are **tools**, injected into agents, never reimplemented inside them:
- **Format engine** — the regex/string rules (pure functions, codepoint-safe).
- **Math/derived checks** — proportion↔percentage, CI ordering, per-stat-type rounding.
- **Embedding client** — Gemini, behind an interface (§5.6).
- **LLM client** — Claude, behind an interface (§5.6).
- **Ledger/DB access** — typed repository methods, not raw SQL in agents.

**Contract:** tools have stable signatures and are the *only* way agents perform side effects or
computation-of-record. Agents compose tools; they do not embed provider SDKs or SQL.

### 5.6 Seam — Provider abstraction
LLM and embedding providers sit behind interfaces; the concrete model is a **config value**
recorded on every output (`embedding_model` on vectors; model+prompt version on LLM suggestions).

```ts
interface LlmClient  { complete(spec: LlmSpec): Promise<LlmResult>; }
interface Embedder   { embed(text: string): Promise<{ model: string; dims: number; vector: number[] }>; }
```

**Contract:** swapping Claude↔another model or Gemini↔another embedder is a config + re-embed job,
never a schema or pipeline change (the polymorphic vector store already guarantees this).

### 5.7 Seam — the Service Layer (transport-agnostic) + adapters
The SPEC §8 intent-scoped operations (`ingest_manuscript`, `post_suggestion`,
`run_deterministic_fixes`, `reconcile_statistics`, `merge_chunk_suggestions`,
`record_editor_action`, `retrieve_curated_lessons`, …) are implemented **once** as plain async
**service functions** over the ledger — validated, transactional, transport-agnostic. Every
consumer reaches them through a **thin adapter**:

- **CLI runner** — the Phase-1 (Test) surface: fire a manuscript from the IDE → report (§14).
- **REST/tRPC** — the Phase-2 (Launch) web UI: work pipeline + admin (§14).
- **MCP** — the Phase-3 (Agentic) surface: the same operations exposed as tools to a Co-Pilot (§14).

**Contract:** the *service layer* is the stable seam — **not any one transport.** An adapter is
thin (validate input → call a service function → serialize the result); adding or removing a
transport never touches the service functions, the pipeline, or the ledger. This is why **MCP is
deferred, not foundational**: it is one adapter over a core that is always needed. Never bury
reusable logic in a transport — the service function is the unit of reuse.

---

## 6. The specialist agents

| Agent | Competency | Primary mode | Key tools | Phase |
|---|---|---|---|---|
| **Structural** | Section/table anatomy; statistic-safe segmentation | deterministic | format engine, DB | A |
| **Stats Extraction** | Build ground-truth registry; assign `logical_key` (fuzzy) | reasoning-assisted | math, LLM, DB | B |
| **Reconciliation** | Derived math (det.) + cross-location agreement (fuzzy) | det. + judgment | math, precision policy, DB | B.1 |
| **Consistency** | Document/section/table-wide normalization | aggregate reasoning | format engine, DB | B.2 |
| **Format engine** *(tool, not an agent)* | The mechanical rule set | pure code | — | C |
| **Ambiguity Resolver** | Genuinely ambiguous span calls; uses retrieved lessons | LLM | LLM, embedder, memory | D |
| **Merge/Arbitration** *(orchestration step)* | Interval-split overlapping suggestions by tier | deterministic | DB, advisory lock | E |
| **Reflection** | Learn from overrides; write rule-anchored rationale | LLM | LLM, embedder, DB | 6.1 |

Roster grows by adding rows to this table + a `RuleHandler`/`Agent` — not by touching existing
members. Candidate future specialists (out of v1 scope): reference/citation checker, abbreviation
first-mention tracker, figure/caption checker, semantic overclaim reviewer (see §7 note on
document-scope *reasoning*).

---

## 7. The determinism ↔ reasoning decision framework

The core balance. For any rule, classify by a single test:

> **Can the correct output be computed as a total function over a bounded local context, with no
> genuine ambiguity?**

- **Yes → codify** (deterministic tool). Default here. Cheap, testable, auto-applicable if also
  context-free.
- **Detection yes, resolution ambiguous → hybrid.** Deterministic `detect()` routes to an LLM
  `resolve()`. (e.g. negative-range "to" vs subtraction.)
- **No — needs world knowledge/judgment that can't be enumerated → reason** (LLM tier, with the
  rule `description` as context + curated few-shot from verified memory).
- **Correct output depends on data not in the manuscript → neither; author query.** (e.g. exact P
  value, missing `n/N`, a table's absolute values.)

Rules that follow from this test:
- **Every LLM call must be justified by ambiguity a deterministic rule would get wrong.** If a
  regex is correct, using an LLM is a defect (cost + nondeterminism for nothing).
- **Deterministic ≠ auto-applicable.** Context-sensitive deterministic rules (P/α/β leading-zero;
  operator spacing in equations) are computed deterministically but *surfaced*, not auto-applied.
- **Note — a known frontier:** we have document-scope *determinism* (B.2) and span-scope
  *reasoning* (D), but **no document-scope semantic-reasoning phase** yet (e.g. "Discussion
  overclaims vs Results"). Out of v1 scope; it slots in as a new `Phase` + agent under the existing
  contracts when needed. Named here so its absence is a deliberate deferral, not a surprise.

---

## 8. Escalation ladder & confidence routing

```
 deterministic, context-free        → AUTO-APPLY   (status auto_applied, reversible)
 deterministic, context-sensitive   → SURFACE      (status pending, editor reviews)
 reasoning, confident               → SURFACE      (status pending, with confidence)
 reasoning, low-confidence          → SURFACE flagged as low-confidence / or AUTHOR QUERY
 data absent                        → AUTHOR QUERY  (kind author_query, no proposed_text)
 novel / out-of-policy              → HUMAN EDITOR  (HITL; may seed a new rule via curation)
```

Confidence and tier travel *with* the suggestion (`origin_tier`, `confidence`) so the dashboard and
the merge engine make consistent decisions. The ladder is policy encoded in the orchestrator +
`is_auto_applicable`, not scattered through agents.

### 8.1 The autonomy dial — earned per-rule, not switched globally

Autonomy is **not** a global flag flipped at "launch." It is the auto-apply line moving *outward,
per rule, as measured accuracy earns it.* This is exactly why `is_deterministic` and
`is_auto_applicable` are **separate** columns (§5.2), and why `action_audit_log` is indexed by
`(rule_id, created_at)` (§10): every accept / reject / override is a per-rule accuracy signal. A
rule graduates `surface → auto_applied` when its numbers justify it — and can be demoted if they
regress. The deployment phases (§14) are therefore gated by **measured quality, not features**: the
audit ledger is the measurement instrument, and Phase 1's real job is to *produce* those metrics.
Start conservative (narrow auto-apply set) and widen rule-by-rule as the flywheel proves each one.

---

## 9. Extensibility playbook (proving "no refactor")

Each scenario touches only additive surfaces:

| To add… | You change… | Untouched |
|---|---|---|
| A mechanical span rule | 1 `style_rules` row + 1 `RuleHandler` (pure `resolve`) | orchestrator, ledger, merge, MCP, dashboard |
| A consistency rule | 1 row (`scope=document`) + 1 normalizer in B.2 | everything else |
| A reasoning rule | 1 row (good `description`) + few-shot fixtures; Ambiguity Resolver picks it up | often *no new code* |
| A hybrid rule | 1 handler whose `detect()` is code and `resolve()` returns an `llm` spec | pipeline (no special case) |
| A whole new competency | 1 new `Agent` + 1 `Phase` in `WORKFLOW` | existing phases/contracts |
| A new guideline document | ingestion → candidate rows → **human curation gate** → active | code (data-only) |
| A new LLM/embedding provider | config + client impl behind `LlmClient`/`Embedder` | schema, pipeline |
| A new transport (CLI, REST, MCP) | a thin adapter over the service layer (§5.7) | service functions, pipeline, ledger |

The recurring pattern: **new capability = additive rows + additive handlers/agents behind stable
seams.** If a change would instead require editing a seam's shape, that is the design trigger.

**Admin-editability boundary (Phase 2, Launch).** The admin UI splits cleanly along a line already
in the design. Domain-expert admins can, from a UI: activate/deactivate rules, edit
`description`/thresholds, curate lessons (the curation gate), and **add *reasoning* rules** — those
are a `description` + few-shot examples the LLM tier consumes, **no code**. **New *deterministic*
rules still require a developer** (a `RuleHandler` in code) — arbitrary regex authored from a web
form is a safety hazard. Most new guideline rules land as reasoning rules admins can own via the
guideline-ingestion path; the fast, auditable deterministic core stays in engineering hands by
design. This is a feature, not a limitation.

---

## 10. Cross-cutting concerns (get these right in the foundation)

- **Observability = the audit log.** `action_audit_log` is a complete execution trace: every
  proposal, auto-apply, accept/reject/override/query, with engine + rule + editor. No separate
  logging system needed for the decision trail.
- **Idempotency.** Phases run on a queue with retries; re-running must not duplicate suggestions.
  De-dupe key: `(chunk_id|cell_id, char_start, char_end, rule_id, originator_engine)`. Design
  writes as upserts on this key.
- **Reproducibility & versioning.** Record `style_rules.version`, agent `version`, and model id on
  outputs. When a guideline changes (rules *do* evolve — e.g. the amended ≥1000 decimals rule),
  bump the rule version; verified memory tied to a superseded version is re-validated, not trusted
  blindly.
- **Cost governance.** Track LLM calls per manuscript; deterministic-first keeps the count low by
  construction. A per-manuscript budget with a visible counter guards against reasoning-tier creep.
- **Failure isolation.** One agent failing writes nothing corrupt (non-destructive ledger); the
  orchestrator retries or marks the phase failed without poisoning others. `manuscripts.status`
  captures `failed`.
- **Concurrency.** Merge (Phase E) runs under `pg_advisory_xact_lock(chunk_id)` (SPEC §5E) so
  concurrent engine writes + merges never race on a chunk.
- **Determinism in tests.** No live LLM/embedding calls in unit/CI runs — record/replay fixtures.
  The deterministic engine and reconciler are fully deterministic by contract.

---

## 11. Anti-patterns (explicit non-goals)

- ❌ **LLM orchestrating control flow.** The workflow DAG is code. LLMs reason within steps only.
- ❌ **Agent-to-agent chatter.** Coordinate through the ledger, never direct calls or shared memory.
- ❌ **LLM-ifying mechanical work.** If a regex is correct, an LLM is a defect.
- ❌ **Over-decomposition.** One agent per competency, not per rule. No agent swarm where a function
  suffices.
- ❌ **In-place mutation.** Never overwrite manuscript text; only append suggestions.
- ❌ **Unversioned rules or prompts.** Every reasoning surface is versioned for auditability and
  flywheel validity.
- ❌ **Provider lock-in in agents.** SDKs live behind `LlmClient`/`Embedder`, never inside an agent.

---

## 12. Foundational vs iterative — what must be right *now*

The point of this document: **build the seams first; fill the specialists later.** Milestone 0/1
establish the seams so no later milestone forces a refactor.

**Foundational (Milestones 0–1 — must be correct before feature work):**
1. The **blackboard** schema + non-destructive/append invariants (SPEC §4) — *done in design.*
2. The **Rule Registry** interface (§5.2) and the `style_rules` metadata that drives routing.
3. The **Agent contract** + **ToolBelt** injection seam (§5.3, §5.5) — even if only one trivial
   agent exists at first.
4. The **Orchestrator/Workflow** skeleton (§5.4) as a deterministic, queue-driven DAG with
   idempotency + per-chunk locking wired — even with phases stubbed.
5. **Provider abstraction** (§5.6) and the **service-layer seam** (§5.7) as thin interfaces.
6. **Codepoint-offset discipline** and **structured tables** (SPEC Principle 8, §3.1) baked into
   the substrate.

**Iterative (Milestones 2+ — add behind the seams, no refactor):**
- Fill the deterministic rule set (M2), then reconciliation + consistency (M3), merge (M4), the
  **service layer + CLI test-runner (M5)**, flywheel (M6), reasoning tier (M7). Transport adapters
  (MCP, REST) are added when their consumer is concrete (§14) — not upfront.
- Grow the specialist roster and the rule catalog rule-by-rule.
- Elicit and encode the domain expert's escalation thresholds and query taxonomy.
- Add the document-scope semantic-reasoning phase if/when guidelines demand it.

If we build items 1–6 as real seams now, every later addition is additive. That is the robustness
you asked for.

---

## 13. To be elicited from a practicing copy editor (domain expert)

Not derivable from the guideline documents; required to make the ladder concrete:
1. **Escalation thresholds** — for each rule family, when to auto-fix vs. surface vs. query.
2. **Author-query taxonomy** — the categories of "I can't fix this, ask the author," and their
   phrasing.
3. **Consistency arbitration** — when a paper is internally inconsistent, which occurrence is
   canonical (first use? most frequent? the abstract? house default?).
4. **Confidence calibration** — examples of "obvious," "worth flagging," and "genuinely
   ambiguous" per rule, to seed the reasoning tier and the flywheel.

---

## 14. Deployment phases (consumers over one service layer)

The product ships in **three phases of increasing autonomy**. They are three *consumers/adapters*
over the one service layer (§5.7) — **not three systems.** The deterministic-first engine,
non-destructive ledger, append-only audit, flywheel, and curation gate are identical throughout.
Only the adapter and the position of the auto-apply/HITL line (§8.1) change. Nothing here forces a
refactor between phases — that is the payoff of the seams.

| Phase | Consumer / adapter | Adds | Constant core |
|---|---|---|---|
| **1 · Test** | CLI runner fired from the IDE | run a manuscript → readable report (auto-applied vs pending vs author-query, with diffs) | engine · ledger · audit · reconcile · merge |
| **2 · Launch** | Web UI over REST/tRPC | work pipeline (upload · review · approve/reject/override) + admin (rule-data CRUD · curation · guideline ingestion) | *same* |
| **3 · Agentic** | Autonomous worker + Co-Pilot over MCP | file-pull triggers (watch folder / queue / Drive → pg-boss), minimum HITL | *same* |

**Phase 1 (the current product) is a refinement loop, not just a runner.** The CLI runner emits a
report; the domain expert (a practicing copy editor, §2/§13) reviews it; her overrides are
*simultaneously* (a) the **gold set** that defines "acceptable" and (b) the **flywheel's training
data**. Phase 1 therefore manufactures both the ground truth and the per-rule metrics (§8.1) that
gate the later phases. Fuel it with a small corpus of real manuscripts from the expert.

**Gates are measured, not scheduled.** 1→2: outputs acceptable on the gold set. 2→3:
consistent/accurate enough to reduce HITL, per audit-derived accept/override rates. The architecture
already carries the dial (§8.1) and the instrument (§10 audit); each phase turns the crank further.

**Why this ordering of adapters.** The CLI is the cheapest way to *drive and inspect* the whole
pipeline now, and its output is reproducible (ideal for refinement). REST arrives with the Launch
UI. MCP arrives with the Agentic Co-Pilot, where LLM-agent tool-interop is genuinely the right fit —
building it earlier would be a transport in search of a consumer.
