import { defineConfig } from 'vitest/config';

// Integration tests require a live Postgres (pnpm db:up + pnpm migrate:up). Kept separate from
// the default unit suite so `pnpm test` stays fully deterministic and offline (SPEC §9).
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // A single DB; run integration files serially to avoid cross-test interference.
    fileParallelism: false,
  },
});
