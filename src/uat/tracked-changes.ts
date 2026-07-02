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

function decodeXml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Ordered ins/del tokens as they appear in the document. */
function tokens(documentXml: string): Array<{ op: 'ins' | 'del'; text: string }> {
  const out: Array<{ op: 'ins' | 'del'; text: string }> = [];
  const re = /<w:(ins|del)\b[^>]*>([\s\S]*?)<\/w:\1>/g;
  for (const m of documentXml.matchAll(re)) {
    const op = m[1] === 'ins' ? 'ins' : 'del';
    const inner = m[2]!;
    const textTag = op === 'ins' ? /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g : /<w:delText\b[^>]*>([\s\S]*?)<\/w:delText>/g;
    let text = '';
    for (const t of inner.matchAll(textTag)) text += decodeXml(t[1]!);
    if (text.length > 0) out.push({ op, text });
  }
  return out;
}

/** Merge adjacent del/ins tokens into edits (a del immediately followed by an ins is a replace). */
export function parseTrackedChanges(documentXml: string): TrackedEdit[] {
  const toks = tokens(documentXml);
  const edits: TrackedEdit[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.op === 'del' && toks[i + 1]?.op === 'ins') {
      edits.push({ kind: 'replace', deleted: t.text, inserted: toks[i + 1]!.text });
      i++;
    } else if (t.op === 'del') {
      edits.push({ kind: 'delete', deleted: t.text });
    } else {
      edits.push({ kind: 'insert', inserted: t.text });
    }
  }
  return edits;
}

// ---- classification: is this edit something our v1 pipeline is meant to make? ----

const MECHANICAL =
  /[™®℠…]|towards?\b|e-?health|m-?health|\bi\.e\.|\be\.g\.|°[CF]/i;

/** True if the edit touches numbers/percentages/units/operators or a mechanical house-style term. */
export function isInScope(edit: TrackedEdit): boolean {
  const text = `${edit.deleted ?? ''}${edit.inserted ?? ''}`;
  if (MECHANICAL.test(text)) return true;
  // Numeric/statistical: a digit is involved, or a % / comparison operator / degree sign.
  if (/\d/.test(text) || /[%°≤≥×–−]/.test(text)) return true;
  // Pure spacing/punctuation change around a very short token (e.g. "P < .001" → "P<.001").
  if (edit.kind === 'replace' && (edit.deleted ?? '').replace(/\s/g, '') === (edit.inserted ?? '').replace(/\s/g, '')) {
    return true;
  }
  return false;
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
