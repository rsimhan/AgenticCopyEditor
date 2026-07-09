/**
 * Registry assembly for the Milestone 2 deterministic span rules.
 * Adding a new deterministic rule = write a handler + add it here (+ ensure a style_rules row).
 */
import type { RuleHandler } from '../registry.js';
import { RuleRegistry } from '../registry.js';
import {
  thousandsSeparator,
  thousandsStrip,
  wholeNumberPercent,
  leadingZero,
  noLeadingZeroStats,
  currencyUsFormat,
  minusSign,
} from './numbers.js';
import { percentNoSpace, percentRepeatRange } from './percent.js';
import { noSpaceOperators, gteLteSymbols } from './operators.js';
import { temperatureCelsiusSpacing } from './units.js';
import { time12Hour } from './time.js';
import { dateFormatUs } from './dates.js';
import { pValueReporting } from './stats.js';
import {
  trademarkSymbolRemoval,
  latinAbbrevComma,
  abbrevNoDots,
  ellipsisThreePeriods,
  termToward,
  termXhealth,
} from './housestyle.js';

/** All deterministic span-scoped handlers implemented in Milestone 2. */
export const spanRuleHandlers: readonly RuleHandler[] = Object.freeze([
  thousandsSeparator,
  thousandsStrip,
  wholeNumberPercent,
  leadingZero,
  noLeadingZeroStats,
  currencyUsFormat,
  percentNoSpace,
  percentRepeatRange,
  noSpaceOperators,
  gteLteSymbols,
  temperatureCelsiusSpacing,
  time12Hour,
  minusSign,
  dateFormatUs,
  pValueReporting,
  trademarkSymbolRemoval,
  latinAbbrevComma,
  abbrevNoDots,
  ellipsisThreePeriods,
  termToward,
  termXhealth,
]);

/** Build a RuleRegistry populated with the span handlers. */
export function buildSpanRegistry(): RuleRegistry {
  const reg = new RuleRegistry();
  for (const h of spanRuleHandlers) reg.register(h);
  return reg;
}
