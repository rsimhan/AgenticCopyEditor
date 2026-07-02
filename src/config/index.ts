/**
 * Configuration seam. Loads and validates environment into a typed, frozen config object.
 * Provider/model choices live here (AGENT-ARCHITECTURE §5.6) so nothing downstream reads
 * `process.env` directly.
 */
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const EnvSchema = z.object({
  DATABASE_URL: z.string().url().default('postgres://ace:ace_dev_password@localhost:5433/ace'),

  LLM_PROVIDER: z.enum(['anthropic']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('claude-opus-4-8'),

  EMBEDDING_PROVIDER: z.enum(['gemini']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(3072),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LLM_CALL_BUDGET_PER_MANUSCRIPT: z.coerce.number().int().positive().default(200),
});

export type AppConfig = Readonly<z.infer<typeof EnvSchema>>;

let cached: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.toString()}`);
  }
  cached = Object.freeze(parsed.data);
  return cached;
}
