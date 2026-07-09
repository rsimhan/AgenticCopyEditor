/**
 * Hybrid range rule (AGENT-ARCHITECTURE §7, the canonical determinism↔reasoning example).
 * Detection is deterministic (a hyphen-joined pair where the first bound is negative), but the
 * resolution is genuinely ambiguous — "−3.4-1.1" could be the range −3.4 to 1.1, or the subtraction
 * −3.4 minus 1.1 — so `resolve()` defers to the reasoning tier (Phase D) with the span + context.
 */
import type { RuleHandler, Candidate, RuleContext, Resolution } from '../registry.js';
import { regexCandidates } from '../detect-util.js';
import type { LlmSpec } from '../../llm/client.js';

const SYSTEM =
  'You enforce JMIR statistical style. A numeric RANGE whose lower bound is negative must use the ' +
  'word "to" between the two numbers instead of a hyphen (e.g. "−3.4 to 1.1"). But if the ' +
  'expression is a subtraction/difference, it must be left unchanged. Decide which it is from the ' +
  'surrounding context. Reply with ONLY a JSON object and nothing else: ' +
  '{"action":"edit","proposed":"<the two numbers joined by \\" to \\">","confidence":<0-1>} if it ' +
  'is a range, or {"action":"noop"} if it is a subtraction.';

function buildSpec(c: Candidate, ctx: RuleContext): LlmSpec {
  const cps = [...ctx.text];
  const pre = cps.slice(Math.max(0, c.span.start - 60), c.span.start).join('');
  const post = cps.slice(c.span.end, c.span.end + 60).join('');
  return {
    system: SYSTEM,
    prompt: `Expression: "${c.matched}"\nContext: "…${pre}[${c.matched}]${post}…"\nIs "${c.matched}" a numeric range or a subtraction?`,
    maxOutputTokens: 128,
    temperature: 0,
  };
}

export const negativeRangeTo: RuleHandler = {
  ruleId: 'negative_range_to',
  scope: 'span',
  isDeterministic: false,
  isAutoApplicable: false,
  // A negative lower bound (a real minus/en dash — not a plain hyphen, to avoid hyphenated IDs),
  // then a hyphen, then a number.
  detect: (ctx) => regexCandidates(ctx.text, /[−–]\d[\d.,]*-\d[\d.,]*/),
  resolve: (c, ctx): Resolution => ({ kind: 'llm', promptSpec: buildSpec(c, ctx) }),
};
