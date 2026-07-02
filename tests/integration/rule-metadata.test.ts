import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { loadConfig } from '../../src/config/index.js';
import { spanRuleHandlers } from '../../src/rules/handlers/index.js';

/**
 * Guards the Rule Registry ↔ DB seam (AGENT-ARCHITECTURE §5.2): every implemented handler must
 * correspond to an active style_rules row whose metadata (scope, is_deterministic,
 * is_auto_applicable) matches the code. Catches drift when a rule evolves in code but not in a
 * migration (or vice versa). Requires a live migrated DB.
 */
describe('rule registry ↔ style_rules metadata', () => {
  let pool: pg.Pool;
  let rows: Map<
    string,
    { is_deterministic: boolean; is_auto_applicable: boolean; scope: string; is_active: boolean }
  >;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: loadConfig().DATABASE_URL });
    const res = await pool.query(
      `SELECT rule_id, is_deterministic, is_auto_applicable, scope, is_active FROM style_rules`,
    );
    rows = new Map(res.rows.map((r) => [r.rule_id, r]));
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  for (const handler of spanRuleHandlers) {
    it(`${handler.ruleId} matches its style_rules row`, () => {
      const row = rows.get(handler.ruleId);
      expect(row, `no style_rules row for handler ${handler.ruleId}`).toBeDefined();
      expect(row!.is_active).toBe(true);
      expect(row!.scope).toBe(handler.scope);
      expect(row!.is_deterministic).toBe(handler.isDeterministic);
      expect(row!.is_auto_applicable).toBe(handler.isAutoApplicable);
    });
  }
});
