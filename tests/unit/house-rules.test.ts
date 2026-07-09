import { describe, it, expect } from 'vitest';
import type { RuleHandler, Resolution } from '../../src/rules/registry.js';
import { minusSign } from '../../src/rules/handlers/numbers.js';
import { abbrevNoDots } from '../../src/rules/handlers/housestyle.js';
import { dateFormatUs } from '../../src/rules/handlers/dates.js';
import { sliceByCodepoint } from '../../src/util/offsets.js';

/** Run a handler over `text`; assert each candidate span round-trips (Principle 8). */
function run(handler: RuleHandler, text: string): Resolution[] {
  const ctx = { chunkId: 1, text };
  return handler.detect(ctx).map((c) => {
    expect(sliceByCodepoint(text, c.span.start, c.span.end)).toBe(c.matched);
    return handler.resolve(c, ctx);
  });
}

/** The single proposed edit for `text`, or null. */
function proposed(handler: RuleHandler, text: string): string | null {
  const edits = run(handler, text).filter((r) => r.kind === 'edit');
  return edits.length ? (edits[0] as { kind: 'edit'; proposed: string }).proposed : null;
}

type Case = [input: string, expected: string | null];
function table(handler: RuleHandler, cases: Case[]) {
  for (const [input, expected] of cases) {
    it(`${handler.ruleId}: ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(proposed(handler, input)).toBe(expected);
    });
  }
}

describe('abbrev_no_dots (note 19)', () => {
  table(abbrevNoDots, [
    ['Smith et al. reported', 'et al'],
    ['Acme Inc. announced', 'Inc'],
    ['Beta Corp. filed', 'Corp'],
    ['apples, oranges, etc.', 'etc'],
    ['cats vs. dogs', 'vs'],
    ['based in the U.S.', 'US'],
    ['the U.K. cohort', 'UK'],
    ['born in the U.S.A.', 'USA'],
    ['i.e. the main point', null], // left to latin_abbrev_comma
    ['e.g. an example', null],
    ['version 2.0 released', null],
    ['no abbreviation here', null],
  ]);
});

describe('minus_sign (note 20)', () => {
  table(minusSign, [
    ['β = -0.23', '−'],
    ['a value of (-3.4, 1.1)', '−'],
    ['scores < -2 overall', '−'],
    ['CI [-7, 7]', '−'],
    ['dropped by , -1.2 units', '−'],
    ['a score of 3-5 points', null], // range hyphen (digit on the left)
    ['well-being improved', null], // word hyphen
    ['line - dash', null], // hyphen not before a digit
  ]);
});

describe('date_format_us (notes 22 + 23/24)', () => {
  table(dateFormatUs, [
    ['3 March 2026', 'March 3, 2026'],
    ['3rd March 2026', 'March 3, 2026'],
    ['Mar 3, 2026', 'March 3, 2026'],
    ['March 3 2026', 'March 3, 2026'], // missing comma
    ['March 03, 2026', 'March 3, 2026'], // strip day leading zero
    ['2026-03-03', 'March 3, 2026'], // ISO
    ['15 December 2024', 'December 15, 2024'],
    ['Sept 5, 2025', 'September 5, 2025'],
    ['March 3, 2026', null], // already correct → noop
    ['collected in 7/3/2026', null], // numeric slash date: ambiguous, deferred
    ['spanning 2020-2024', null], // year range, not an ISO date
    ['no date here', null],
  ]);
});
