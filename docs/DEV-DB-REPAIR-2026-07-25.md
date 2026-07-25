# Dev DB repair — missing filter subsystem in `digilog_db` (2026-07-25)

> Runbook for the local-dev repair performed 2026-07-25. This documents a **runtime
> data-layer fix** (no schema/migration change was committed — the SQL applied was
> generated from the current schema). Keep for reference if another local `digilog_db`
> ends up in the same partial state.

## Symptom

On login, the dashboard threw `500` load errors:

```
Invalid `prisma.cleaningCycle.groupBy()` invocation ...
The table `public.cleaning_cycles` does not exist in the current database.
```

(`filter-operations.service.ts` dashboard-stats; likewise `filter_details`, and the
`/api/sync/since` endpoint.)

## Diagnosis

`digilog_db` had only **24 tables** — the admin / auth / config / notification / dashboard
core — and was **missing the entire filter-management subsystem** (~38 tables: `asset_templates`,
`asset_instances`, `filter_details`, `cleaning_cycles`, `filter_events`, `pm_schedules`,
`checklist_profiles`, `equipment_groups`, `replacement_schedule`, versions/sidecars, etc.).

Root cause: the Prisma **baseline migration was marked applied without ever creating those
tables** (adopted onto an older DB via `migrate resolve --applied`). `_prisma_migrations`
listed `00000000000000_baseline` + 3 drop migrations as applied, but the objects never existed.
The `ltree` extension and the manual sequences (`deviation_number_seq`, `qnn_seq`) were also
absent. **Not caused by any code change** — the MFA/lockout reverts only touched `users.mfa_*`
columns and dropped no tables. Both `digilog_db` and `digilog_test_db` showed the identical
24-table state, i.e. a pre-existing partial build.

## Fix (non-destructive — existing data untouched)

Verified additive first (`prisma migrate diff` → **38 CREATE TABLE, 0 DROP, 0 DROP COLUMN**),
took a `pg_dump` backup, then:

```bash
export PGPASSWORD=digilog123
PSQL="/c/Program Files/PostgreSQL/18/bin/psql"
cd apps/api

# 0. Safety backup
"$PGBIN/pg_dump" -h localhost -U digilog -d digilog_db -f digilog_db_backup_pre_repair.sql

# 1. Extensions (ltree needed by the hierarchy; pgcrypto already present)
"$PSQL" -h localhost -U digilog -d digilog_db -f prisma/sql/extensions.sql

# 2. Manual sequences the tables' DEFAULTs reference (Prisma can't express these)
"$PSQL" -h localhost -U digilog -d digilog_db -c \
  "CREATE SEQUENCE IF NOT EXISTS public.audit_trail_chain_position_seq;
   CREATE SEQUENCE IF NOT EXISTS public.deviation_number_seq;
   CREATE SEQUENCE IF NOT EXISTS public.qnn_seq;"

# 3. Create the 38 missing tables (generated from the live schema)
npx prisma migrate diff \
  --from-url "postgresql://digilog:digilog123@localhost:5432/digilog_db?schema=public" \
  --to-schema-datamodel prisma/schema.prisma --script > /tmp/diff.sql
"$PSQL" -h localhost -U digilog -d digilog_db -v ON_ERROR_STOP=1 -1 -f /tmp/diff.sql

# 4. Triggers / functions for the new tables (best-effort; existing objects skip)
"$PSQL" -h localhost -U digilog -d digilog_db -f prisma/sql/invariants.sql

# 5. Seed the lookup/config defaults (idempotent upserts; never overwrites the admin password)
INITIAL_ADMIN_PASSWORD='Admin@123' npx tsx prisma/seed.ts
```

**Order matters:** the diff references `nextval('deviation_number_seq')`, so the sequences
(step 2) must exist before the table creation (step 3), or step 3 aborts.

## Result

- `digilog_db`: **24 → 62 tables**. `cleaning_cycles` / `filter_details` / `asset_templates`
  etc. now exist.
- Seed populated: **6 template kinds, 6 roles, 36 system_config, 33 help articles**, and a
  `superadmin` / `Admin@123` SUPER_ADMIN (no forced change).
- Browser-verified: login OK; dashboard + Filter Cleaning Analytics load with **0 errors**;
  Filter Management page shows the empty-state ("0 filters across 0 blocks", Create Block CTA).
- Existing data (users, roles, config, `audit_trail`) preserved. Backup at
  `…/Temp/claude/digilog_db_backup_pre_repair.sql`.

## Note for a proper fresh install

For a brand-new DB, don't reproduce this ad-hoc path — follow the documented install flow
(`apps/api/CLAUDE.md` → "Applying schema"): apply `prisma/sql/extensions.sql`, then
`npx prisma migrate deploy`, then seed. The ad-hoc steps above were only to repair a DB that
had the baseline **mis-marked** as applied.
