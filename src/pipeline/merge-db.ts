/**
 * Phase E persistence (SPEC §5E). Runs the pure arbitration (merge.ts) for one chunk inside a
 * transaction guarded by a per-chunk advisory lock, so concurrent engine writes + merges cannot
 * race on the same chunk. Applies outcomes to `editing_suggestions`:
 *   - superseded → status = 'superseded'
 *   - split      → truncate the row's span + original_text to the surviving remainder (re-sliced
 *                  from the row's own original_text; proposed_text is left for editor review)
 *   - kept / passthrough → unchanged
 *
 * Split simplification: if a claim survives on more than one remainder (it straddles a higher-tier
 * claim on both sides — rare), the largest remainder is kept and the others are logged. The merge's
 * invariant (no overlapping winning spans) always holds.
 */
import type { PoolClient } from '../db/pool.js';
import { withTransaction } from '../db/pool.js';
import { mergeChunk, type MergeClaim } from './merge.js';
import { sliceByCodepoint } from '../util/offsets.js';
import type { OriginTier, SuggestionKind } from '../domain/types.js';

export interface MergeSummary {
  kept: number;
  superseded: number;
  split: number;
  passthrough: number;
}

/** Merge one chunk within an existing transaction/client (caller owns the transaction). */
export async function mergeChunkWithClient(
  client: PoolClient,
  chunkId: number,
  log: (msg: string) => void = () => {},
): Promise<MergeSummary> {
  // Serialize merges on this chunk (SPEC §5E concurrency note).
  await client.query('SELECT pg_advisory_xact_lock($1)', [chunkId]);

  const { rows } = await client.query(
    `SELECT suggestion_id, cell_id, char_start_index, char_end_index, origin_tier, kind, confidence,
            (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS created_ms, original_text
       FROM editing_suggestions
      WHERE chunk_id = $1 AND status IN ('pending', 'auto_applied')
      ORDER BY suggestion_id`,
    [chunkId],
  );

  const originals = new Map<number, { start: number; text: string }>();
  // Spans are only comparable within one text unit. A table chunk holds many cells, each its own
  // coordinate space, so partition claims by cell_id (NULL = the prose chunk) and merge each group
  // independently. Without this, cell-relative spans from different cells would collide.
  const byUnit = new Map<number, MergeClaim[]>();
  for (const r of rows) {
    originals.set(r.suggestion_id, { start: r.char_start_index, text: r.original_text });
    const unit = r.cell_id ?? -1;
    const claim: MergeClaim = {
      id: r.suggestion_id,
      span: { start: r.char_start_index, end: r.char_end_index },
      tier: r.origin_tier as OriginTier,
      kind: r.kind as SuggestionKind,
      ...(r.confidence !== null ? { confidence: Number(r.confidence) } : {}),
      createdAt: Number(r.created_ms),
    };
    (byUnit.get(unit) ?? byUnit.set(unit, []).get(unit)!).push(claim);
  }

  const summary: MergeSummary = { kept: 0, superseded: 0, split: 0, passthrough: 0 };
  const outcomes = [...byUnit.values()].flatMap((claims) => mergeChunk(claims));
  for (const outcome of outcomes) {
    if (outcome.decision === 'kept') summary.kept++;
    else if (outcome.decision === 'passthrough') summary.passthrough++;
    else if (outcome.decision === 'superseded') {
      summary.superseded++;
      await client.query(
        `UPDATE editing_suggestions SET status = 'superseded' WHERE suggestion_id = $1`,
        [outcome.id],
      );
    } else {
      summary.split++;
      const src = originals.get(outcome.id)!;
      const best = outcome.survivingSpans.reduce((a, b) =>
        b.end - b.start > a.end - a.start ? b : a,
      );
      if (outcome.survivingSpans.length > 1) {
        log(
          `merge: suggestion ${outcome.id} split into ${outcome.survivingSpans.length} remainders; keeping the largest`,
        );
      }
      const newOriginal = sliceByCodepoint(src.text, best.start - src.start, best.end - src.start);
      await client.query(
        `UPDATE editing_suggestions
            SET char_start_index = $2, char_end_index = $3, original_text = $4
          WHERE suggestion_id = $1`,
        [outcome.id, best.start, best.end, newOriginal],
      );
    }
  }
  return summary;
}

/** Merge one chunk in its own transaction (opens a client from the shared pool). */
export function mergeChunkInDb(
  chunkId: number,
  log: (msg: string) => void = () => {},
): Promise<MergeSummary> {
  return withTransaction((client) => mergeChunkWithClient(client, chunkId, log));
}
