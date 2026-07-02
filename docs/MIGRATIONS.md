# Migrations

Ordered SQL migrations applied by [`node-pg-migrate`](https://github.com/salsita/node-pg-migrate).
The schema is generated from **SPEC.md §4** — the schema is the contract; do not deviate without
updating the spec.

## Commands

```bash
pnpm db:up          # start Postgres 16 + pgvector (docker compose)
pnpm migrate:up     # apply all pending migrations
pnpm migrate:down   # roll back the last migration
pnpm migrate:create some_name   # scaffold a new up/down SQL migration
```

`DATABASE_URL` is read from `.env` (see `.env.example`).

## Conventions

- One logical schema group per migration, applied in order (SPEC §9 M1):
  extensions → editors → style_rules → manuscripts → chunks → tables/cells →
  extracted_statistics → editing_suggestions → action_audit_log →
  feedback_memory_records → feedback_memory_vectors → stat_precision_policy →
  append-only trigger → seeds.
- Every migration has an **up and a down** (`-- Up`/`-- Down` sections in the SQL file) and is
  covered by the M1 smoke test.
- Enum-like columns use `CHECK` constraints so integrity is enforced in the database.
- **Do not put non-migration files in `migrations/`** — `node-pg-migrate` tries to load every file
  in that directory (this doc lives in `docs/` for that reason).

## Migration files (Milestone 1)

| File | Contents |
|---|---|
| `0001_extensions_and_identity.sql` | `uuid-ossp` + `vector` extensions; `editors`; `style_rules` |
| `0002_manuscripts_and_structure.sql` | `manuscripts`; `manuscript_chunks`; `manuscript_tables`; `table_cells` |
| `0003_stats_and_suggestions.sql` | `extracted_statistics`; `editing_suggestions` (kind/proposed CHECK) |
| `0004_audit_log_append_only.sql` | `action_audit_log` + append-only trigger |
| `0005_memory_and_precision.sql` | `feedback_memory_records`; `feedback_memory_vectors`; `stat_precision_policy` |
| `0006_seed_rules_policy_editors.sql` | seed: 24 style rules, 9 precision policies, 2 editors |

Verified: `pnpm migrate:up`, full rollback (`down 6`), re-apply, and the integration smoke test all pass.
