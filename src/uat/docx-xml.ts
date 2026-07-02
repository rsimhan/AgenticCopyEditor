/**
 * Read word/document.xml out of a .docx (a zip) for tracked-change parsing. Uses the system `unzip`
 * (present on macOS/Linux); this is dev/UAT tooling, not part of the production runtime.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export async function readDocumentXml(docxPath: string): Promise<string> {
  const { stdout } = await execFileP('unzip', ['-p', docxPath, 'word/document.xml'], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8',
  });
  return stdout;
}
