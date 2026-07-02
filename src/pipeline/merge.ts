/**
 * Phase E — merge & arbitration (SPEC §5E). Pure interval arbitration over one chunk's suggestions.
 *
 * Precedence (highest first): deterministic > verified_memory > base_inference; then higher
 * confidence, then earlier createdAt, then lower id (stable). The higher-precedence claim owns a
 * contested sub-span; a lower claim is **split** so its non-overlapping remainder survives rather
 * than being dropped wholesale. author_query claims carry no replacement span and pass through.
 *
 * This layer decides span OWNERSHIP only (kept / superseded / split-into-spans / passthrough). How
 * a split remainder's proposed text is materialized is a separate concern (see mergeChunkInDb).
 */
import type { CharSpan } from '../util/offsets.js';
import type { OriginTier, SuggestionKind } from '../domain/types.js';
import { subtractIntervals, mergeIntervals, spansEqual } from '../util/intervals.js';

export interface MergeClaim {
  id: number;
  span: CharSpan;
  tier: OriginTier;
  kind: SuggestionKind;
  confidence?: number;
  /** Epoch millis (or any monotonic number) for the earlier-wins tiebreak. */
  createdAt?: number;
}

export type MergeOutcome =
  | { id: number; decision: 'kept'; span: CharSpan }
  | { id: number; decision: 'superseded' }
  | { id: number; decision: 'split'; survivingSpans: CharSpan[] }
  | { id: number; decision: 'passthrough' };

const TIER_RANK: Record<OriginTier, number> = {
  deterministic: 3,
  verified_memory: 2,
  base_inference: 1,
};

/** Sort comparator: highest precedence first. */
export function comparePrecedence(a: MergeClaim, b: MergeClaim): number {
  if (TIER_RANK[a.tier] !== TIER_RANK[b.tier]) return TIER_RANK[b.tier] - TIER_RANK[a.tier];
  const ca = a.confidence ?? -1;
  const cb = b.confidence ?? -1;
  if (ca !== cb) return cb - ca; // higher confidence wins
  const ta = a.createdAt ?? 0;
  const tb = b.createdAt ?? 0;
  if (ta !== tb) return ta - tb; // earlier wins
  return a.id - b.id; // stable
}

export function mergeChunk(claims: MergeClaim[]): MergeOutcome[] {
  const outcomes: MergeOutcome[] = [];

  // author_query claims don't compete for a replacement span.
  for (const c of claims) {
    if (c.kind === 'author_query') outcomes.push({ id: c.id, decision: 'passthrough' });
  }

  const edits = claims.filter((c) => c.kind === 'edit').sort(comparePrecedence);
  let occupied: CharSpan[] = [];
  for (const claim of edits) {
    const free = subtractIntervals(claim.span, occupied);
    if (free.length === 0) {
      outcomes.push({ id: claim.id, decision: 'superseded' });
      continue;
    }
    occupied = mergeIntervals([...occupied, ...free]);
    if (free.length === 1 && spansEqual(free[0]!, claim.span)) {
      outcomes.push({ id: claim.id, decision: 'kept', span: claim.span });
    } else {
      outcomes.push({ id: claim.id, decision: 'split', survivingSpans: free });
    }
  }

  return outcomes;
}
