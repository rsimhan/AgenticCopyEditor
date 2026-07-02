/**
 * logical_key derivation (SPEC §5 B). Grouping "the same quantity" across the abstract, prose, and
 * tables is fuzzy entity resolution. v1 uses a deterministic heuristic: a normalized slug of the
 * quantity's label (a table column header, or a noun phrase near the value). Ambiguous cases fall
 * back to an LLM in a later milestone — the seam is the label input, not this function.
 *
 * The key intentionally excludes stat_type so a proportion and its percentage (same quantity) can
 * share a key; cross-location agreement (B.1b) still groups by (logicalKey, statType) so it never
 * compares a count against a percentage.
 */

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'was',
  'were',
  'is',
  'are',
  'of',
  'in',
  'for',
  'and',
  'with',
  'at',
  'to',
  'had',
  'has',
  'been',
  'that',
  'this',
  'group',
  'rate',
  'value',
]);

/** Normalize a label to a stable key: lowercase, alnum words, stopwords dropped, joined by `_`. */
export function deriveLogicalKey(label: string): string | undefined {
  const words = label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
  if (words.length === 0) return undefined;
  // Keep the last up-to-3 meaningful words (the label usually sits just before the value).
  return words.slice(-3).join('_');
}

/**
 * Best-effort prose label: the words immediately preceding a value's offset. Used when no explicit
 * label (e.g. table header) is available. Deliberately conservative.
 */
export function guessLabelBefore(textBeforeValue: string): string | undefined {
  const tail =
    textBeforeValue
      .trim()
      .split(/[.;,:()]/)
      .pop() ?? '';
  return deriveLogicalKey(tail);
}
