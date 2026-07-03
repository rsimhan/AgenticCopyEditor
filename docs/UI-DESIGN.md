# UI Design — Review & Training Console

> **Status:** design (2026-07-03). The editor-facing surface for the platform. Companion to
> `AGENT-ARCHITECTURE.md` (§14 deployment phases — this is the **Launch** surface) and built over
> the existing service layer, suggestion ledger, audit log, and rule registry — **no backend
> rework**. Every screen element is a view over data we already produce.

---

## 1. Why this exists (the operating model)

The client's production platform **kriyadocs** does not allow import (offline/grammar tools can't
integrate; the client mandates working *in* kriyadocs). So we do **not** integrate with it. Instead,
a three-tier workflow where our platform is the brain + the training academy, and kriyadocs stays
the system of record where the final document is produced:

1. **Agent** (our pipeline) detects issues and explains each one.
2. **Senior editor** reviews the agent's work, decides each change, **trains** the agent (accept /
   reject / override / ask-author), and configures the rule registry. Output = an approved,
   explained **worklist**.
3. **Junior editors** execute the worklist by hand in kriyadocs, **learning the what + why** as they
   go. The platform is their guided checklist and training ground.

We never apply edits or emit a final document — **our output is instructions.** Input is the source
`.docx` the editor already has (kriyadocs blocks import, not her own files).

---

## 2. Design principles

- **One screen, role-gated.** Senior and junior see the same layout so juniors learn from the exact
  view the senior uses; available *actions* differ by role.
- **Reads like the manuscript, isn't a rich-text editor.** The review pane shows the section's real
  text with changes marked inline (read-only + clickable). With generous real estate it looks like a
  two-thirds-page inline editor — we keep the reading feel and skip the hard part (free-form tracked
  editing), which kriyadocs and per-change override cover.
- **The "why" is first-class.** Explainability is both QC (senior verifies) and pedagogy (junior
  learns). Every change exposes its rule, plain-language reason, any computation, confidence, and
  audit trail.
- **Fix the rule from the example that broke it.** Admin (rule registry) is reachable *from* the
  change that motivates it, not a distant screen.
- **Instructions, not mutation.** Nothing is overwritten; the worklist tells a human what to change
  and where, plus why.

---

## 3. Users & roles

| Role | Goal | Can do |
|---|---|---|
| **Senior editor** | Review, decide, train, configure | Accept · Reject · Ask-Author · Override (per change) · `@agent` (train) · `@junior` (note) · open & tweak the rule registry (admin) |
| **Junior editor** | Execute the worklist in kriyadocs; learn | Read changes + the *why* · mark each **applied-in-kriyadocs** ✓ · `@senior` (ask) · read notes |
| **Agent** | Detect + explain (upstream) | Produces suggestions; receives `@agent` feedback as *proposed* rule/lesson changes (curation-gated) |

Same information architecture for all; capabilities are gated by role.

---

## 4. Layout

Chosen approach: **C-leaning hybrid** — a document-faithful review pane (top ~2/3) over a single
`@`-routed chat/command bar (bottom ~1/3), with a right rail for the action queue and section
navigation.

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Manuscript · JMIR Ment Health           Abstract ▸ Methods ▸ Results       │  header: section nav
│                                          reviewed 8/23  ·  applied 3/23      │  + two progress meters
├────────────────────────────────────────────────┬──────────────────────────┤
│  ABSTRACT                                        │  CHANGES · this section  │
│                                                  │                          │
│  …the response rate reached  ⟨18 %→18%⟩  across  │ ● 18 %→18%   space before │  right rail =
│  ⟨36127→36,127⟩ participants. The odds ratio was │   %      ✓ ✗ ? ⋯         │  action queue
│  3.1 (95% CI 2.2–4.8; ⟨P = .03→P<.03⟩), trending │ ● 36127→36,127  thousands │  (click syncs with
│  ⟨towards→toward⟩ a benefit…                     │ ⚠ 25% vs body 26%  ask    │   the inline mark)
│                                                  │ ✓ towards→toward  done    │
│  ⟨25%⟩ ⚠ disagrees with the body (26%)           │ …                        │
│                            (read-only, scrolls)  │                          │
├────────────────────────────────────────────────┴──────────────────────────┤
│  💬  @junior — watch the CI on the odds ratio, likely a typo                 │  ONE bar, @-routed
│      @agent — stop flagging numbers inside a DOI                            │  (notes + commands)
│  [ type a note or command…                                          ] Send  │
└───────────────────────────────────────────────────────────────────────────┘

click a change  ▸  ┌───────────────────────────────────────────────┐
                   │  Why  ·  “JMIR house style — no space before %” │
                   │  Rule: percent_no_space   Confidence: high      │
                   │  Status: auto-applied     [ Audit trail ]       │
                   │  ─────────────────────────────────────────────  │
                   │  ✓ Accept   ✗ Reject   ? Ask author   ✎ Override │
                   │  [ Adjust this rule ▸ ]            (admin only)  │
                   └───────────────────────────────────────────────┘
```

- **Header** — section breadcrumb/nav (jump between sections) + **two progress meters** (see §6).
- **Review pane (main, ~2/3)** — the section's actual prose with each change rendered inline as a
  tracked-change mark `⟨old→new⟩` (deletions struck, insertions tinted). Read-only. Clicking a mark
  opens the why-popup and highlights the matching queue row.
- **Action queue (right rail)** — the same changes as a scannable list for fast triage; row and
  inline mark stay in sync. Good for "work top-to-bottom."
- **Command bar (bottom ~1/3)** — one input, routed by `@mention` (§7).

Responsive: on a narrow screen the right rail collapses under the pane; the bar stays pinned.

---

## 5. Representing a change

Each change shows, at minimum:

- **Location + context** — the surrounding sentence, with the change highlighted. *This is the
  address* — a junior uses it to find the text in kriyadocs. (We have the chunk text + codepoint
  span, so this is free.)
- **Before → after** — `18 %` → `18%`; for deletions, `®` → *removed*; for author queries, the
  flagged text + the question.
- **A plain-language rule name** — "Space before a percent sign", not `percent_no_space`.
- **A state chip** — Applied · Review · Author query (from `status`/`kind`).
- **Tier/confidence** — carried for sorting and trust; surfaced in the why-popup.

Auto-applied fixes are shown (collapsed/greyed) so nothing is hidden — the senior can expand to
confirm; juniors see them as "already correct, apply verbatim."

---

## 6. Two independent statuses (important)

Because juniors transcribe by hand, execution is tracked **separately** from the senior's decision:

- **Senior decision** — `pending → accepted | rejected | overridden | queried` (maps to
  `editing_suggestions.status` + `record_editor_action`).
- **Junior execution** — `applied-in-kriyadocs ✓ | not yet`. A per-change checkbox the junior ticks.

Two progress meters in the header: **reviewed X/Y** (senior) and **applied X/Y** (junior). A change
is "done" only when accepted *and* applied. (Junior execution is a small new field — see §11.)

---

## 7. The command bar — `@`-routed

One input; the `@mention` tells the system the audience:

- **`@junior …`** — a note/instruction. Anchors to the selected change if one is active (surfaces
  right where the junior needs it), else to the section. Persisted; juniors see it in context.
- **`@senior …`** — a junior asks a question; the senior answers once, visible to all → the learning
  loop.
- **`@agent …`** — feedback that shapes behavior. **Never reconfigures silently** — it returns a
  *proposed* change behind the curation gate, e.g. `@agent stop flagging DOIs` →
  *"Add guard: skip numbers inside URLs/DOIs? [Confirm]"*. Phased:
  - **v1** — structured shortcuts: "reject all of this rule here", "disable this rule",
    "always/never auto-apply this rule". Deterministic, safe.
  - **later** — free-form natural language interpreted by the reasoning layer into a proposed rule
    change or a curated lesson (the flywheel), which the senior confirms.

Messages form a lightweight thread per manuscript, anchorable to a change or section.

---

## 8. The why-popup (QC) → rule registry (Admin)

Clicking any change opens progressive disclosure:

1. **Why** — plain-language reason + `rule_id`, tier, confidence, computation (e.g. "150/200 = 75%,
   not 80%").
2. **Actions** — Accept · Reject · Ask-Author · **Override** (a single text box to replace the
   proposed text for *this* change — not a document editor).
3. **Audit trail** — the append-only record (who/what/when) for this change and its rule.
4. **Adjust this rule ▸** (admin/senior only) — opens the rule's registry entry: toggle active,
   auto-apply on/off, edit the description, adjust thresholds, or add a curated example. Changes are
   versioned; verified lessons pass the curation gate.

This is the QC and Admin surfaces, reached from the concrete example — no separate navigation needed
(a standalone registry browser can come later for bulk work).

---

## 9. Navigation & scale

Real manuscripts have 100+ changes. Provide:

- **Section nav** with per-section counts; "next unreviewed" jump.
- **Filters** — by status (pending / queries / rejected), by rule/pattern, by tier.
- **Progress** — the two meters (§6); a manuscript is "ready for kriyadocs" when all reviewed.

---

## 10. Alternatives considered

- **A · Document-centric** (full inline tracked-changes editor) — most immersive, but requires a
  real rich-text tracking editor: the highest-risk, highest-effort piece, and largely unnecessary
  since the final document is built in kriyadocs.
- **B · Worklist-centric** (change cards only) — fastest to ship; a direct evolution of the existing
  HTML report; reads as a to-do list.
- **C · Split** (document-faithful read-only pane + action queue) — **chosen (B/C hybrid).** Keeps
  the "reading the manuscript" feel *and* the fast checklist, without a rich-text editor. Evolves
  toward A only if the senior finds she misses free-form inline editing.

The bottom command bar, why-popup, `@`-routing, and two-status model are identical across A/B/C —
only the top pane's rendering differs, so the choice isn't a lock-in.

---

## 11. Backend mapping (what already exists vs. new)

| UI element | Backed by |
|---|---|
| Review pane / queue | `editing_suggestions` (span, original/proposed, rule, tier, status) + chunk text for context |
| Accept/Reject/Ask/Override | `record_editor_action` (status update + append-only audit) |
| Why-popup | `style_rules` (description) + suggestion tier/confidence + `action_audit_log` |
| Adjust-rule (admin) | `style_rules` CRUD + curation gate (`feedback_memory_records`) |
| `@agent` feedback | curated-lesson / rule-tuning proposals (curation gate) |
| Section nav / context | `manuscript_chunks` (section_name, region, chunk_text) |

**New backend work is small:** (a) a **junior-execution status** per change (a column or a small
join table), (b) a **notes/thread** store for the command bar (manuscript/section/change-anchored
messages), (c) a thin **REST/tRPC API** exposing the service layer to the web front-end. The heavy
lifting (detection, explanation, audit, registry) is done.

**Stack:** a React (Vite) single-page app over a thin API in front of the existing TypeScript service
layer. Same repo, same language.

---

## 12. Deferred (explicitly, not surprises)

- Full inline tracked-changes **editing** (type anywhere) — approach A; likely never needed.
- **Live** senior↔junior collaboration — v1 is **async handoff** (senior finalizes → junior executes
  later, with notes intact).
- Free-form natural-language `@agent` interpretation — starts as structured shortcuts (§7).
- A standalone **rule-registry browser** for bulk admin — reachable per-change first.
- Verifying the kriyadocs output (kriyadocs blocks export too) — remains a manual senior spot-check.

---

## 13. Build phasing

1. **Read-only review console** — section nav, document-faithful pane + queue, context snippets,
   why-popup (why + audit), Accept/Reject/Ask/Override, two-status tracking. Over a thin API.
2. **Command bar** — `@junior`/`@senior` notes (anchored), then `@agent` structured shortcuts.
3. **Admin from the popup** — toggle/auto-apply/threshold/description edits + curated examples.
4. **Polish** — filters, "next unreviewed", collapsed auto-applied, responsive rail.
5. **Later** — NL `@agent`, standalone registry browser, (maybe) approach-A inline editing.

---

## 14. Open questions

- Confirm **async handoff** as the v1 collaboration model (senior finalizes → junior executes).
- Do juniors need their own **login/identity**, or is it one shared team view with a role toggle?
- Should auto-applied fixes appear **collapsed by default** (recommended) or inline with the rest?
- Any kriyadocs-specific **locators** juniors rely on (line numbers, section anchors) we should mirror
  in the context snippet to speed finding text?
