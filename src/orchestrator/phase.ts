/**
 * Orchestrator seam (AGENT-ARCHITECTURE §5.4).
 *
 * The orchestrator is a DETERMINISTIC workflow over the SPEC §5 phases (A→F). It is code, not an
 * LLM — an LLM never decides what runs next. Each phase dispatches to an agent/engine and advances.
 * A new competency is a new `Phase` slotted into the workflow; existing phases stay unchanged.
 */
import type { ToolBelt } from '../tools/toolbelt.js';
import type { RuleRegistry } from '../rules/registry.js';
import type { AppConfig } from '../config/index.js';

/** The unit a phase operates over, for logging/parallelism decisions. */
export type PhaseUnit = 'manuscript' | 'document' | 'chunk' | 'table' | 'span';

/** Everything a phase needs, injected — no globals, no direct env/SDK access. */
export interface JobContext {
  readonly manuscriptId: string;
  readonly tools: ToolBelt;
  readonly registry: RuleRegistry;
  readonly config: AppConfig;
  readonly log: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface Phase {
  readonly id: string;
  readonly unit: PhaseUnit;
  run(job: JobContext): Promise<void>;
}
