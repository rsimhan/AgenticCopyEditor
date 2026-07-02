/**
 * Embedding provider seam (AGENT-ARCHITECTURE §5.6, SPEC §7).
 *
 * Feedback-memory vectors are produced by an `Embedder`. The model id and dimensions are written
 * onto every `feedback_memory_vectors` row so read-time queries only ever compare same-space
 * vectors. Default provider is Google Gemini (`gemini-embedding-001`); swapping is a config +
 * re-embed job, not a migration (the polymorphic vector store guarantees this).
 */

export interface Embedding {
  model: string;
  dims: number;
  vector: number[];
}

export interface Embedder {
  readonly model: string;
  readonly dims: number;
  embed(text: string): Promise<Embedding>;
}

/**
 * Placeholder embedder used until the Gemini SDK is wired (Milestone 6). Throws on use so an
 * embedding write can never silently produce a zero/garbage vector.
 */
export class UnconfiguredEmbedder implements Embedder {
  readonly model: string;
  readonly dims: number;
  constructor(model: string, dims: number) {
    this.model = model;
    this.dims = dims;
  }
  embed(_text: string): Promise<Embedding> {
    return Promise.reject(
      new Error(
        'Embedder is not configured. The flywheel vector write is wired in Milestone 6; ' +
          'set GEMINI_API_KEY and provide a real Embedder implementation.',
      ),
    );
  }
}
