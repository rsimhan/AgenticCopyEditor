/**
 * The deterministic workflow: an ordered list of phases (AGENT-ARCHITECTURE §5.4).
 *
 * In production this is driven by a queue (pg-boss) so each manuscript flows through phases with
 * retries and per-chunk locking (wired in later milestones). The ordering and contracts are the
 * stable part; the phase bodies are filled in milestone by milestone.
 *
 * Phases are STUBS in Milestone 0 — they log and no-op — proving the seam runs end to end before
 * any real behavior exists behind it.
 */
import type { Phase, JobContext } from './phase.js';

/** A no-op phase used to stand up the workflow before behavior is implemented. */
function stubPhase(id: string, unit: Phase['unit'], note: string): Phase {
  return {
    id,
    unit,
    run(job: JobContext): Promise<void> {
      job.log(`[phase:${id}] stub — ${note}`);
      return Promise.resolve();
    },
  };
}

/**
 * Canonical phase order (SPEC §5). Each stub is replaced by a real phase in its milestone:
 *   A   ingest/segment (M0/M3)   B   extract (M3)        B.1 reconcile (M3)
 *   B.2 normalize (M3)           C   deterministic (M2)  D   resolve ambiguous (M7)
 *   E   merge/arbitrate (M4)
 */
export const WORKFLOW: readonly Phase[] = Object.freeze([
  stubPhase('A_ingest', 'manuscript', 'segment into chunks + extract table geometry'),
  stubPhase('B_extract', 'chunk', 'populate extracted_statistics + logical_key'),
  stubPhase(
    'B1_reconcile',
    'manuscript',
    'derived checks (det.) + cross-location agreement (fuzzy)',
  ),
  stubPhase('B2_normalize', 'document', 'section/document/table consistency normalizers'),
  stubPhase('C_deterministic', 'chunk', 'span-scoped regex fixes'),
  stubPhase('D_resolve', 'span', 'thin LLM ambiguity resolver'),
  stubPhase('E_merge', 'chunk', 'interval-split arbitration by origin_tier'),
]);

/** Run the workflow phases in order for one manuscript. Deterministic; no LLM in the control flow. */
export async function runWorkflow(job: JobContext): Promise<void> {
  job.log(`workflow start`, { manuscriptId: job.manuscriptId, phases: WORKFLOW.length });
  for (const phase of WORKFLOW) {
    await phase.run(job);
  }
  job.log(`workflow complete`, { manuscriptId: job.manuscriptId });
}
