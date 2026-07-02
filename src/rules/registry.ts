/**
 * Rule Registry seam (AGENT-ARCHITECTURE §5.2) — the orchestrator's routing table.
 *
 * A guideline rule enters the system as a `style_rules` row (metadata) + one `RuleHandler`
 * (behavior) registered here. The orchestrator routes purely on metadata (scope, determinism);
 * it does not know a rule's internals. Adding a rule is therefore additive — no pipeline change.
 *
 * A rule's `resolve()` returns one of four outcomes, which is exactly the determinism↔reasoning
 * decision framework (AGENT-ARCHITECTURE §7):
 *   - edit         → deterministic fix computed in code
 *   - llm          → hand off to the reasoning tier (hybrid rule: mechanical detect, ambiguous fix)
 *   - author_query → the fix needs data not in the manuscript; flag, don't fabricate
 *   - noop         → detected candidate is actually fine
 */
import type { RuleScope, CharSpan } from '../domain/types.js';
import type { LlmSpec } from '../llm/client.js';

/** The bounded context a rule sees: the text unit plus light metadata. */
export interface RuleContext {
  chunkId: number;
  cellId?: number;
  /** The text this rule operates over (chunk_text or cell_text). */
  text: string;
  sectionName?: string;
  /** True when `text` is a table cell, so table-scoped rules can adjust behavior. */
  isTableCell?: boolean;
}

/** A site a rule flagged as a candidate for action. */
export interface Candidate {
  span: CharSpan;
  /** The exact matched substring (codepoint-sliced), for convenience + logging. */
  matched: string;
}

export type Resolution =
  | { kind: 'edit'; proposed: string; confidence?: number }
  | { kind: 'llm'; promptSpec: LlmSpec }
  | { kind: 'author_query'; message: string }
  | { kind: 'noop' };

export interface RuleHandler {
  readonly ruleId: string;
  readonly scope: RuleScope;
  readonly isDeterministic: boolean;
  readonly isAutoApplicable: boolean;
  /** Cheap detection over the bounded context → candidate sites. */
  detect(ctx: RuleContext): Candidate[];
  /** Resolve one candidate into an edit, an LLM handoff, an author query, or a noop. */
  resolve(candidate: Candidate, ctx: RuleContext): Resolution;
}

/**
 * In-memory registry. Handlers register at startup; the orchestrator queries by scope. The
 * `style_rules` DB rows are the source of truth for which rules are active/versioned — this
 * registry binds those ids to code. A handler with no matching active DB row is inert.
 */
export class RuleRegistry {
  private readonly handlers = new Map<string, RuleHandler>();

  register(handler: RuleHandler): this {
    if (this.handlers.has(handler.ruleId)) {
      throw new Error(`duplicate rule handler registered: ${handler.ruleId}`);
    }
    this.handlers.set(handler.ruleId, handler);
    return this;
  }

  get(ruleId: string): RuleHandler | undefined {
    return this.handlers.get(ruleId);
  }

  byScope(scope: RuleScope): RuleHandler[] {
    return [...this.handlers.values()].filter((h) => h.scope === scope);
  }

  all(): RuleHandler[] {
    return [...this.handlers.values()];
  }
}
