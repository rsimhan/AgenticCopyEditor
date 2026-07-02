import { describe, it, expect } from 'vitest';
import type { RuleHandler, Resolution } from '../../src/rules/registry.js';
import {
  thousandsSeparator,
  thousandsStrip,
  wholeNumberPercent,
  leadingZero,
  noLeadingZeroStats,
  currencyUsFormat,
} from '../../src/rules/handlers/numbers.js';
import { time12Hour } from '../../src/rules/handlers/time.js';
import { percentNoSpace, percentRepeatRange } from '../../src/rules/handlers/percent.js';
import { noSpaceOperators, gteLteSymbols } from '../../src/rules/handlers/operators.js';
import { temperatureCelsiusSpacing } from '../../src/rules/handlers/units.js';
import {
  trademarkSymbolRemoval,
  latinAbbrevComma,
  ellipsisThreePeriods,
  termToward,
  termXhealth,
} from '../../src/rules/handlers/housestyle.js';
import { sliceByCodepoint } from '../../src/util/offsets.js';

/** Run a handler over `text`; return each candidate's resolution + verified codepoint span. */
function run(handler: RuleHandler, text: string): Array<{ matched: string; res: Resolution }> {
  const ctx = { chunkId: 1, text };
  return handler.detect(ctx).map((c) => {
    // The recorded span must round-trip to the matched substring (Principle 8).
    expect(sliceByCodepoint(text, c.span.start, c.span.end)).toBe(c.matched);
    return { matched: c.matched, res: handler.resolve(c, ctx) };
  });
}

/** Convenience: the single proposed edit for `text`, or null if no edit is produced. */
function proposed(handler: RuleHandler, text: string): string | null {
  const rs = run(handler, text)
    .map((r) => r.res)
    .filter((r) => r.kind === 'edit');
  return rs.length ? (rs[0] as { kind: 'edit'; proposed: string }).proposed : null;
}

type Case = [input: string, expected: string | null];

function table(handler: RuleHandler, cases: Case[]) {
  for (const [input, expected] of cases) {
    it(`${handler.ruleId}: ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(proposed(handler, input)).toBe(expected);
    });
  }
}

describe('thousands_separator', () => {
  table(thousandsSeparator, [
    ['36127 cases', '36,127'],
    ['6500 mg', null], // <= 9999 unchanged
    ['250000', '250,000'],
    ['1030023', '1,030,023'],
    ['12345.678 mm', null], // decimal, left alone
    ['in 2004', null], // 4 digits
    ['id A12345', null], // part of an identifier
    // UAT guards: IDs/DOIs/dates must not be comma-ized
    ['doi.org/10.2196/95374', null], // DOI number (adjacent to '/')
    ['Medline: 39904722', null], // 8-digit ID (> 7 digits)
    ['150320261105202628052026', null], // 24-digit concatenated metadata
  ]);
  it('is not auto-applicable (context-sensitive; can be an ID/date)', () => {
    expect(thousandsSeparator.isAutoApplicable).toBe(false);
  });
});

describe('thousands_strip', () => {
  table(thousandsStrip, [
    ['1,076', '1076'],
    ['2,329 patients', '2329'],
    ['36,127', null], // > 9999 keeps its comma
    ['1,030,023', null], // > 9999 keeps its commas
  ]);
});

describe('time_12hour', () => {
  table(time12Hour, [
    ['14:00', '2:00 PM'],
    ['23:00', '11:00 PM'],
    ['00:00', 'midnight'],
    ['12:00', 'noon'],
    ['00:30', '12:30 AM'],
    ['09:30', null], // ambiguous (no AM/PM); hour 1-11 left alone
  ]);
});

describe('whole_number_percent', () => {
  table(wholeNumberPercent, [
    ['25.0%', '25%'],
    ['100.00%', '100%'],
    ['0.0%', '0%'],
    ['25.5%', null],
  ]);
});

describe('percent_no_space', () => {
  table(percentNoSpace, [
    ['18 %', '18%'],
    ['18  %', '18%'],
    ['18%', null],
  ]);
});

describe('percent_repeat_range', () => {
  table(percentRepeatRange, [
    ['15-20%', '15%-20%'],
    ['24-29%', '24%-29%'],
    ['2.5-3.5%', '2.5%-3.5%'],
    ['15%-20%', null], // already repeated
    ['5-10 years', null], // not a percentage
  ]);
});

describe('leading_zero (context-sensitive)', () => {
  table(leadingZero, [
    ['a value of .7 g', '0.7'],
    ['(95% CI .5 to .8)', '0.5'], // first candidate
    ['P=.03', null], // P value keeps no leading zero
    ['α=.05', null],
    ['3.5', null], // already has an integer part
  ]);
  it('is not auto-applicable (context-sensitive)', () => {
    expect(leadingZero.isAutoApplicable).toBe(false);
  });
});

describe('no_leading_zero_stats', () => {
  table(noLeadingZeroStats, [
    ['P=0.03', 'P=.03'],
    ['α=0.05', 'α=.05'],
    ['β=0.2', 'β=.2'],
    ['P<0.001', 'P<.001'],
    ['n=0.5', null], // n is not P/α/β
  ]);
});

describe('no_space_operators (pending; equation-safe)', () => {
  table(noSpaceOperators, [
    ['P < .001', '<'],
    ['n = 12', '='],
    ['r = 0.5', '='],
    ['y = mx + b', null], // RHS is a variable → not flagged (equation-safe)
    ['P<.001', null], // already tight
  ]);
  it('is not auto-applicable (equations keep spaces)', () => {
    expect(noSpaceOperators.isAutoApplicable).toBe(false);
  });
});

describe('gte_lte_symbols', () => {
  table(gteLteSymbols, [
    ['p >= 0.05', '≥'],
    ['x <= y', '≤'],
    ['p ≥ 0.05', null],
  ]);
});

describe('temperature_celsius_spacing', () => {
  table(temperatureCelsiusSpacing, [
    ['37.5°C', '37.5 °C'],
    ['37.5 °C', null],
    ['20°F', '20 °F'],
  ]);
});

describe('currency_us_format', () => {
  table(currencyUsFormat, [
    ['US$99', 'US $99'],
    ['CAD$125.35', 'CAD $125.35'],
    ['US $99', null],
  ]);
});

describe('trademark_symbol_removal', () => {
  it('removes ® (proposes empty string)', () => {
    expect(proposed(trademarkSymbolRemoval, 'Xerox®')).toBe('');
  });
  it('removes ™ and ℠', () => {
    expect(run(trademarkSymbolRemoval, 'SPSS™ and Foo℠')).toHaveLength(2);
  });
  it('no match when clean', () => {
    expect(run(trademarkSymbolRemoval, 'Xerox')).toHaveLength(0);
  });
});

describe('latin_abbrev_comma (parentheses-only)', () => {
  table(latinAbbrevComma, [
    ['(ie. the first)', 'ie,'],
    ['(e.g. green)', 'eg,'],
    ['(i.e. this)', 'ie,'],
    ['That is, i.e. running text', null], // outside parentheses → deferred
  ]);
});

describe('ellipsis_three_periods', () => {
  it('replaces the ellipsis character', () => {
    expect(proposed(ellipsisThreePeriods, 'this…already')).toBe('...');
  });
});

describe('term_toward', () => {
  table(termToward, [
    ['moving towards health', 'toward'],
    ['Towards a cure', 'Toward'], // leading capital preserved
    ['toward', null], // already correct
    ['afterwards', null], // different word
  ]);
});

describe('term_xhealth', () => {
  table(termXhealth, [
    ['e-health tools', 'eHealth'],
    ['m-Health app', 'mHealth'],
    ['e-Health', 'eHealth'],
    ['e-source data', 'eSource'],
    ['eHealth', null], // already correct
  ]);
});
