import { describe, it, expect } from 'vitest';
import type { RuleHandler, Resolution } from '../../src/rules/registry.js';
import { minusSign } from '../../src/rules/handlers/numbers.js';
import { abbrevNoDots, rangeHyphen } from '../../src/rules/handlers/housestyle.js';
import { dateFormatUs } from '../../src/rules/handlers/dates.js';
import { pValueReporting, testNameFormat } from '../../src/rules/handlers/stats.js';
import { timeUnitFormat } from '../../src/rules/handlers/units.js';
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

/** Apply the first edit into `text` at its span → the full transformed string (unchanged if none). */
function applied(handler: RuleHandler, text: string): string {
  const ctx = { chunkId: 1, text };
  const c = handler.detect(ctx)[0];
  if (!c) return text;
  const res = handler.resolve(c, ctx);
  if (res.kind !== 'edit') return text;
  const cps = [...text];
  return cps.slice(0, c.span.start).join('') + res.proposed + cps.slice(c.span.end).join('');
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
    ['β = -0.23', '−0.23'], // whole negative number gets the minus sign
    ['a value of (-3.4, 1.1)', '−3.4'],
    ['scores < -2 overall', '−2'],
    ['CI [-7, 7]', '−7'], // trailing comma not captured
    ['dropped by , -1.2 units', '−1.2'],
    ['-0.821', '−0.821'], // standalone negative (e.g. a table cell) — the UAT gap
    ['coefficient -1.000 overall', '−1.000'], // standalone after a space
    ['a score of 3-5 points', null], // range hyphen (digit on the left)
    ['a 5-year follow-up', null], // compound, digit on the left
    ['well-being improved', null], // word hyphen
    ['COVID-19 cases', null], // letter on the left
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

describe('p_value_reporting (note 13)', () => {
  table(pValueReporting, [
    ['P = .034', '*P*=.03'], // italic + round to 2 dp + no space
    ['P=0.034', '*P*=.03'], // strip leading zero + round
    ['P=.0234', '*P*=.02'],
    ['P=.047', '*P*=.047'], // .045–.049 band keeps 3 dp
    ['P=.045', '*P*=.045'], // band lower edge
    ['P=.05', '*P*=.05'], // boundary, not in band
    ['P=.5', '*P*=.50'], // 2 dp
    ['P=.0006', '*P*<.001'], // = value below .001 → bound
    ['P=0', '*P*<.001'],
    ['P=1', '*P*>.99'],
    ['P<.001', '*P*<.001'], // threshold kept, just italicized
    ['P<.05', '*P*<.05'],
    ['P>.99', '*P*>.99'],
    ['the SNP was significant', null], // no operator+value → not a P value
  ]);
});

describe('test_name_format (note 14)', () => {
  const cases: Array<[string, string]> = [
    ['t = 2.68', '*t* = 2.68'],
    ['t(15) = 2.68', '*t*(15) = 2.68'],
    ['t15 = 2.68', '*t*15 = 2.68'], // bare-digit df
    ['F(1, 20) = 4.52', '*F*(1, 20) = 4.52'],
    ['z = 1.96', '*z* = 1.96'],
    ['W = 210', '*W* = 210'],
    ['χ2 = 3.84', '*χ*2 = 3.84'],
    ['the result at t-test', 'the result at t-test'], // prose t / at / t-test: no operator → unchanged
    ['F test showed', 'F test showed'], // F without operator → unchanged
  ];
  for (const [input, out] of cases) {
    it(`test_name_format: ${JSON.stringify(input)} → ${JSON.stringify(out)}`, () => {
      expect(applied(testNameFormat, input)).toBe(out);
    });
  }
});

describe('time_unit_format (note 25)', () => {
  const cases: Array<[string, string]> = [
    ['(30 minutes)', '(30 min)'],
    ['(2 hours)', '(2 h)'],
    ['(45 seconds)', '(45 s)'],
    ['(1 hour)', '(1 h)'],
    ['completed in 30 minutes', 'completed in 30 minutes'], // running text keeps the full word
    ['(over several hours)', '(over several hours)'], // no number → not a duration
    ['every 5 hours daily', 'every 5 hours daily'], // prose → unchanged
  ];
  for (const [input, out] of cases) {
    it(`time_unit_format: ${JSON.stringify(input)} → ${JSON.stringify(out)}`, () => {
      expect(applied(timeUnitFormat, input)).toBe(out);
    });
  }
});

describe('range_hyphen (note 10)', () => {
  const cases: Array<[string, string]> = [
    ['2825–2836', '2825-2836'], // en dash → hyphen
    ['aged 10–19 years', 'aged 10-19 years'],
    ['5 – 7', '5-7'], // spaced en dash
    ['5 - 7', '5-7'], // spaced hyphen → tight
    ['scores 3—4', 'scores 3-4'], // em dash
    ['10-19', '10-19'], // already a tight hyphen → unchanged
    ['well-being', 'well-being'], // word hyphen, no digits → unchanged
    ['08:00 to 24:00', '08:00 to 24:00'], // "to" range untouched (times)
  ];
  for (const [input, out] of cases) {
    it(`range_hyphen: ${JSON.stringify(input)} → ${JSON.stringify(out)}`, () => {
      expect(applied(rangeHyphen, input)).toBe(out);
    });
  }
});
