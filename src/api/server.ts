/**
 * Review console API — a thin HTTP layer over the service layer (UI-DESIGN §11). Serves the static
 * front-end and exposes the review data + editor actions. No business logic lives here.
 */
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPool, closePool } from '../db/pool.js';
import { getManuscriptReport } from '../service/report.js';
import { PgLedgerRepo } from '../db/ledger-repo.js';
import type { EditorAction } from '../domain/types.js';

const ledger = new PgLedgerRepo();
const here = dirname(fileURLToPath(import.meta.url));

async function defaultEditorId(): Promise<number> {
  const r = await getPool().query(`SELECT editor_id FROM editors ORDER BY editor_id LIMIT 1`);
  return r.rows[0].editor_id as number;
}

async function main(): Promise<void> {
  const app = Fastify({ logger: false });
  await app.register(fastifyStatic, { root: join(here, '../../web'), prefix: '/' });

  app.get('/api/manuscripts', async () => {
    const r = await getPool().query(
      // Only pipeline-processed manuscripts (status advances past 'ingested'); this hides raw
      // test-inserted manuscripts that never ran the pipeline.
      `SELECT manuscript_id, title, status, created_at FROM manuscripts
        WHERE status <> 'ingested' ORDER BY created_at DESC LIMIT 50`,
    );
    return r.rows;
  });

  app.get('/api/manuscripts/:id/report', async (req) => {
    const { id } = req.params as { id: string };
    return getManuscriptReport(id);
  });

  app.post('/api/actions', async (req) => {
    const b = req.body as {
      suggestionId: number;
      action: EditorAction;
      editorId?: number;
      finalText?: string;
    };
    const editorId = b.editorId ?? (await defaultEditorId());
    await ledger.recordAction({
      suggestionId: b.suggestionId,
      editorId,
      action: b.action,
      ...(b.finalText !== undefined ? { finalText: b.finalText } : {}),
    });
    return { ok: true };
  });

  app.post('/api/applied', async (req) => {
    const b = req.body as { suggestionId: number; applied: boolean };
    await getPool().query(
      `UPDATE editing_suggestions SET applied_in_kriyadocs=$2 WHERE suggestion_id=$1`,
      [b.suggestionId, !!b.applied],
    );
    return { ok: true };
  });

  const port = Number(process.env.PORT ?? 5273);
  await app.listen({ port, host: '0.0.0.0' });
  console.error(`Review console → http://localhost:${port}`);
}

main().catch((err) => {
  console.error(err);
  void closePool();
  process.exitCode = 1;
});
