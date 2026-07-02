import { describe, it, expect } from 'vitest';
import { mergeIntervals, subtractIntervals } from '../../src/util/intervals.js';

describe('mergeIntervals', () => {
  it('merges overlapping and adjacent spans', () => {
    expect(
      mergeIntervals([
        { start: 0, end: 5 },
        { start: 4, end: 9 },
      ]),
    ).toEqual([{ start: 0, end: 9 }]);
    expect(
      mergeIntervals([
        { start: 0, end: 5 },
        { start: 5, end: 9 },
      ]),
    ).toEqual([{ start: 0, end: 9 }]);
    expect(
      mergeIntervals([
        { start: 6, end: 9 },
        { start: 0, end: 5 },
      ]),
    ).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 9 },
    ]);
  });
});

describe('subtractIntervals', () => {
  it('returns the whole span when nothing is occupied', () => {
    expect(subtractIntervals({ start: 0, end: 10 }, [])).toEqual([{ start: 0, end: 10 }]);
  });
  it('returns empty when fully covered', () => {
    expect(subtractIntervals({ start: 2, end: 8 }, [{ start: 0, end: 10 }])).toEqual([]);
  });
  it('leaves the left remainder when overlapped on the right', () => {
    expect(subtractIntervals({ start: 0, end: 10 }, [{ start: 6, end: 12 }])).toEqual([
      { start: 0, end: 6 },
    ]);
  });
  it('leaves two remainders when the occupied span is interior', () => {
    expect(subtractIntervals({ start: 0, end: 10 }, [{ start: 4, end: 6 }])).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ]);
  });
});
