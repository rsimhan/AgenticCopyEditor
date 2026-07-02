/**
 * Agent contract seam (AGENT-ARCHITECTURE §5.3).
 *
 * Every specialist implements the same narrow interface: typed input → validated output, reaching
 * the world only through the injected `ToolBelt` and the ledger. An agent NEVER imports another
 * agent. Its `version` is recorded on outputs for reproducibility and flywheel validity.
 *
 * "Agent" here is a competency boundary, not necessarily an LLM call — the deterministic engine is
 * a tool an agent drives (AGENT-ARCHITECTURE §3.1). Some agents never touch the reasoning tier.
 */
import type { ToolBelt } from '../tools/toolbelt.js';

export interface Agent<In, Out> {
  readonly name: string;
  readonly version: string;
  run(input: In, tools: ToolBelt): Promise<Out>;
}
