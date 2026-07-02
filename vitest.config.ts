import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests must be fully deterministic — no live LLM/embedding/network calls
    // (SPEC §9 testing conventions). Integration tests that need Postgres live under
    // tests/integration and are opt-in via the `integration` project later.
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
