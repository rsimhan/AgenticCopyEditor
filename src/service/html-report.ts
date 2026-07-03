/**
 * Render a ManuscriptReport as a self-contained, human-friendly HTML page — the editor-facing
 * output for the Phase-1 (Test) surface. Plain-language rule names, grouped by manuscript section,
 * before/after shown like a marked-up proof. Written to a local file (not published anywhere), so
 * it is safe to run on confidential manuscripts.
 */
import type { ManuscriptReport, ReportItem } from './report.js';

/** Plain-language names an editor recognizes, keyed by internal rule id. */
const RULE_LABEL: Record<string, string> = {
  percent_no_space: 'Space before a percent sign',
  percent_repeat_range: 'Repeat the percent sign in a range',
  whole_number_percent: 'Trailing zero on a whole percentage',
  thousands_separator: 'Thousands separator',
  thousands_strip: 'Comma on a number under 10,000',
  leading_zero: 'Leading zero on a decimal',
  no_leading_zero_stats: 'No leading zero on a P value',
  no_space_operators: 'Spacing around an operator',
  gte_lte_symbols: 'Greater/less-than-or-equal symbol',
  temperature_celsius_spacing: 'Space before a unit of measure',
  time_12hour: '24-hour time to 12-hour clock',
  trademark_symbol_removal: 'Trademark symbol removed',
  latin_abbrev_comma: 'Punctuation of “ie”/“eg”',
  ellipsis_three_periods: 'Ellipsis to three periods',
  term_toward: 'House spelling',
  term_xhealth: 'House spelling (eHealth)',
  currency_us_format: 'Currency format',
  derived_value_check: 'A reported value does not add up',
  cross_reference_mismatch: 'Values disagree across sections',
  table_range_style_consistency: 'Negative range uses “to”',
  decimal_places_consistency: 'Inconsistent decimal places',
};

function esc(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Bucket = 'applied' | 'review' | 'query';
function bucketOf(it: ReportItem): Bucket {
  if (it.kind === 'author_query') return 'query';
  if (it.status === 'auto_applied') return 'applied';
  return 'review';
}
const CHIP_LABEL: Record<Bucket, string> = {
  applied: 'Applied',
  review: 'Review',
  query: 'Author query',
};

function renderItem(it: ReportItem): string {
  const b = bucketOf(it);
  const name = RULE_LABEL[it.ruleId] ?? it.ruleId;
  let change: string;
  if (b === 'query') {
    change = `<div class="change"><del>${esc(it.original)}</del></div>
      <div class="note">${esc(it.queryMessage) || 'Please review with the author.'}</div>`;
  } else if (it.proposed === '' || it.proposed === null) {
    change = `<div class="change"><del>${esc(it.original)}</del><span class="arrow">→</span><span class="removed">removed</span></div>`;
  } else {
    change = `<div class="change"><del>${esc(it.original)}</del><span class="arrow">→</span><ins>${esc(it.proposed)}</ins></div>`;
  }
  return `<div class="item ${b}">
      <div class="head"><span class="chip ${b}">${CHIP_LABEL[b]}</span><span class="name">${esc(name)}</span></div>
      ${change}
    </div>`;
}

export function generateHtmlReport(report: ManuscriptReport, sourceTitle: string): string {
  const items = report.items.filter((i) => i.status !== 'superseded');

  // Group by section, preserving first-seen order.
  const sections: string[] = [];
  const bySection = new Map<string, ReportItem[]>();
  for (const it of items) {
    if (!bySection.has(it.section)) {
      bySection.set(it.section, []);
      sections.push(it.section);
    }
    bySection.get(it.section)!.push(it);
  }

  const sectionHtml = sections
    .map(
      (s) =>
        `<div class="section"><h2>${esc(s)}</h2>${bySection.get(s)!.map(renderItem).join('\n')}</div>`,
    )
    .join('\n');

  const c = report.counts;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Copyediting Review — ${esc(sourceTitle)}</title>
<style>
  :root{
    --paper:#f6f5f1;--card:#fffefb;--ink:#23211c;--ink-soft:#6b675e;--hair:#e4e1d8;
    --oxblood:#a23b2e;--green:#2c6e52;--amber:#9a6b1a;--blue:#345e8c;
    --green-bg:#e8f0ea;--amber-bg:#f4ecdd;--blue-bg:#e6edf4;
    --serif:Georgia,"Iowan Old Style",Palatino,"Times New Roman",serif;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--serif);line-height:1.55;-webkit-font-smoothing:antialiased}
  .wrap{max-width:820px;margin:0 auto;padding:3rem 1.5rem 5rem}
  .eyebrow{font-family:var(--sans);font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:var(--oxblood);font-weight:600;margin:0 0 .6rem}
  h1{font-size:clamp(1.9rem,5vw,2.8rem);line-height:1.08;margin:0;font-weight:600;letter-spacing:-.01em;text-wrap:balance}
  .subtitle{font-family:var(--sans);color:var(--ink-soft);font-size:1rem;margin:.5rem 0 0}
  .rule{height:2px;background:var(--oxblood);border:0;margin:1.4rem 0 0;width:64px}
  .lede{font-size:1.05rem;color:#38352d;max-width:60ch;margin:1.6rem 0 0}
  .summary{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin:1.8rem 0 0}
  .tile{border-radius:10px;padding:1.1rem 1.15rem;border:1px solid}
  .tile .num{font-family:var(--sans);font-size:2.1rem;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;color:var(--ink)}
  .tile .lab{font-family:var(--sans);font-size:.8rem;margin-top:.4rem;line-height:1.3;color:var(--ink)}
  .tile .sub{display:block;margin-top:.1rem}
  .t-green{background:var(--green-bg);border-color:#cfe0d5}.t-green .sub{color:var(--green)}
  .t-amber{background:var(--amber-bg);border-color:#e6d7ba}.t-amber .sub{color:var(--amber)}
  .t-blue{background:var(--blue-bg);border-color:#cdd9e6}.t-blue .sub{color:var(--blue)}
  .section{margin-top:2.6rem}
  .section>h2{font-family:var(--sans);font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-soft);font-weight:600;margin:0 0 .9rem;padding-bottom:.5rem;border-bottom:1px solid var(--hair)}
  .item{background:var(--card);border:1px solid var(--hair);border-radius:10px;padding:1rem 1.1rem;margin-bottom:.7rem;border-left:3px solid var(--hair)}
  .item.applied{border-left-color:var(--green)}.item.review{border-left-color:var(--amber)}.item.query{border-left-color:var(--blue)}
  .head{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
  .chip{font-family:var(--sans);font-size:.68rem;font-weight:600;letter-spacing:.05em;text-transform:uppercase;padding:.2rem .5rem;border-radius:999px;white-space:nowrap}
  .chip.applied{background:var(--green-bg);color:var(--green)}.chip.review{background:var(--amber-bg);color:var(--amber)}.chip.query{background:var(--blue-bg);color:var(--blue)}
  .name{font-family:var(--sans);font-size:.95rem;font-weight:600}
  .change{font-family:var(--mono);font-size:.95rem;margin-top:.6rem;overflow-x:auto}
  del{color:var(--oxblood);text-decoration:line-through;text-decoration-thickness:1.5px}
  ins{color:var(--green);text-decoration:none;background:var(--green-bg);padding:0 .15em;border-radius:3px}
  .arrow{color:var(--ink-soft);padding:0 .5em}
  .removed{color:var(--ink-soft);font-style:italic;font-family:var(--sans);font-size:.85rem}
  .note{font-family:var(--sans);font-size:.9rem;color:#3c4a5c;background:var(--blue-bg);border-radius:7px;padding:.6rem .75rem;margin-top:.6rem;line-height:1.4}
  footer{margin-top:3rem;font-family:var(--sans);font-size:.82rem;color:var(--ink-soft);border-top:1px solid var(--hair);padding-top:1.2rem}
  @media (max-width:620px){.summary{grid-template-columns:1fr}}
</style></head>
<body><div class="wrap">
  <p class="eyebrow">Copyediting Assistant · Statistical &amp; Numerical Style</p>
  <h1>Review Report</h1>
  <p class="subtitle">${esc(sourceTitle)}</p>
  <hr class="rule" />
  <p class="lede">The assistant checked every number, percentage, and statistic against the house
  style guide. It made the safe, mechanical corrections on its own, and set aside anything that needs
  an editor's judgment or an author's answer. Nothing is final — every change is yours to approve.</p>
  <div class="summary">
    <div class="tile t-green"><div class="num">${c.autoApplied}</div><div class="lab">Applied automatically<span class="sub">Safe, mechanical fixes</span></div></div>
    <div class="tile t-amber"><div class="num">${c.pending}</div><div class="lab">Needs your review<span class="sub">Suggested — you decide</span></div></div>
    <div class="tile t-blue"><div class="num">${c.queries}</div><div class="lab">Questions for the author<span class="sub">Can't be fixed without them</span></div></div>
  </div>
  ${sectionHtml || '<p class="lede">No issues found.</p>'}
  <footer>Every change here is a suggestion over the original text — nothing is overwritten, and the
  full record of what changed and why is kept. The assistant handles the repetitive rule-checking;
  the editor keeps the judgment.</footer>
</div></body></html>`;
}
