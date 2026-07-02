/**
 * Shared detection helpers for deterministic rule handlers.
 * Regexes match on the raw string (UTF-16); this converts every match to a codepoint-based
 * `Candidate` (Principle 8) so downstream spans are consistent.
 */
import type { Candidate, RuleContext } from './registry.js';
import { codeUnitToCodepoint, codepointLength, sliceByCodepoint } from '../util/offsets.js';

/** Run a (global) regex over the text and return codepoint-span candidates. */
export function regexCandidates(text: string, re: RegExp): Candidate[] {
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const rx = new RegExp(re.source, flags);
  const out: Candidate[] = [];
  for (const m of text.matchAll(rx)) {
    const matched = m[0];
    if (matched.length === 0) continue; // guard against zero-width matches looping
    const start = codeUnitToCodepoint(text, m.index);
    out.push({ span: { start, end: start + codepointLength(matched) }, matched });
  }
  return out;
}

/** The text immediately preceding a candidate (codepoint-safe) — for context checks. */
export function textBefore(ctx: RuleContext, candidate: Candidate): string {
  return sliceByCodepoint(ctx.text, 0, candidate.span.start);
}

/** True iff the candidate sits inside an open parenthesis group (no closing `)` since the last `(`). */
export function isInsideParentheses(ctx: RuleContext, candidate: Candidate): boolean {
  const before = textBefore(ctx, candidate);
  return before.lastIndexOf('(') > before.lastIndexOf(')');
}
