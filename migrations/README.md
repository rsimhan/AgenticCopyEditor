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

_Populated in Milestone 1._
