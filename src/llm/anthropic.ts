/**
 * Concrete LlmClient for Anthropic Claude (AGENT-ARCHITECTURE §5.6). Uses the Messages API over
 * global fetch — no SDK dependency. The model id is config-driven and echoed back on every result
 * for reproducibility. Never imported by an agent directly; agents talk to the LlmClient interface.
 */
import type { LlmClient, LlmSpec, LlmResult } from './client.js';

interface AnthropicContentBlock {
  type: string;
  text?: string;
}
interface AnthropicResponse {
  model?: string;
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicLlmClient implements LlmClient {
  readonly model: string;
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(apiKey: string, model: string, endpoint = 'https://api.anthropic.com/v1/messages') {
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = endpoint;
  }

  async complete(spec: LlmSpec): Promise<LlmResult> {
    // Few-shot pairs are replayed as prior user/assistant turns (curation-gated verified memory).
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const ex of spec.fewShot ?? []) {
      messages.push({ role: 'user', content: ex.input });
      messages.push({ role: 'assistant', content: ex.output });
    }
    messages.push({ role: 'user', content: spec.prompt });

    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: spec.maxOutputTokens ?? 512,
        temperature: spec.temperature ?? 0,
        system: spec.system,
        messages,
      }),
    });

    if (!resp.ok) {
      throw new Error(`Anthropic API ${resp.status}: ${await resp.text()}`);
    }
    const data = (await resp.json()) as AnthropicResponse;
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    return {
      text,
      model: data.model ?? this.model,
      ...(data.usage?.input_tokens !== undefined ? { inputTokens: data.usage.input_tokens } : {}),
      ...(data.usage?.output_tokens !== undefined
        ? { outputTokens: data.usage.output_tokens }
        : {}),
    };
  }
}
