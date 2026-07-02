/**
 * CLI runner — the Phase-1 (Test) surface (AGENT-ARCHITECTURE §14). Fire a manuscript from the IDE:
 *   pnpm ace edit <file.md>
 * Ingests, runs the full pipeline, and prints a review report. A thin adapter over the service
 * layer (§5.7) — no business logic lives here.
 */
import { basename } from 'node:path';
import { loadManuscriptSource } from './ingest/load.js';
import { ingestManuscript } from './service/ingest.js';
import { runFullPipeline } from './service/run.js';
import { getManuscriptReport, formatReport } from './service/report.js';
import { closePool } from './db/pool.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === 'uat') {
    const [, input, edited] = args;
    if (!input || !edited) {
      console.error('Usage: pnpm ace uat <input.docx> <edited.docx>');
      process.exitCode = 1;
      return;
    }
    const { runComparison, formatComparison } = await import('./uat/compare.js');
    console.error('Extracting gold edits, running pipeline, comparing…\n');
    console.log(formatComparison(await runComparison(input, edited)));
    return;
  }

  const cmd = args[0] === 'edit' ? args.slice(1) : args;
  const file = cmd[0];
  if (!file) {
    console.error(
      'Usage: pnpm ace edit <file.docx|file.md>  |  pnpm ace uat <input.docx> <edited.docx>',
    );
    process.exitCode = 1;
    return;
  }

  const markdown = await loadManuscriptSource(file);
  const { manuscriptId, chunkCount, tableCount } = await ingestManuscript({
    title: basename(file),
    rawContentMarkdown: markdown,
  });
  console.error(`Ingested ${chunkCount} chunks (${tableCount} tables). Running pipeline…`);

  const summary = await runFullPipeline(manuscriptId);
  console.error(
    `Posted: ${summary.deterministic} deterministic · ${summary.reconciliation} reconciliation · ` +
      `${summary.consistency} consistency\n`,
  );

  const report = await getManuscriptReport(manuscriptId);
  console.log(formatReport(report));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool();
  });
