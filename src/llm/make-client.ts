/**
 * LlmClient factory (AGENT-ARCHITECTURE §5.6). The reasoning tier runs only when a provider is
 * actually configured; otherwise the pipeline stays deterministic-only. Swapping providers is a
 * change here, never in the pipeline.
 */
import type { AppConfig } from '../config/index.js';
import type { LlmClient } from './client.js';
import { UnconfiguredLlmClient } from './client.js';
import { AnthropicLlmClient } from './anthropic.js';

/** True when a usable reasoning provider is configured (gates Phase D). */
export function hasLlm(config: AppConfig): boolean {
  return config.LLM_PROVIDER === 'anthropic' && !!config.ANTHROPIC_API_KEY;
}

export function makeLlmClient(config: AppConfig): LlmClient {
  if (config.LLM_PROVIDER === 'anthropic' && config.ANTHROPIC_API_KEY) {
    return new AnthropicLlmClient(config.ANTHROPIC_API_KEY, config.LLM_MODEL);
  }
  // No key → a client that throws on use; callers gate on hasLlm() and skip Phase D.
  return new UnconfiguredLlmClient(config.LLM_MODEL);
}
