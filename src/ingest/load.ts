/**
 * Load a manuscript source file as Markdown, converting .docx on the fly. This is the ingest
 * adapter's front-edge — everything downstream speaks Markdown/text.
 */
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { docxToMarkdown } from './docx.js';

export async function loadManuscriptSource(path: string): Promise<string> {
  if (extname(path).toLowerCase() === '.docx') return docxToMarkdown(path);
  return readFileSync(path, 'utf8');
}
