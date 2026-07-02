/**
 * Codepoint-exact offset utilities (SPEC Principle 8).
 *
 * All character indices in this system are Unicode **codepoint** offsets into the immutable
 * original text — never UTF-16 code-unit offsets (JS's native string indexing) and never byte
 * offsets. The guidelines are non-ASCII-heavy (`– − ≤ ≥ × °C χ α β ρ κ`), and several of those
 * characters are astral (outside the BMP) or combine in ways that make code-unit math wrong.
 * Every engine and the DB write path go through these functions so the basis is consistent.
 */

/** A half-open span [start, end) in codepoint units. */
export interface CharSpan {
  start: number;
  end: number;
}

/** Split a string into its codepoints (spread iterates by codepoint, not code unit). */
export function toCodepoints(text: string): string[] {
  return Array.from(text);
}

/** Length of `text` in codepoints. */
export function codepointLength(text: string): number {
  // Array.from length counts codepoints; `text.length` would count UTF-16 code units.
  return Array.from(text).length;
}

/**
 * Slice `text` by codepoint offsets [start, end). Throws on out-of-range or inverted spans so
 * that offset bugs surface loudly rather than silently corrupting a suggestion span.
 */
export function sliceByCodepoint(text: string, start: number, end: number): string {
  const cps = Array.from(text);
  assertValidSpan({ start, end }, cps.length);
  return cps.slice(start, end).join('');
}

/** Validate a span against a codepoint length; throws with a precise message if invalid. */
export function assertValidSpan(span: CharSpan, codepointCount: number): void {
  const { start, end } = span;
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new RangeError(`span offsets must be integers: ${JSON.stringify(span)}`);
  }
  if (start < 0 || end < 0) {
    throw new RangeError(`span offsets must be non-negative: ${JSON.stringify(span)}`);
  }
  if (end < start) {
    throw new RangeError(`span end (${end}) precedes start (${start})`);
  }
  if (end > codepointCount) {
    throw new RangeError(`span end (${end}) exceeds text length (${codepointCount} codepoints)`);
  }
}

/** True iff the span is within [0, length] and well-formed. Non-throwing companion. */
export function isValidSpan(span: CharSpan, codepointCount: number): boolean {
  try {
    assertValidSpan(span, codepointCount);
    return true;
  } catch {
    return false;
  }
}

/** Two half-open spans overlap iff they share at least one codepoint position. */
export function spansOverlap(a: CharSpan, b: CharSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Convert a UTF-16 code-unit index (what a native regex match reports) to a codepoint index.
 * Detectors run regexes on the raw string, then map match offsets to the codepoint basis so every
 * persisted span obeys Principle 8.
 */
export function codeUnitToCodepoint(text: string, codeUnitIndex: number): number {
  if (codeUnitIndex < 0 || codeUnitIndex > text.length) {
    throw new RangeError(`code-unit index ${codeUnitIndex} out of range (${text.length} units)`);
  }
  let cp = 0;
  let unit = 0;
  for (const ch of text) {
    if (unit >= codeUnitIndex) break;
    unit += ch.length;
    cp += 1;
  }
  return cp;
}

/** Convert a codepoint index to the equivalent UTF-16 code-unit index within `text`. */
export function codepointToCodeUnit(text: string, codepointIndex: number): number {
  let cp = 0;
  let unit = 0;
  for (const ch of text) {
    if (cp === codepointIndex) return unit;
    unit += ch.length; // 1 for BMP, 2 for a surrogate pair
    cp += 1;
  }
  if (cp === codepointIndex) return unit;
  throw new RangeError(`codepoint index ${codepointIndex} out of range (${cp} codepoints)`);
}
