import { describe, it, expect } from 'vitest';
import {
  codepointLength,
  sliceByCodepoint,
  toCodepoints,
  assertValidSpan,
  isValidSpan,
  spansOverlap,
  codepointToCodeUnit,
} from '../../src/util/offsets.js';

describe('codepoint offsets (Principle 8)', () => {
  it('counts codepoints, not UTF-16 code units', () => {
    // "−3.4 to 1.1 ≤ χ²" mixes a minus sign, ≤, and χ (all non-ASCII).
    const s = '−3.4 to 1.1 ≤ χ²';
    expect(codepointLength(s)).toBe(Array.from(s).length);
    // A degree sign + Celsius string.
    expect(codepointLength('37.5 °C')).toBe(7);
  });

  it('slices non-ASCII by codepoint correctly', () => {
    const s = 'P<.001 and χ²=0.3';
    // Grab "χ²" — find its codepoint span.
    const cps = toCodepoints(s);
    const start = cps.indexOf('χ');
    expect(sliceByCodepoint(s, start, start + 2)).toBe('χ²');
  });

  it('handles astral characters (surrogate pairs) without drift', () => {
    // A mathematical bold digit (astral, U+1D7D9) surrounded by ASCII.
    const s = 'a𝟙b';
    expect(codepointLength(s)).toBe(3); // native s.length would be 4
    expect(sliceByCodepoint(s, 0, 1)).toBe('a');
    expect(sliceByCodepoint(s, 1, 2)).toBe('𝟙');
    expect(sliceByCodepoint(s, 2, 3)).toBe('b');
    // The astral char occupies 2 UTF-16 code units, so codepoint 2 -> code unit 3.
    expect(codepointToCodeUnit(s, 2)).toBe(3);
  });

  it('validates spans and rejects malformed ones', () => {
    expect(isValidSpan({ start: 0, end: 3 }, 5)).toBe(true);
    expect(isValidSpan({ start: 3, end: 2 }, 5)).toBe(false); // inverted
    expect(isValidSpan({ start: 0, end: 6 }, 5)).toBe(false); // out of range
    expect(() => assertValidSpan({ start: -1, end: 2 }, 5)).toThrow(RangeError);
  });

  it('detects overlap on half-open spans', () => {
    expect(spansOverlap({ start: 0, end: 5 }, { start: 4, end: 9 })).toBe(true);
    expect(spansOverlap({ start: 0, end: 4 }, { start: 4, end: 9 })).toBe(false); // touching, not overlapping
  });
});
