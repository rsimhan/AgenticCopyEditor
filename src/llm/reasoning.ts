/**
 * The reasoning tier — Phase D (AGENT-ARCHITECTURE §5.4, §7). Pure engine, mirroring
 * `format-engine.ts`: given a bounded context, the rule handlers, and an injected `LlmClient`, it
 * resolves the candidates whose deterministic `resolve()` deferred to the LLM (`kind: 'llm'`) into
 * suggestion drafts. No DB and no provider SDK here — the caller (service/run.ts) loads chunks and
 * persists, and tests inject a recorded/stub client (§10: no live calls in CI).
 *
 * The model must answer each candidate with a small JSON decision; we validate it at the seam so a
 * malformed or hallucinated reply degrades to "skip", never to a bad edit.
 */
import { z } from 'zod';
import type { LlmClient } from './client.js';
import type { RuleHandler, RuleContext } from '../rules/registry.js';
import type { SuggestionDraft } from '../domain/types.js';
import { SuggestionDraftSchema } from '../domain/types.js';

/** The structured contract the reasoning model returns for one ambiguous candidate. */
export const ReasoningDecisionSchema = z.object({
  action: z.enum(['edit', 'noop', 'author_query']),
  proposed: z.string().optional(),
  message: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type ReasoningDecision = z.infer<typeof ReasoningDecisionSchema>;

/** Extract and validate the decision from the model's text (tolerates code fences / surrounding prose). */
export function parseDecision(text: string): ReasoningDecision | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return ReasoningDecisionSchema.parse(JSON.parse(m[0]));
  } catch {
    return null;
  }
}

/** A per-manuscript call budget (cost governance, §10). */
export interface CallBudget {
  remaining(): number;
  spend(): void;
}

export function makeBudget(max: number): CallBudget {
  let spent = 0;
  return {
    remaining: () => max - spent,
    spend: () => {
      spent += 1;
    },
  };
}

export interface ChunkReasoning {
  drafts: SuggestionDraft[];
  calls: number;
}

/**
 * Resolve every LLM-deferred candidate in one context into drafts. Deterministic control flow — the
 * LLM only decides *within* a candidate, never what runs next (§3). Budget-guarded; a failed call,
 * unparseable reply, or no-op yields no draft.
 */
export async function resolveChunkAmbiguities(
  ctx: RuleContext,
  handlers: readonly RuleHandler[],
  client: LlmClient,
  budget: CallBudget,
): Promise<ChunkReasoning> {
  const drafts: SuggestionDraft[] = [];
  let calls = 0;

  for (const handler of handlers) {
    for (const candidate of handler.detect(ctx)) {
      const res = handler.resolve(candidate, ctx);
      if (res.kind !== 'llm') continue; // deterministic/noop already handled by Phase C
      if (budget.remaining() <= 0) return { drafts, calls }; // hit the per-manuscript ceiling

      budget.spend();
      calls += 1;
      let text: string;
      let model: string;
      try {
        const out = await client.complete(res.promptSpec);
        text = out.text;
        model = out.model;
      } catch {
        continue; // provider error → skip this candidate, never poison the ledger
      }

      const decision = parseDecision(text);
      if (!decision || decision.action === 'noop') continue;

      const common = {
        chunkId: ctx.chunkId,
        ...(ctx.cellId !== undefined ? { cellId: ctx.cellId } : {}),
        ruleId: handler.ruleId,
        originatorEngine: `reasoning:${model}`,
        originTier: 'base_inference' as const,
        span: candidate.span,
        originalText: candidate.matched,
      };

      let draft: SuggestionDraft | null = null;
      if (
        decision.action === 'edit' &&
        decision.proposed !== undefined &&
        decision.proposed !== candidate.matched
      ) {
        draft = {
          ...common,
          kind: 'edit',
          proposedText: decision.proposed,
          ...(decision.confidence !== undefined ? { confidence: decision.confidence } : {}),
        };
      } else if (decision.action === 'author_query') {
        draft = {
          ...common,
          kind: 'author_query',
          queryMessage: decision.message ?? 'Needs author input.',
        };
      }
      if (draft) drafts.push(SuggestionDraftSchema.parse(draft)); // validate at the seam
    }
  }

  return { drafts, calls };
}
