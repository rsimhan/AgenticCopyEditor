import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { loadConfig } from '../../src/config/index.js';
import { DEFAULT_PRECISION_POLICIES } from '../../src/pipeline/precision-policy.js';

/**
 * Guards against drift between the in-code DEFAULT_PRECISION_POLICIES (used by DB-free unit tests)
 * and the seeded `stat_precision_policy` rows. Requires a live migrated DB.
 */
describe('DEFAULT_PRECISION_POLICIES ↔ stat_precision_policy', () => {
  let pool: pg.Pool;
  let rows: Map<
    string,
    { decimal_places: number | null; keep_first_sig_digit: boolean; strip_trailing_zero: boolean }
  >;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: loadConfig().DATABASE_URL });
    const res = await pool.query(
      `SELECT stat_type, decimal_places, keep_first_sig_digit, strip_trailing_zero FROM stat_precision_policy`,
    );
    rows = new Map(res.rows.map((r) => [r.stat_type, r]));
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  for (const [statType, policy] of Object.entries(DEFAULT_PRECISION_POLICIES)) {
    it(`${statType} matches the seeded policy`, () => {
      const row = rows.get(statType);
      expect(row, `no stat_precision_policy row for ${statType}`).toBeDefined();
      expect(row!.decimal_places).toBe(policy.decimalPlaces);
      expect(row!.keep_first_sig_digit).toBe(policy.keepFirstSigDigit);
      expect(row!.strip_trailing_zero).toBe(policy.stripTrailingZero);
    });
  }
});
