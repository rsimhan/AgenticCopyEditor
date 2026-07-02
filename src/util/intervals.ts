/**
 * Half-open interval arithmetic over codepoint spans, used by the merge engine (SPEC §5E).
 */
import type { CharSpan } from './offsets.js';

/** Merge a set of spans into the minimal set of non-overlapping, sorted spans. */
export function mergeIntervals(spans: CharSpan[]): CharSpan[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: CharSpan[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/**
 * Subtract `occupied` intervals from `span`, returning the free (uncovered) sub-intervals of
 * `span`, left-to-right. Empty when `span` is fully covered.
 */
export function subtractIntervals(span: CharSpan, occupied: CharSpan[]): CharSpan[] {
  const covers = mergeIntervals(occupied.filter((o) => o.end > span.start && o.start < span.end));
  const free: CharSpan[] = [];
  let cursor = span.start;
  for (const o of covers) {
    if (o.start > cursor) free.push({ start: cursor, end: Math.min(o.start, span.end) });
    cursor = Math.max(cursor, o.end);
    if (cursor >= span.end) break;
  }
  if (cursor < span.end) free.push({ start: cursor, end: span.end });
  return free.filter((f) => f.end > f.start);
}

export function spansEqual(a: CharSpan, b: CharSpan): boolean {
  return a.start === b.start && a.end === b.end;
}
