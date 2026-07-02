/**
 * The deterministic format engine (SPEC Phase C). Runs span-scoped rule handlers over a
 * RuleContext and emits suggestion drafts. Pure and DB-free: the caller decides activation and
 * persistence. `autoApply` comes from the handler (per-rule policy), never from the tier.
 */
import type { RuleHandler, RuleContext } from '../rules/registry.js';
import type { SuggestionDraft } from '../domain/types.js';
import { SuggestionDraftSchema } from '../domain/types.js';

export interface EngineSuggestion {
  ruleId: string;
  /** Whether this suggestion may be auto-applied (context-free deterministic rules only). */
  autoApply: boolean;
  draft: SuggestionDraft;
}

const ENGINE = 'regex_engine_v1';

export function runFormatEngine(
  ctx: RuleContext,
  handlers: readonly RuleHandler[],
): EngineSuggestion[] {
  const out: EngineSuggestion[] = [];

  for (const handler of handlers) {
    if (handler.scope !== 'span') continue;
    for (const candidate of handler.detect(ctx)) {
      const res = handler.resolve(candidate, ctx);
      // 'llm' → Phase D; 'noop' → nothing to do.
      if (res.kind === 'noop' || res.kind === 'llm') continue;
      // Guard against a no-op edit slipping through.
      if (res.kind === 'edit' && res.proposed === candidate.matched) continue;

      const tier = handler.isDeterministic ? 'deterministic' : 'base_inference';
      const draft: SuggestionDraft =
        res.kind === 'edit'
          ? {
              chunkId: ctx.chunkId,
              ...(ctx.cellId !== undefined ? { cellId: ctx.cellId } : {}),
              ruleId: handler.ruleId,
              originatorEngine: ENGINE,
              originTier: tier,
              kind: 'edit',
              span: candidate.span,
              originalText: candidate.matched,
              proposedText: res.proposed,
              ...(res.confidence !== undefined ? { confidence: res.confidence } : {}),
            }
          : {
              chunkId: ctx.chunkId,
              ...(ctx.cellId !== undefined ? { cellId: ctx.cellId } : {}),
              ruleId: handler.ruleId,
              originatorEngine: ENGINE,
              originTier: tier,
              kind: 'author_query',
              span: candidate.span,
              originalText: candidate.matched,
              queryMessage: res.message,
            };

      // Validate the blackboard contract at the seam (fail loud on a malformed draft).
      out.push({
        ruleId: handler.ruleId,
        autoApply: res.kind === 'edit' && handler.isAutoApplicable,
        draft: SuggestionDraftSchema.parse(draft),
      });
    }
  }

  return out;
}
