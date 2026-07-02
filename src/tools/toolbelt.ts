/**
 * ToolBelt — the bundle of capabilities injected into every agent (AGENT-ARCHITECTURE §5.3/§5.5).
 *
 * An agent reaches the outside world ONLY through this belt and the ledger. It never imports a
 * provider SDK, never writes raw SQL, and never imports another agent. This is what keeps agents
 * narrow and swappable, and what makes the whole graph testable (inject stub tools).
 */
import type { LlmClient } from '../llm/client.js';
import type { Embedder } from '../embedding/embedder.js';
import type { LedgerRepo } from '../db/ledger.js';
import type { MathChecks } from './math.js';

export interface ToolBelt {
  readonly llm: LlmClient;
  readonly embedder: Embedder;
  readonly ledger: LedgerRepo;
  readonly math: MathChecks;
}
