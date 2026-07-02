/**
 * CLI runner — the Phase-1 (Test) surface (AGENT-ARCHITECTURE §14). Fire a manuscript from the IDE:
 *   pnpm ace edit <file.md>
 * Ingests, runs the full pipeline, and prints a review report. A thin adapter over the service
 * layer (§5.7) — no business logic lives here.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ingestManuscript } from './service/ingest.js';
import { runFullPipeline } from './service/run.js';
import { getManuscriptReport, formatReport } from './service/report.js';
import { closePool } from './db/pool.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0] === 'edit' ? args.slice(1) : args;
  const file = cmd[0];
  if (!file) {
    console.error('Usage: pnpm ace edit <file.md>');
    process.exitCode = 1;
    return;
  }

  const markdown = readFileSync(file, 'utf8');
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
