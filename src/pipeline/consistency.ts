/**
 * Phase B.2 — consistency normalizers (SPEC §5). These need an aggregate view: they infer the
 * document/table convention, then flag the outliers. Deterministic given the aggregate, but posts
 * pending (choosing the canonical style can be a judgment call).
 */
import type { SuggestionDraft, CharSpan } from '../domain/types.js';
import { codeUnitToCodepoint, codepointLength } from '../util/offsets.js';
import { parseNumber, decimalPlaces } from './numeric.js';

const ENGINE = 'normalizer_v1';

export interface CellText {
  chunkId: number;
  cellId: number;
  text: string;
}

function isNegativeBound(raw: string): boolean {
  return /^[-–−]/.test(raw) || (parseNumber(raw) ?? 0) < 0;
}

/**
 * table_range_style_consistency — if ANY range in a table contains a negative value, ALL ranges in
 * that table must use "to" instead of a hyphen (SPEC / JMIR guideline). Emits pending edits for the
 * hyphen-style ranges. Range regex: greedy digits let "-3.4-1.1" parse as [-3.4] sep [-] [1.1].
 */
export function tableRangeStyleConsistency(cells: CellText[]): SuggestionDraft[] {
  const rangeRe = /(-?[\d.]+)\s*(to|[-–−])\s*(-?[\d.]+)/g;

  // Pass 1: does any range in the table contain a negative bound?
  let anyNegative = false;
  for (const cell of cells) {
    for (const m of cell.text.matchAll(rangeRe)) {
      if (isNegativeBound(m[1]!) || isNegativeBound(m[3]!)) anyNegative = true;
    }
  }
  if (!anyNegative) return [];

  // Pass 2: flag every hyphen/en-dash range (leave "to" ranges alone).
  const out: SuggestionDraft[] = [];
  for (const cell of cells) {
    for (const m of cell.text.matchAll(rangeRe)) {
      if (m[2] === 'to') continue; // already the target style
      const start = codeUnitToCodepoint(cell.text, m.index!);
      const span: CharSpan = { start, end: start + codepointLength(m[0]) };
      out.push({
        chunkId: cell.chunkId,
        cellId: cell.cellId,
        ruleId: 'table_range_style_consistency',
        originatorEngine: ENGINE,
        originTier: 'deterministic',
        kind: 'edit',
        span,
        originalText: m[0],
        proposedText: `${m[1]} to ${m[3]}`,
      });
    }
  }
  return out;
}

export interface PercentOccurrence {
  chunkId: number;
  cellId?: number;
  span: CharSpan;
  rawValueString: string;
}

/**
 * decimal_places_consistency — non-whole percentages should share a decimal precision. Whole-number
 * percentages are allowed to coexist (they take no trailing zero), so only fractional percentages
 * are considered. Flags the minority precision as an author_query (reformatting is the editor's call).
 */
export function decimalPlacesConsistency(percentages: PercentOccurrence[]): SuggestionDraft[] {
  const fractional = percentages
    .map((p) => ({ p, dp: decimalPlaces(p.rawValueString) }))
    .filter((x) => x.dp > 0);
  if (fractional.length < 2) return [];

  const counts = new Map<number, number>();
  for (const { dp } of fractional) counts.set(dp, (counts.get(dp) ?? 0) + 1);
  if (counts.size < 2) return []; // already consistent

  // Dominant precision = most frequent (ties broken by the larger dp for determinism).
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]![0];

  const out: SuggestionDraft[] = [];
  for (const { p, dp } of fractional) {
    if (dp === dominant) continue;
    out.push({
      chunkId: p.chunkId,
      ...(p.cellId !== undefined ? { cellId: p.cellId } : {}),
      ruleId: 'decimal_places_consistency',
      originatorEngine: ENGINE,
      originTier: 'deterministic',
      kind: 'author_query',
      span: p.span,
      originalText: p.rawValueString,
      queryMessage:
        `Percentage ${p.rawValueString} uses ${dp} decimal place(s), but the manuscript ` +
        `predominantly uses ${dominant}. Please make the precision consistent.`,
    });
  }
  return out;
}
