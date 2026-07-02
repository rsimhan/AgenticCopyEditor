import { describe, it, expect } from 'vitest';
import { runWorkflow, WORKFLOW } from '../../src/orchestrator/workflow.js';
import { RuleRegistry } from '../../src/rules/registry.js';
import { UnconfiguredLlmClient } from '../../src/llm/client.js';
import { UnconfiguredEmbedder } from '../../src/embedding/embedder.js';
import type { JobContext } from '../../src/orchestrator/phase.js';
import type { ToolBelt } from '../../src/tools/toolbelt.js';
import type { AppConfig } from '../../src/config/index.js';
import type { LedgerRepo } from '../../src/db/ledger.js';
import type { MathChecks } from '../../src/tools/math.js';

// Stub tools — no DB, no network. Proves the orchestration seam runs before any behavior exists.
const stubLedger = {} as LedgerRepo;
const stubMath = {} as MathChecks;

const tools: ToolBelt = {
  llm: new UnconfiguredLlmClient('claude-opus-4-8'),
  embedder: new UnconfiguredEmbedder('gemini-embedding-001', 3072),
  ledger: stubLedger,
  math: stubMath,
};

const config = { NODE_ENV: 'test', LLM_CALL_BUDGET_PER_MANUSCRIPT: 200 } as unknown as AppConfig;

function makeJob(logs: string[]): JobContext {
  return {
    manuscriptId: '00000000-0000-0000-0000-000000000000',
    tools,
    registry: new RuleRegistry(),
    config,
    log: (msg) => logs.push(msg),
  };
}

describe('workflow skeleton (Milestone 0 seam)', () => {
  it('runs every phase in canonical order deterministically', async () => {
    const logs: string[] = [];
    await runWorkflow(makeJob(logs));

    // Each stub phase logs "[phase:<id>]"; assert order matches WORKFLOW.
    const phaseLogs = logs.filter((l) => l.startsWith('[phase:'));
    expect(phaseLogs).toHaveLength(WORKFLOW.length);
    const order = phaseLogs.map((l) => l.slice('[phase:'.length, l.indexOf(']')));
    expect(order).toEqual(WORKFLOW.map((p) => p.id));
  });

  it('registry rejects duplicate rule handlers (routing-table integrity)', () => {
    const reg = new RuleRegistry();
    const handler = {
      ruleId: 'demo_rule',
      scope: 'span' as const,
      isDeterministic: true,
      isAutoApplicable: true,
      detect: () => [],
      resolve: () => ({ kind: 'noop' as const }),
    };
    reg.register(handler);
    expect(() => reg.register(handler)).toThrow(/duplicate/);
    expect(reg.byScope('span')).toHaveLength(1);
  });
});
