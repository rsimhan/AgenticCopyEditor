/**
 * UAT harness: extract a copy editor's tracked changes from a .docx as a structured edit list, and
 * classify each as in-scope (statistical/numerical/mechanical — what our v1 pipeline targets) vs
 * out-of-scope (prose/grammar). The in-scope edits are the gold set we score our suggestions against
 * (AGENT-ARCHITECTURE §14). Parsing operates on word/document.xml; the reader lives in docx-xml.ts.
 */

export interface TrackedEdit {
  kind: 'insert' | 'delete' | 'replace';
  deleted?: string;
  inserted?: string;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractText(inner: string, tag: 'w:t' | 'w:delText'): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  let text = '';
  for (const m of inner.matchAll(re)) text += decode(m[1]!);
  return text;
}

type Seg = { type: 'keep' | 'ins' | 'del'; text: string };

/**
 * Ordered run stream including UNCHANGED text, so contiguous changes can be merged and a kept run
 * splits them. ins/del blocks are matched before plain runs, so a run nested inside a change block
 * is consumed as part of that block (not double-counted).
 */
function segments(documentXml: string): Seg[] {
  const re =
    /<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>|<w:del\b[^>]*>([\s\S]*?)<\/w:del>|<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
  const out: Seg[] = [];
  for (const m of documentXml.matchAll(re)) {
    if (m[1] !== undefined) out.push({ type: 'ins', text: extractText(m[1], 'w:t') });
    else if (m[2] !== undefined) out.push({ type: 'del', text: extractText(m[2], 'w:delText') });
    else out.push({ type: 'keep', text: extractText(m[3]!, 'w:t') });
  }
  return out;
}

/**
 * Reconstruct edits from the run stream. Word processors fragment a single logical edit into many
 * adjacent ins/del runs; merge contiguous ins/del into one edit and let any non-empty UNCHANGED run
 * end the current edit. This turns "14"→"2" + ":00"→… fragments back into "14:00"→"2:00 PM".
 */
export function parseTrackedChanges(documentXml: string): TrackedEdit[] {
  const edits: TrackedEdit[] = [];
  let del = '';
  let ins = '';
  const flush = () => {
    if (del || ins) {
      edits.push(
        del && ins
          ? { kind: 'replace', deleted: del, inserted: ins }
          : del
            ? { kind: 'delete', deleted: del }
            : { kind: 'insert', inserted: ins },
      );
    }
    del = '';
    ins = '';
  };
  for (const s of segments(documentXml)) {
    if (s.type === 'del') del += s.text;
    else if (s.type === 'ins') ins += s.text;
    else if (s.text.length > 0) flush(); // unchanged text breaks the contiguous edit group
  }
  flush();
  return edits;
}

// ---- classification: is this edit something our v1 pipeline is meant to make? ----

const MECHANICAL = /[™®℠…]|towards?\b|e-?health|m-?health|\bi\.e\.|\be\.g\.|°[CF]/i;
const NUMERIC_SIGNAL = /\d|[%°≤≥×–−]/;

/**
 * True if the edit is something our v1 pipeline is meant to make: a numeric/statistical/mechanical
 * change. Filters out (a) no-ops, (b) long prose passages that merely contain a stray digit (author
 * affiliations, references), keeping the gold set focused on formatting-of-values edits.
 */
export function isInScope(edit: TrackedEdit): boolean {
  const d = edit.deleted ?? '';
  const i = edit.inserted ?? '';
  if (d === i) return false; // no-op
  const text = `${d} ${i}`;

  if (MECHANICAL.test(text)) return true;
  if (!NUMERIC_SIGNAL.test(text)) return false;

  // A long, word-heavy passage that merely contains a digit is prose (affiliation, citation), not a
  // value-formatting edit.
  const words = text
    .replace(/[^A-Za-z]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (words.length >= 4 && Math.max(d.length, i.length) > 25) return false;

  return true;
}

export interface ScopedEdits {
  all: TrackedEdit[];
  inScope: TrackedEdit[];
  outOfScope: TrackedEdit[];
}

export function classifyEdits(edits: TrackedEdit[]): ScopedEdits {
  const inScope: TrackedEdit[] = [];
  const outOfScope: TrackedEdit[] = [];
  for (const e of edits) (isInScope(e) ? inScope : outOfScope).push(e);
  return { all: edits, inScope, outOfScope };
}
