/**
 * LLM provider seam (AGENT-ARCHITECTURE §5.6).
 *
 * The reasoning tier (Phase D ambiguity resolver, reflection agent) talks to an `LlmClient`,
 * never to a provider SDK directly. The concrete model is a config value and is recorded on
 * every suggestion for reproducibility. Swapping Claude for another model is a config + client
 * change, never a schema or pipeline change.
 */

export interface LlmSpec {
  /** System prompt: the agent's narrow role + the relevant style_rules text. */
  system: string;
  /** User content: the span and its surrounding context. */
  prompt: string;
  /** Optional few-shot examples retrieved from verified memory (curation-gated). */
  fewShot?: Array<{ input: string; output: string }>;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface LlmResult {
  text: string;
  model: string;
  /** Token accounting for cost governance (AGENT-ARCHITECTURE §10). */
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmClient {
  readonly model: string;
  complete(spec: LlmSpec): Promise<LlmResult>;
}

/**
 * Placeholder client used until the Anthropic SDK is wired (Milestone 7). It throws on use so a
 * reasoning call can never silently no-op, but lets the whole graph type-check and run with the
 * deterministic tier today. Unit tests inject a recorded/stub client instead (SPEC §9).
 */
export class UnconfiguredLlmClient implements LlmClient {
  readonly model: string;
  constructor(model: string) {
    this.model = model;
  }
  complete(_spec: LlmSpec): Promise<LlmResult> {
    return Promise.reject(
      new Error(
        'LLM client is not configured. The reasoning tier (Phase D) is wired in Milestone 7; ' +
          'set ANTHROPIC_API_KEY and provide a real LlmClient implementation.',
      ),
    );
  }
}
