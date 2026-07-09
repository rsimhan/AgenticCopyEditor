/**
 * Read word/document.xml out of a .docx (a zip) for tracked-change parsing. Uses jszip so it works
 * on every platform (the previous `unzip` shell-out was Unix-only). Dev/UAT tooling, not part of the
 * production runtime.
 */
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

export async function readDocumentXml(docxPath: string): Promise<string> {
  const zip = await JSZip.loadAsync(await readFile(docxPath));
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error(`word/document.xml not found in ${docxPath}`);
  return entry.async('string');
}
