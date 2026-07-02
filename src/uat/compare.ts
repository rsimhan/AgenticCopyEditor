/**
 * UAT comparison harness (AGENT-ARCHITECTURE §14 Phase-1 acceptance). Classifies a copy editor's
 * in-scope tracked changes into rule-like *patterns*, runs our pipeline on the original, and scores
 * coverage per pattern: covered / partial (rule exists but produced nothing) / gap (no rule) /
 * ours-only (we suggested something not in the gold — a false-positive candidate).
 */
import { readDocumentXml } from './docx-xml.js';
import { parseTrackedChanges, classifyEdits, type TrackedEdit } from './tracked-changes.js';
import { loadManuscriptSource } from '../ingest/load.js';
import { ingestManuscript } from '../service/ingest.js';
import { runFullPipeline } from '../service/run.js';
import { getManuscriptReport, type ReportItem } from '../service/report.js';

const NUMBER_WORD = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/i;

/** Bucket a gold edit into a pattern (rule-like category). */
export function patternOfGold(e: TrackedEdit): string {
  const d = (e.deleted ?? '').trim();
  const i = (e.inserted ?? '').trim();
  const t = `${d} ${i}`;
  if (/[™®℠]/.test(d)) return 'trademark_removal';
  if (/…/.test(d)) return 'ellipsis';
  if (/\bi\.e\.|\be\.g\./i.test(d)) return 'latin_abbrev';
  if (/towards\b/i.test(d)) return 'term_toward';
  if (/e-?health|m-?health/i.test(t)) return 'term_xhealth';
  if (/^\d{1,2}:\d{2}$/.test(d)) return 'time_12hour';
  if (NUMBER_WORD.test(d) && /^\d+$/.test(i)) return 'numeral_conversion';
  if (/,/.test(d) && !/,/.test(i) && /^\d+$/.test(i.replace(/,/g, ''))) return 'thousands_strip';
  if (!/,/.test(d) && /,/.test(i) && /^\d+$/.test(d)) return 'thousands_add';
  if (/^\d[\d.]*\s+%$/.test(d) && /%$/.test(i)) return 'percent_spacing';
  if (d === '–' && /\bto\b/.test(i)) return 'negative_range_to';
  if (/^-\d/.test(d) && /^[−–]\d/.test(i)) return 'minus_sign';
  if (/°[CF]/.test(t)) return 'temperature';
  if (/^0?\.\d/.test(d) || /^\.\d/.test(i)) return 'leading_zero';
  if (/[=<>≤≥]/.test(t)) return 'operator_spacing';
  return 'other_numeric';
}

/** Map our rule_ids to the same pattern taxonomy. */
const RULE_TO_PATTERN: Record<string, string> = {
  trademark_symbol_removal: 'trademark_removal',
  ellipsis_three_periods: 'ellipsis',
  latin_abbrev_comma: 'latin_abbrev',
  term_toward: 'term_toward',
  term_xhealth: 'term_xhealth',
  percent_no_space: 'percent_spacing',
  percent_repeat_range: 'percent_range',
  whole_number_percent: 'whole_number_percent',
  thousands_separator: 'thousands_add',
  leading_zero: 'leading_zero',
  no_leading_zero_stats: 'leading_zero',
  no_space_operators: 'operator_spacing',
  gte_lte_symbols: 'operator_spacing',
  temperature_celsius_spacing: 'temperature',
  currency_us_format: 'currency',
  negative_range_to: 'negative_range_to',
  derived_value_check: 'derived_value',
  cross_reference_mismatch: 'cross_reference',
  decimal_places_consistency: 'decimal_consistency',
  table_range_style_consistency: 'table_range',
};

const OUR_PATTERNS = new Set(Object.values(RULE_TO_PATTERN));

export type Verdict = 'covered' | 'partial' | 'gap' | 'ours_only';

export interface PatternRow {
  pattern: string;
  gold: number;
  ours: number;
  haveRule: boolean;
  verdict: Verdict;
  goldExamples: TrackedEdit[];
}

export interface ComparisonResult {
  goldTotal: number;
  ourTotal: number;
  rows: PatternRow[];
}

function group<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) (m.get(key(it)) ?? m.set(key(it), []).get(key(it))!).push(it);
  return m;
}

export async function runComparison(inputPath: string, editedPath: string): Promise<ComparisonResult> {
  const gold = classifyEdits(parseTrackedChanges(await readDocumentXml(editedPath))).inScope;
  const goldByPattern = group(gold, patternOfGold);

  const md = await loadManuscriptSource(inputPath);
  const { manuscriptId } = await ingestManuscript({ title: inputPath, rawContentMarkdown: md });
  await runFullPipeline(manuscriptId);
  const ours = (await getManuscriptReport(manuscriptId)).items.filter((i) => i.status !== 'superseded');
  const ourByPattern = group(ours, (it: ReportItem) => RULE_TO_PATTERN[it.ruleId] ?? `?${it.ruleId}`);

  const patterns = new Set([...goldByPattern.keys(), ...ourByPattern.keys()]);
  const rows: PatternRow[] = [];
  for (const p of patterns) {
    const g = goldByPattern.get(p)?.length ?? 0;
    const o = ourByPattern.get(p)?.length ?? 0;
    const haveRule = OUR_PATTERNS.has(p);
    let verdict: Verdict;
    if (g > 0 && o > 0) verdict = 'covered';
    else if (g > 0 && haveRule) verdict = 'partial';
    else if (g > 0) verdict = 'gap';
    else verdict = 'ours_only';
    rows.push({ pattern: p, gold: g, ours: o, haveRule, verdict, goldExamples: (goldByPattern.get(p) ?? []).slice(0, 3) });
  }
  rows.sort((a, b) => b.gold - a.gold || b.ours - a.ours);
  return { goldTotal: gold.length, ourTotal: ours.length, rows };
}

export function formatComparison(r: ComparisonResult): string {
  const V: Record<Verdict, string> = { covered: '✅ covered', partial: '◐ partial', gap: '✗ GAP', ours_only: '● ours-only' };
  const lines: string[] = [];
  lines.push(`Gold in-scope edits: ${r.goldTotal}   ·   Our suggestions: ${r.ourTotal}\n`);
  lines.push('pattern                     gold  ours   verdict');
  lines.push('-------                     ----  ----   -------');
  for (const row of r.rows) {
    lines.push(
      `${row.pattern.padEnd(26)} ${String(row.gold).padStart(4)}  ${String(row.ours).padStart(4)}   ${V[row.verdict]}`,
    );
  }
  // Detail the gaps (missing rules) with real examples.
  const gaps = r.rows.filter((row) => row.verdict === 'gap' || row.verdict === 'partial');
  if (gaps.length) {
    lines.push('\n--- gaps & partials (examples from the real edit) ---');
    for (const row of gaps) {
      lines.push(`\n[${row.verdict === 'gap' ? 'GAP' : 'PARTIAL'}] ${row.pattern}  (gold ${row.gold}, ours ${row.ours})`);
      for (const e of row.goldExamples) {
        lines.push(`    "${(e.deleted ?? '').slice(0, 45)}" → "${(e.inserted ?? '').slice(0, 45)}"`);
      }
    }
  }
  return lines.join('\n');
}
