/**
 * Phase B — statistical extraction (SPEC §5). Sweeps text for reported quantitative values and
 * produces `StatExtraction`s. Deterministic and codepoint-safe. v1 covers the highest-value,
 * reliably-detectable types: p_value, percentage, proportion (n/N), CI bounds, sample size.
 * (mean(SD), mean_difference, and test statistics are deferred — noted for a later pass.)
 */
import type { StatExtraction } from '../domain/stats.js';
import type { LocationContext, StatType, CharSpan } from '../domain/types.js';
import { codeUnitToCodepoint, codepointLength } from '../util/offsets.js';
import { parseNumber } from './numeric.js';

export interface ExtractInput {
  chunkId: number;
  cellId?: number;
  text: string;
  locationContext: LocationContext;
}

interface Pattern {
  statType: StatType;
  re: RegExp;
  /** Build primary/secondary numerics from the regex match groups. */
  numerics: (m: RegExpMatchArray) => {
    primary?: number | undefined;
    secondary?: number | undefined;
  };
}

// Order matters: proportion is tried before bare percentages so "50/200" is not mis-read.
const PATTERNS: Pattern[] = [
  {
    // P values: P=.03, p < .001, P > .99
    statType: 'p_value',
    re: /\bp\s*[=<>]\s*(\.\d+|\d+(?:\.\d+)?)/gi,
    numerics: (m) => ({ primary: parseNumber(m[1]!) }),
  },
  {
    // CI bounds with a point estimate: 3.1 (95% CI 2.2-4.8) or (95% CI -3.4 to 1.1)
    statType: 'ci_bound',
    re: /(-?[\d.]+)\s*\(\s*95%?\s*CI[:\s]*(-?[\d.–−]+)\s*(?:to|[-–−])\s*(-?[\d.]+)\s*\)/gi,
    numerics: (m) => ({ primary: parseNumber(m[2]!), secondary: parseNumber(m[3]!) }),
  },
  {
    // proportion n/N
    statType: 'proportion',
    re: /\b(\d+)\s*\/\s*(\d+)\b/g,
    numerics: (m) => ({ primary: parseNumber(m[1]!), secondary: parseNumber(m[2]!) }),
  },
  {
    // sample size: n=150, N = 200
    statType: 'sample_size',
    re: /\b[nN]\s*=\s*(\d+)\b/g,
    numerics: (m) => ({ primary: parseNumber(m[1]!) }),
  },
  {
    // percentage: 25%, 25.0% (not preceded by a digit/dot; not the "95% CI" confidence level)
    statType: 'percentage',
    re: /(?<![\d.])(\d+(?:\.\d+)?)\s*%(?!\s*CI\b)/g,
    numerics: (m) => ({ primary: parseNumber(m[1]!) }),
  },
];

function candidateSpan(text: string, m: RegExpMatchArray): CharSpan {
  const start = codeUnitToCodepoint(text, m.index!);
  return { start, end: start + codepointLength(m[0]) };
}

/** Extract all recognized statistics from one text unit. */
export function extractStatistics(input: ExtractInput): StatExtraction[] {
  const { text, chunkId, cellId, locationContext } = input;
  const out: StatExtraction[] = [];

  for (const pat of PATTERNS) {
    for (const m of text.matchAll(pat.re)) {
      const { primary, secondary } = pat.numerics(m);
      const base: StatExtraction = {
        chunkId,
        ...(cellId !== undefined ? { cellId } : {}),
        locationContext,
        statType: pat.statType,
        rawValueString: m[0],
        ...(primary !== undefined ? { numericPrimary: primary } : {}),
        ...(secondary !== undefined ? { numericSecondary: secondary } : {}),
        span: candidateSpan(text, m),
      };
      out.push(base);
    }
  }

  return out;
}
