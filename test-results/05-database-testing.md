# 05 — Database Testing (Phase 5, Round 1)

Production-readiness campaign, Round 1. Executed 2026-10-22 (16:20–17:45 IST) on the developer PC.
No source file was changed and nothing was committed; the only file written in the repo is this report.
**Added later the same day, after the fixes:** the Fix column of §6, defect D-DB-11 and the last part of
§3.4 (a .dump archive that carries `digilog_keep`). Everything else describes the code as measured at `be6e0b3`.

| Item | Value |
|---|---|
| Code measured | branch `RFID`, HEAD `8d43bec` → `be6e0b3` during the run (`be6e0b3` is docs-only, so the API code is the same). **All file:line references are at HEAD `be6e0b3`.** Working tree: other agents had uncommitted edits in `filter-operations/cycle-write/*`, `packages/shared/pipeline-executor/transitions.ts`, and — from 17:16 on — `lib/hash-chain.ts`, `lib/audit-verify.ts`, `backup/backup.repository.ts`, `audit/routes.ts` (redacted-row verification). The chain and backup tests in §2–§3.3 ran **before 17:16**, so they measured the committed code. The BR-100 / BR-101 run (§3.4, 17:40–17:44) ran with those edits in the working tree; it writes and restores no redacted row, so the edits (redacted-row verification only) are not on its path. |
| PostgreSQL | 18.3, stock settings: `shared_buffers` 128 MB, `work_mem` 4 MB, `max_connections` 100, `effective_cache_size` 4 GB. `pg_stat_statements` is **still not installed** (the restart noted on 2026-10-17 has not happened). |
| Databases | `digilog_db` — read-only, used only as the drift-guard reference and for catalog reads. `digilog_test_db` — vitest, single fork. `digilog_migrate_perf` — **new**, built here purely from migrations + seed, kept as evidence. `digilog_restore_perf` — reloaded here from the go-live copy (`digilog_day1_perf`) and used for every restore; it no longer holds the 9 GB one-year restore of 10-17. `digilog_perf` — one-year copy, read paths only (plus the login rows the probes write). |
| Evidence legend | **EXECUTED 2026-10-22** = run in this report, by the command or script named in the row. **CARRIED FORWARD 2026-10-17** = from `docs/production-readiness/05_DATABASE_STRESS_AND_SCALABILITY.md` or `10_BACKUP_RESTORE_AND_RECOVERY.md`, not re-measured. |
| Scripts and logs | `C:\Users\hello\AppData\Local\Temp\claude\C--Users-hello-21cfrlogbook-DigitalFMS\b0eb7933-5ac2-4a74-9db1-1b2a29e7de92\scratchpad\db05\` (§7). Every script that writes refuses a database whose name does not end in `_perf` (`tests/performance/data-generation/perf-env.ts`). |

What changed since 10-17 that this report re-runs: one new migration (`20261019090000`); the backup
module (`419358e` 2026-10-21 — ten defects; `08c2706` 2026-10-22 — CSV formula text restores exactly;
`8d43bec` 2026-10-22 — the size messages); the verifier (`signature_audit_id` selection, fixed in
`4ddd2cd`); and the hot read paths touched by the 10-17/10-19 fixes (`batch-preload.ts`, the 30-day
Cycles window, the cached audit count, the stage-approvals window).

---

## Summary

| Area | Result | Evidence |
|---|---|---|
| New migration applies to a fresh database | PASS — 15 migrations, 24.1 s, then the fresh-install seed in 7.7 s; re-seeding changes nothing | EXECUTED 2026-10-22 |
| New migration applies to a populated copy (upgrade) | PASS — 4.4 s on the 7.4 M-row one-year restore; second run "No pending migrations" | EXECUTED 2026-10-22 |
| Drift guard (`scripts/verify-migrations.ps1`) | PASS against `digilog_db` and against `digilog_test_db` — **but it cannot see the partial unique index or the audit trigger (D-DB-1)** | EXECUTED 2026-10-22 |
| Independent schema fingerprint, fresh vs dev vs test | Same indexes (incl. the partial index's `WHERE is_active`), triggers, sequences, enums; only cosmetic differences | EXECUTED 2026-10-22 |
| `audit_trail` no-delete trigger | Refuses DELETE (single row and whole table). TRUNCATE and UPDATE are not blocked (by design; see §2.1) | EXECUTED 2026-10-22 |
| Hash chain on a clean database | Intact: 84 rows incl. signed rows and 40 concurrent writes; positions contiguous; sequence aligned; an UPDATE tamper is detected | EXECUTED 2026-10-22 |
| Constraints the code relies on | Unique visit date per schedule, active-name index, unique tag value, one in-progress cycle per filter, event/cycle filter match, identifier FK: all enforced | EXECUTED 2026-10-22 |
| "One identifier per entity" | **NOT enforced by the database; two concurrent assigns give a filter two tags in 10/10 trials (D-DB-2)** | EXECUTED 2026-10-22 |
| uuid / constraint errors answer 4xx, not 500 | PASS — 16 of 17 test files passed (229 tests); the 17th, `e2e/audit-chain.test.ts`, failed in its `beforeAll` hook (10 s timeout under load, its 6 tests did not run, run exit 1) and passes 6/6 alone (D-DB-8) | EXECUTED 2026-10-22 |
| Backup round trip, JSON | PASS — chain intact, parent links and mirrors intact, sequences realigned; only µs → ms on timestamps (D-DB-5) | EXECUTED 2026-10-22 |
| Backup round trip, CSV | **FAIL — the restore refuses the app's own CSV backup (802 of 35,327 audit rows "do not match"), D-DB-3.** With `force`: formula-like text exact, chain intact, but empty strings become NULL (D-DB-4) | EXECUTED 2026-10-22 |
| Backup round trip, pg_dump (in-app) | PASS — byte-identical content in every table, chain intact | EXECUTED 2026-10-22 |
| **BR-100** — a restore never destroys live audit rows the backup lacks | PASS for JSON, BAK and pg_dump: 6 rows written after each backup (incl. a signature and a signed row) are present and unchanged after the restore, chain verifies, sequence aligned (§3.4). **Not covered by this run: a .dump archive that itself carries `digilog_keep` loses every such row (D-DB-11, found and fixed later the same day)** | EXECUTED 2026-10-22 |
| **BR-101** — a failed .dump restore rolls back | PASS — a truncated archive fails with `RESTORE_FAILED` "rolled back to its pre-restore state"; all 61 tables, sequences, indexes, triggers and the chain are as before. **It leaves a `digilog_keep` schema behind with a mutable copy of the whole audit trail (D-DB-10)** (§3.4) | EXECUTED 2026-10-22 |
| In-app backup at production volume | **In-app JSON/CSV/BAK/SQL export is refused at 500,000 rows per table, and in-app restore is capped at 100 MB — both reached ~3–4 weeks after go-live (D-DB-6)** | EXECUTED 2026-10-22 (refusal) + CARRIED FORWARD 2026-10-17 (dump size) |
| Query health of the hot lists (one year) | The tablet Cycles view **fails** once its window holds > 32,764 cycles: Postgres bind-variable limit (D-DB-9). Six slow paths; batch-states is **17,934 queries per call** on the one-year copy (§4) | EXECUTED 2026-10-22 — report only, nothing changed |

---

## 1. Migrations

### 1.1 What is new since 2026-10-17 (by folder date)

| Migration | Folder date | Content | Status |
|---|---|---|---|
| `20261019090000_block_change_notification_types` | 2026-10-19 | `ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS` × 3 (`BLOCK_CHANGE_REQUESTED/_APPROVED/_REJECTED`) — additive | the only migration added since 10-17 (`ls apps/api/prisma/migrations`; `git log --since=2026-10-17 -- apps/api/prisma`). The other two prisma commits since then (`19d80f5`, `edf0955`) changed the seed / install baseline only. |

The other 14 migrations (baseline + `20260701…` to `20261001090000_list_view_permissions`) predate 10-17
and are covered by the fresh build below anyway.

State of each database before the run (`_prisma_migrations`): `digilog_db`, `digilog_test_db`,
`digilog_qa_perf` = 15 applied; `digilog_perf`, `digilog_day1_perf`, `digilog_restore_perf` = 14
(missing `20261019090000`). EXECUTED 2026-10-22.

### 1.2 Fresh install from migrations (EXECUTED 2026-10-22)

- **Drift guard, reference `digilog_db`:** `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-migrations.ps1`
  built `digilog_db_driftcheck` (extensions, then `prisma migrate deploy`: 15 migrations applied), diffed
  it against `digilog_db` → **"PASS: migrations reproduce the reference schema exactly."**, dropped the
  scratch DB. Log `drift-dev.log`.
- **Drift guard, reference `digilog_test_db`:** same, `-ReferenceUrl …/digilog_test_db` → **PASS**. Log `drift-test.log`.
- **Own fresh build** `digilog_migrate_perf`: `extensions.sql`, then `prisma migrate deploy` → 15 applied in
  **24.1 s** (`migrate-fresh.log`). Then the fresh-install seed exactly as the installer runs it
  (`INITIAL_ADMIN_PASSWORD=… SEED_INSTALL_BASELINE=1 npx tsx prisma/seed.ts`) → **7.7 s**: 1 user,
  7 roles, 30 `system_config` rows, 33 help articles, 4 asset templates, 6 template kinds, 0 audit rows
  (`seed-fresh.log`). A second seed run changed none of these counts (create-only, as documented).
- The npm wrapper `npm run db:verify-migrations` does **not** run on this PC: `powershell -NoProfile
  -File` is refused by the default execution policy ("running scripts is disabled on this system").
  D-DB-7.

### 1.3 Independent schema fingerprint (EXECUTED 2026-10-22)

The drift guard compares two databases through `prisma migrate diff`, which only sees what
`schema.prisma` can express. To check the rest, `catalog.sql` fingerprints the public schema — every
index with its full definition, every non-internal trigger, every function body (md5 of
`pg_get_functiondef`), constraint, sequence, enum and column default — on the fresh build, `digilog_db`
and `digilog_test_db`, and diffs them.

| Object | Fresh vs `digilog_db` | Fresh vs `digilog_test_db` |
|---|---|---|
| Indexes (incl. `asset_instances_active_name_key … (lower(name)) WHERE is_active`, `pm_schedule_entries_schedule_id_planned_date_key`, `idx_cleaning_cycles_one_in_progress_per_filter`, `audit_trail_chain_position_idx`) | identical | identical |
| Triggers (incl. `audit_trail_no_delete BEFORE DELETE … block_audit_trail_delete()`) | identical | identical |
| Sequences, enums (incl. the 3 new `NotificationType` values), extensions | identical | identical |
| Function bodies | 4 differ, **whitespace and one comment only** (`diff -w` shows only a 2-line comment in `check_asset_relationship_pair`) | 2 differ, same comment / whitespace |
| Constraints | dev has `deviations_deviation_number_key`, `deviations_pm_schedule_entry_id_key`, `quality_notifications_qnn_key` as bare unique **indexes**, fresh/test as unique **constraints** — same enforcement | identical |
| Column defaults | 9 × `now()` (fresh) vs `CURRENT_TIMESTAMP` (dev) — equivalent | identical |

Seeding re-applies `prisma/sql/invariants.sql`, which replaces two function bodies with copies that
differ from the migration's only in comments; after seeding, the fresh build matches `digilog_test_db`.
(`invariants.sql`'s header still cites `20260504190000_compliance_invariants`, which now lives in
`prisma/migrations_archive_20260624/` — cosmetic.)

### 1.4 What the drift guard can and cannot detect (EXECUTED 2026-10-22) — D-DB-1

On `digilog_migrate_perf` each object was broken in turn, `prisma migrate diff --from-url <fresh>
--to-url <digilog_test_db> --script` was run (the guard's own comparison, `verify-migrations.ps1:101`),
and the object was restored. The fingerprint afterwards equals the original (`drift-blindspots.log`).

| Broken in the fresh DB | Drift guard output |
|---|---|
| nothing (control) | "This is an empty migration." |
| `DROP INDEX asset_instances_active_name_key` | **"This is an empty migration."** (not detected) |
| partial index recreated **without** `WHERE is_active` | **"This is an empty migration."** (not detected) |
| `DROP TRIGGER audit_trail_no_delete` | **"This is an empty migration."** (not detected) |
| `chain_position` default (sequence) removed | detected (`CREATE SEQUENCE … SET DEFAULT nextval(…)`) |

So the root CLAUDE.md line *"the partial unique index … is migration-only — `schema.prisma` cannot
express it; the drift guard covers it"* (CLAUDE.md:120) is **not true**: the guard passes a fresh install
that lacks the index, has the wrong predicate, or lacks the 21 CFR §11 no-delete trigger. Today all three
are present (§1.3), so nothing is broken now; the gap is in the release gate.

### 1.5 Upgrade of a populated copy (EXECUTED 2026-10-22)

`DATABASE_URL=…/digilog_restore_perf npx prisma migrate deploy` on the one-year restore (7,407,111 audit
rows, 14 migrations): applied `20261019090000` in **4.4 s**; row counts unchanged; the enum gained the
three values; a second run printed "No pending migrations to apply." (`upgrade-restore-perf.log`,
`upgrade-before.txt`, `upgrade-after.txt`).

---

## 2. Integrity

### 2.1 `audit_trail` no-delete trigger (EXECUTED 2026-10-22, `digilog_migrate_perf`, `trigger-probes.log`)

| Statement (as the application's own DB role `digilog`) | Result |
|---|---|
| `DELETE FROM audit_trail WHERE chain_position = 10` | refused: *"audit_trail rows are immutable. Use the admin delete endpoint…"* |
| `DELETE FROM audit_trail` | refused, same message |
| `TRUNCATE audit_trail` (in a rolled-back transaction) | **allowed** — 0 rows visible until rollback |
| `UPDATE audit_trail SET after_value = …` | **allowed** (no UPDATE trigger) — but detected by the verifier, §2.2 |

The only trigger on the table is the row-level `BEFORE DELETE`; a row trigger never fires on TRUNCATE,
and the app's role owns the table (so it can also disable the trigger, which the audited hard-delete
endpoint does on purpose). The JSON/CSV restore relies on TRUNCATE. This is the documented design (root
CLAUDE.md, "no-DELETE trigger, never a no-UPDATE one"); stated here because an emptied table verifies
as "intact" (there is nothing left to verify), so the backups — not the chain — are the defence against
a truncation.

### 2.2 Hash chain on a clean database (EXECUTED 2026-10-22, `integrity.mts` → `integrity.json`, `tamper.log`)

On the fresh, seeded `digilog_migrate_perf`, through the app's own `auditLog()`:

- 21 sequential rows, 3 rows **signed** (written under a request store holding a `REAUTH_SUCCESS` id,
  exactly as the re-auth gate does), and 40 rows written **concurrently** (`Promise.all`), plus 20
  `ASSET_IDENTIFIER_CREATED` rows from §2.4 → 84 rows.
- `verifyAuditChain()` (the app verifier) → **intact, 0 anomalies, 84 rows**. Positions 1…84, all
  distinct, no gaps; `audit_trail_chain_position_seq` last value 84 (next 85).
- `verify-perf-chain.ts` → `signedRowFalsePositives: 0` — the 10-17 verifier defect (signed rows always
  flagged) is fixed.
- Tamper test: `UPDATE audit_trail SET after_value = '{"i": 999}' WHERE chain_position = 30` → the
  verifier reports exactly **one `PER_ROW_CHECKSUM_MISMATCH` at position 30** ("in-place tampering detected").
- The existing chain tests on `digilog_test_db` — `e2e/audit-chain.test.ts` (6 tests incl. signed row,
  in-place mutation, keyed-era downgrade, `GET /api/audit/verify-chain`), `lib/hash-chain.test.ts`,
  `audit-chain-walk`, `audit-writes`, `audit-verify-legacy-key-order`, `audit-signature-bound` — pass (§2.5).

### 2.3 Constraints the code relies on (EXECUTED 2026-10-22, `constraints.sql` → `constraints.log`, `constraints5.log`)

Each probe is a write that must be refused, in its own rolled-back transaction, on `digilog_migrate_perf`.

| Rule the code relies on | Probe | Result |
|---|---|---|
| Active asset names unique, case-insensitive (`asset_instances_active_name_key`, migration-only) | two active `DB05-Dup-Name` / `db05-dup-name` | refused `23505` |
| …but only while active (`WHERE is_active`) | same names, first one inactive | both inserted (correct) |
| One PM visit per date per schedule (`pm_schedule_entries_schedule_id_planned_date_key`) | two visits 2099-03-10 | refused `23505` |
| …several visits a month allowed (old `[scheduleId, month]` key gone) | 2099-03-02 and 2099-03-28 | both inserted (correct) |
| An RFID tag value belongs to one asset (`asset_identifiers_identifier_value_key`) | same value on two filters | refused `23505` |
| …case variants | `db05-case-tag` and `DB05-CASE-TAG` | **both inserted** — the index is case-sensitive; the service canonicalises RFID to upper case and checks case-insensitively before inserting (C-07), so only a writer bypassing the service (or the race in §2.4) can create this |
| Identifier → asset FK | identifier for a random uuid | refused `23503` |
| One IN_PROGRESS cycle per filter (`idx_cleaning_cycles_one_in_progress_per_filter`) | two in-progress cycles on one filter | refused `23505` |
| An event's filter is its cycle's filter (`check_filter_event_consistency`) | event of filter A on filter B's cycle | refused: "FilterEvent.filter_id … does not match cycle.filter_id" |
| **One identifier per entity** | two different tags on one filter | **both inserted — no database rule** (see §2.4) |

### 2.4 "One identifier per entity" under concurrency (EXECUTED 2026-10-22) — D-DB-2

`integrity.mts` created 10 filters and, for each, called the real `identifierService.create()` twice at
the same moment with two different RFID tags. **10 of 10 filters ended with two identifiers; both calls
answered success every time** (`integrity.json` → `identifierRace`). The rule is checked only in code:
`identifier.service.ts:58` reads the filter's existing identifiers outside the transaction, and the insert
happens later in a separate `$transaction` (`:93`, `:120`); `schema.prisma:798-808` has a unique index on
`identifier_value` and a plain index on `asset_id`, nothing unique per asset. A double submit (two
tablets, or tablet and web) can leave a filter with two tags, and every scan path assumes one.

### 2.5 uuid / constraint errors answer 4xx (EXECUTED 2026-10-22, `digilog_test_db`, single fork)

```
cd apps/api && npx vitest run --pool=forks --poolOptions.forks.singleFork=true \
  src/e2e/uuid-route-params.test.ts src/e2e/prisma-not-found-404.test.ts src/e2e/error-leak-prisma.test.ts \
  src/lib/__tests__/error-handler.test.ts src/lib/__tests__/error-handler-branches.coverage.test.ts src/lib/errors.test.ts \
  src/e2e/audit-chain.test.ts src/lib/hash-chain.test.ts src/lib/__tests__/audit-chain-walk.coverage.test.ts \
  src/lib/__tests__/audit-writes.coverage.test.ts src/e2e/filter-replace-duplicate-name.test.ts \
  src/e2e/rfid-canonical-write.test.ts src/e2e/retire-replace-identifier-invariant.test.ts \
  src/e2e/pm-schedules-upload.test.ts src/e2e/pm-schedules-defects.test.ts \
  src/lib/__tests__/audit-verify-legacy-key-order.test.ts src/lib/__tests__/audit-signature-bound.test.ts
```

Result: **16 files passed (229 tests); 1 file failed — `e2e/audit-chain.test.ts`, whose `beforeAll`
hit the default 10 s hook timeout in the combined run, so its 6 tests did not run (vitest exit code 1).**
Run alone it passes **6/6** (`vitest-audit-chain-alone.log`). D-DB-8. What the passing tests establish:
a malformed uuid in 18 route params and 4 body id lists answers **400 VALIDATION_ERROR** with no ERROR
log line; Prisma P2025 → **404**, P2002 → **409 CONFLICT**, unmapped P-codes → **400 DATA_CONSTRAINT**,
`PrismaClientValidationError` / NUL byte / out-of-range integer → **400**; no Prisma text reaches a
client (`error-leak-prisma`).

---

## 3. Backup and restore round trips (EXECUTED 2026-10-22)

### 3.1 Method

`digilog_restore_perf` was dropped and reloaded from a `pg_dump -Fc` of the go-live copy
`digilog_day1_perf` (7.6 MB archive; 57 MB database: 35,326 audit rows, 1,558 cycles, 16,969 events,
3,061 filters, 309 users), then migrated to 15 (`reload-restore-perf.sh`). `roundtrip.mts` then runs,
per format, **through the app's own backup service** (`exportJson`/`exportCsv`/`exportDump` and
`restore`/`restoreDump`, as SUPER_ADMIN):

1. plant 10 notifications whose `message` and `metadata` hold formula-like text (`=HYPERLINK(…)`,
   `+1+1`, `-2`, `@SUM(A1)`, `\tTAB`, `\rCR`, `'=already quoted`, `''+two quotes`, `plain`, `'plain`) and
   an audit row whose `reason` starts with `=`;
2. snapshot every table (row count + md5 of every row), the structure checks below, and row-level copies
   of selected tables;
3. export;
4. write AFTER the export: a marker notification (must vanish) and an audit row (must survive —
   `preserveUnbackedAuditRows`);
5. restore; snapshot again; re-verify the whole chain with `verifyAuditChain()`.

Structure checks before and after: orphaned `asset_instances.parent_id`, `filters.ahu_id`,
`ahus.area_id`, `areas.block_id`, `filter_details`, `cleaning_cycles.filter_id`, `filter_events.cycle_id`,
event/cycle filter mismatch, `asset_identifiers.asset_id`, `pm_schedule_entries.schedule_id`,
`filter_details.current_cycle_id`; asset ↔ typed-table mirror per kind (BLOCK/AREA/AHU/FILTER);
`chain_position` count vs distinct count, max position vs the sequence's next value; `deviation_number_seq`
and `qnn_seq` vs the numbers in use.

### 3.2 Results

| | JSON | CSV | pg_dump (in-app) |
|---|---|---|---|
| File size | 58.4 MB | 8.8 MB (zip) | 9.6 MB |
| Export / restore time | 16.8 s / 62.4 s | 12.8 s / 78.1 s | 5.1 s / 31.2 s |
| Restore without `force` | success | **refused: `BACKUP_AUDIT_CHAIN_INVALID: 802 of 35327 audit rows do not match their stored checksum`** (D-DB-3) | success |
| `validate()` before restore | valid, checksum valid, chain 0 failures | "valid: true" with `auditChain.checksumFailures: 802` | valid (archive) |
| Restore with `force` | — | success; the `BACKUP_RESTORED` row records `forced: true` ("verification BYPASSED") | — |
| Formula-like text (10 values + audit reason) | exact | exact (the 08c2706 fix holds) | exact |
| Marker written after export | gone | gone | gone |
| Audit row written after export | kept (position 57,308), `auditRowsPreserved: 2` | kept | kept |
| Chain after restore | intact, 0 anomalies (35,330 rows) | intact (35,330 rows) | intact (35,341 rows) |
| Positions after restore | distinct = rows; next sequence value = max + 1 | same | same |
| Orphans / mirror mismatches (11 checks + 4 kinds) | 0 / 0 before and after | 0 / 0 | 0 / 0 |
| `deviation_number_seq`, `qnn_seq` | realigned to the data (0 deviations → 1; max QNN 258 → 259) | same | same |
| Table content vs before (all 61 tables) | 3 tables differ: **timestamps truncated µs → ms** (1,520 `filter_details.updated_at`, 1 `system_config.updated_at`, 1 `users.password_changed_at`) — D-DB-5. A second JSON round trip from that state: **0 differences** | 7 tables differ: the same µs → ms, **plus empty strings turned into NULL** (`users.department` ×7, `asset_templates.description` ×4, `checklist_questions.section`/`description` ×24, `notification_templates.description`, `roles.description` ×4) — D-DB-4 | **0 differences** |
| Logs | `rt4-json-pristine.json`, `rt2-json.json` | `rt5-csv-pristine.json`, `csv-why.log` | `rt2-dump.json` |

Why the CSV restore refuses its own file (`csv-why.mts`): every refused row has a **numeric username in
`user_id`** (e.g. `121215`). `escapeCsvValue` writes it as text; on read, `parseCsvContent` turns any
cell that is the canonical form of a number into a JS number (`backup.service.ts:110`), and
`verifyBackupAuditChain` hashes `userId: row.user_id` (`backup.repository.ts:448`) — `121215` (number)
is not `"121215"` (string), so the row's checksum no longer matches. Postgres casts the value back to
text on insert, so a forced restore produces an intact chain — but the operator is told the audit
history "cannot be proven intact" and must sign a bypass. On the go-live copy 817 of 35,341 rows are
affected; on a site whose usernames are numeric employee IDs it is essentially every row — and that is
the approved fresh-install default (`prisma/install-baseline.json`, `user-id` → `format: NUMBERS_ONLY`,
`length: 6`).

### 3.3 At production volume

| Fact | Evidence |
|---|---|
| In-app JSON export on the one-year copy → `BackupTooLargeError`: `audit_trail` 7,407,352 rows > per-table limit 500,000 (refused in 1.2 s, nothing written) | EXECUTED 2026-10-22 (`export-cap.mts`) |
| The same cap applies to BAK, SQL and CSV (all call `fetchAllTablesRaw`, `backup.repository.ts:345-357`) | code |
| Restore and validate uploads are capped at 100 MB (`backup/routes.ts:11, 133, 282`) | code |
| One-year custom-format dump = 1,589 MB; `pg_restore --jobs=4` 6.4 min; plain SQL dump 7,693 MB / 1.6 min, replay 10.4 min; row counts identical after both | CARRIED FORWARD 2026-10-17 (10 §2) |
| Restored one-year chain verified, last 100,001 positions intact | CARRIED FORWARD 2026-10-17 (10 §5) |

At the modelled ≈ 20,000 audit rows/day (02 §5, 10-17) the 500,000-row cap is reached on **day ≈ 25**;
at ≈ 4.4 MB/day of custom dump the 100 MB restore cap is reached on **day ≈ 23**. After that the
in-app Backup page can still download a `.dump`, but **no in-app path can restore a full backup**;
recovery needs `pg_restore` run by hand on the server — and the product ships no procedure or script for
that (`scripts/` has no restore script; `DEPLOY-WINDOWS.md` does not mention `pg_restore`). D-DB-6.

Not run here: the SQL in-app round trip (it has its own parser), and the HTTP layer of restore
(re-auth, multipart) — the route behaviour is covered by the e2e backup tests of 2026-10-21. The
nightly plain-SQL task is CARRIED FORWARD 2026-10-17. (BAK is covered by §3.4.)

### 3.4 Restore rules BR-100 and BR-101 (EXECUTED 2026-10-22, 17:40–17:44)

`02-requirements-traceability.md` had no runtime evidence for these two rules (its only test is the
quarantined `e2e/backup-restore-scratch.QUARANTINED.ts.txt`). `br100-101.mts` runs the app's own
`backup.service` (`exportJson` / `exportBak` / `exportDump`, `restore`, `restoreDump`, as SUPER_ADMIN)
in a **separate `tsx` process pointed at `digilog_restore_perf`**; vitest, and `DATABASE_URL` inside
vitest, were not involved. Two guards run before anything connects: the `*_perf` rule of `perf-env.ts`
and an exact-name check. Run against `digilog_day1_perf` it stops with *Refusing to run: database
"digilog_day1_perf" is not digilog_restore_perf.*; against `digilog_test_db` and `digilog_db` with
*… does not end in "_perf".* A second check asks the server for `current_database()` after
connecting. The database was first reloaded to the pristine go-live copy (`reload-restore-perf.sh`).

**BR-100 — a restore never destroys live audit rows the backup lacks** (`preserveUnbackedAuditRows`,
`backup.repository.ts:731`). For each format: take the backup; then write, AFTER it, three ordinary
audit rows, a `REAUTH_SUCCESS` signature and a row signed under it (`signature_audit_id` set through
the request store, as the re-auth gate does) — six rows counting the export's own `BACKUP_CREATED`;
also insert a notification (must be reverted); record each row's id, position, checksum,
previous_checksum and payload hash; restore; compare.

| Format | Backup size | Rows written after the backup | Present after restore | Identical (checksum, link, payload, action) | Positions | Marker notification | `BACKUP_RESTORED` row | Chain after | Sequence |
|---|---|---|---|---|---|---|---|---|---|
| JSON | 58.4 MB | 6 | 6 | 6 | 57,306–57,311, unchanged | reverted | position 57,312, `auditRowsPreserved: 6` | intact, 35,333 rows, 0 anomalies | last value 57,312 = max |
| BAK | 9.3 MB | 6 | 6 | 6 | 57,313–57,318, unchanged | reverted | 57,319, `auditRowsPreserved: 6` | intact, 35,340 rows | 57,319 = max |
| pg_dump | 9.6 MB | 6 | 6 | 6 | 57,320–57,325, unchanged | reverted | 57,326, `auditRowsPreserved: 6` | intact, 35,347 rows | 57,326 = max |

So the restored tables return to the backup, the audit rows the backup lacks come back unchanged and
still link (their positions were free, so none was renumbered), the restore's own `BACKUP_RESTORED` row
chains after them, and the next position the sequence hands out is free. **BR-100: PASS.**

**BR-101 — a failed .dump restore rolls back and leaves the database as it was.** Five more audit rows
were written first (live rows no backup holds). A valid in-app `.dump` (9.6 MB) was cut to its first
60 % — an interrupted transfer: header and table of contents intact, data section missing — and passed
to `restoreDump`. Compared before and after: every table's row count and content hash, the three
sequences, every schema, index, trigger and constraint, and `verifyAuditChain()`.

| Check | Result |
|---|---|
| Outcome | threw `RESTORE_FAILED`: *pg_restore … exited with code 1. pg_restore: error: could not read from input file: end of file The database was rolled back to its pre-restore state.* (12.5 s) |
| 61 tables (count + md5 of every row) | **0 changed** |
| `audit_trail_chain_position_seq`, `deviation_number_seq`, `qnn_seq` | identical (57,332 / 1 / 259) |
| Indexes, triggers, constraints of `public` | identical |
| The 5 live audit rows no backup had | all 5 present |
| `BACKUP_RESTORED` rows written | 0 (correct: nothing was restored) |
| Chain | intact before and after, 35,353 rows |
| Schemas | **one added: `digilog_keep`**, holding `audit_trail` — 35,353 rows, 19 MB (D-DB-10) |

**BR-101: PASS** for the database itself — the safety dump taken first (`backup.service.ts:741`) is
what puts it back after the public schema was emptied. The leftover is a defect of its own:
`DROP SCHEMA digilog_keep` runs only on the success path (`backup.service.ts:771`); the failure path
(`:772-795`) never drops it. What remains is a plain `CREATE TABLE AS` copy of the whole audit trail —
no immutability trigger, no chain over it — that every later `pg_dump` (in-app export and the nightly
task) carries until the next successful `.dump` restore drops it. At one year that copy is ~7.4 M rows
/ ~5 GB. Not measured: an application writing during the restore (rows written between the safety
dump and the rollback would not be in the safety dump).

**BR-100 with an archive that carries `digilog_keep` (EXECUTED 2026-10-22, 19:59–20:32, after the run
above) — D-DB-11.** Found by code reading (the agent writing the scripted restore for D-DB-6), then run
with `br100-keep-archive.mts` (same two guards, `digilog_restore_perf` only). `restoreDump` parked the
live trail in the fixed schema `digilog_keep` (`backup.service.ts:748-750` at `be6e0b3`) and then ran
`pg_restore --clean --if-exists` (`pg-tools.ts:314-315`), which drops every object the archive holds
before loading it. Method: put a stale `digilog_keep.audit_trail` in the database (what any dump taken
after a failed `.dump` restore carried, D-DB-10, or one taken during a restore); take the backup; drop
the stale schema; write 5 audit rows (6 with the export's `BACKUP_CREATED`); restore the archive.

| | Before the fix (`0b823f4`, in-app export) | After `eadcf9a` (archive made with the old pg_dump argv) | After, with a stale `digilog_keep` also left in the live database |
|---|---|---|---|
| Archive's TOC | `SCHEMA - digilog_keep`, `TABLE digilog_keep audit_trail`, `TABLE DATA …` | same three entries | same three entries |
| Outcome | "Database restored successfully" | success | success |
| Rows written after the backup, present / identical | **0 / 0 of 6** | 6 / 6 of 6 | 6 / 6 of 6 |
| `BACKUP_RESTORED.auditRowsPreserved` | **0** | 6 | 6 |
| Schemas after | `public` | `public` | `public` (was `digilog_keep`, `public`) |
| Chain after | intact — the rows were cut from the tail, so nothing reports the loss | intact | intact |

After the fix an in-app export taken while a park schema exists lists none in its TOC. BR-100 (JSON,
BAK, pg_dump) and BR-101 were re-run on a reloaded copy after `eadcf9a` (`br100-101-after-keepfix.json`):
6/6 late rows each, chain intact; BR-101 rolled back with 0 of 61 tables changed and no schema object
added.

---

## 4. Query health of the hot lists (EXECUTED 2026-10-22, report only)

### 4.1 Method and caveats

`hotpaths.mts` builds the real routes in-process (`buildApp` + filter-operations, events and
stage-approvals routes) against the **one-year copy `digilog_perf`** (7.4 M audit rows, 569 k cycles,
6.2 M events, 1.0 M stage approvals, 3,038 filters), logs in as `perf_user_296` (ADMIN), `perf_user_251`
(SUPERVISOR) and `perf_user_001` (OPERATOR), and sends each request twice ("cold", then "warm").
Prisma query events give every statement, its parameters and its DB time; the slowest were then run
with `EXPLAIN (ANALYZE, BUFFERS)` (`explain2.mts` inlines the parameters where bound-parameter EXPLAIN
failed on uuid/timestamp typing).

Caveats: the process is `tsx` (not the compiled build) with Prisma query events switched on, so wall
times are upper bounds; batch-states was re-timed with production-mode Prisma (below). "Cold" means the
OS cache had just been churned by the previous heavy query — `shared_buffers` is 128 MB against a 10 GB
database. The one-year copy carries **2,928 IN_PROGRESS cycles** (left by the 10-17 write and burst
tests); the go-live copy has 14.

### 4.2 Measurements

| Request (role) | Status | Wall ms cold / warm | Queries cold / warm | DB ms cold / warm | Bytes |
|---|---|---|---|---|---|
| `GET /api/filters/cycles?page=1&limit=25` (SUPERVISOR) | 200 | 862 / 315 | 18 / 10 | 758 / 253 | 30 KB |
| tablet Cycles view `limit=1000000&includeEvents=true&from=<30 d>` (OPERATOR) | **400 DATA_CONSTRAINT** | 149,009 / 143,395 | 11 / 14 | 118,711 / 108,675 | — |
| same, `from=<7 d>` (what-if) | 200 | 53,120 / 52,124 | 19 / 16 | 43,245 / 44,558 | 31 MB |
| `cycles?status=IN_PROGRESS&limit=1000000` (equipment groups page) | 200 | 38,594 / 6,407 | 18 / 14 | 37,096 / 4,592 | 3.5 MB |
| `GET /api/filters/events?page=1&limit=25` | 200 | 18,064 / 2,743 | 3 / 8 | 17,952 / 2,489 | 22 KB |
| `GET /api/filters/cleaning-record?page=1&limit=25` | 200 | 1,932 / 1,263 | 15 / 15 | 1,149 / 501 | 79 KB |
| `GET /api/audit?page=1&limit=20` (ADMIN) | 200 | **78,305** / 57 (count cached) | 6 / 8 | 78,226 / 9 | 13 KB |
| `GET /api/audit?limit=1` dashboard card (ADMIN) | 200 | 15 / 7 (count cache hit) | 1 / 1 | 0 / 0 | 0.6 KB |
| `GET /api/audit?search=LOGIN` (ADMIN) | 200 | **75,019** / 116 | 3 / 8 | 74,980 / 4 | 11 KB |
| `GET /api/filters/dashboard-stats` | 200 | 5,993 / 4,638 | 21 / 16 | 22,650 / 17,138 (parallel) | 2.5 KB |
| `GET /api/filters/batch-states` (OPERATOR) | 200 | 33,268 / 27,988 | **17,948 / 17,943** | 7,313 / 4,791 | 19 MB |
| `GET /api/stage-approvals` default window (SUPERVISOR) | 200 | 4,942 / 1,550 | 7 / 2 | 4,756 / 1,538 | 11 B (empty for this role) |

Warm counts in `psql` (`warm-counts.sql`): `audit_trail` with the non-SUPER_ADMIN visibility filter
5.5 s then **2.1 s** (10-17: 1.8–2.0 s); plain `count(*)` 2.8 s; `filter_events` count 1.5 s then
0.5 s; `cleaning_cycles` count 0.15 s.

### 4.3 What the plans show

- **P-1 batch-states — 17,934 queries per call on the one-year copy.** Grouped by statement
  (`batch-groups-year.json`): 2,928 × the current cycle's events, 2,928 × an event `COUNT`, and
  ~2,915 × each of four equipment-group reads (live group, instruments, pinned version, live version) —
  six queries per filter **that has an in-progress cycle** (`current-state.ts:388`, `:510`, `:526`,
  `:556`, `:645`, `:727`), none of them seeded by `batch-preload.ts:31`; plus one PM-entry read per AHU
  (`current-state.ts:297`, 154 queries). On the go-live copy (14 in-progress cycles) the same call is
  **280 queries** — the 10-17 fix holds for idle filters. With production-mode Prisma (still `tsx`, not the compiled build):
  go-live **1.4–2.7 s**, one year **6.3–7.7 s** per call, 11 MB / 19 MB. The 10-17 figure of 0.63 s was
  the compiled build over HTTP on the go-live copy; this harness is not the same, so treat the
  difference as unconfirmed and re-measure in deliverable 07. The cost grows with the number of filters
  in a cycle at the moment the tablet polls.
- **P-2 audit list count.** The page itself uses `audit_trail_timestamp_idx` (0.17 ms). The `COUNT` with
  the visibility filter is a **sequential scan of 7.4 M rows (458,827 buffers ≈ 3.5 GB): 28.8 s with a
  cold cache, 2.1 s warm**. Every new filter (search text, date range, sort) is a new cache key, so its
  first request pays it; `search` adds `ILIKE '%…%'` over five columns: **33.8 s** parallel seq scan.
  Open since 10-17 (11 §2); the 60 s count cache only helps repeats.
- **P-3 events list count.** `COUNT(*)` over all 6.2 M `filter_events` on every page load
  (index-only scan, 3.8 s in EXPLAIN, 18 s cold in the app, 0.5–2.7 s warm). The cycles list does the
  same over 569 k cycles (0.4 s).
- **P-4 tablet Cycles view (30 days) fails at one year — D-DB-9.** The 400 is not a size or memory
  failure; the server log names it: *"too many bind variables in prepared statement, expected maximum of
  32767, received 32770"* at `filter-operations.service.ts:535` (the performer-events lookup passes every
  cycle id of the page plus three filter parameters in ONE statement). The error handler answers this
  unmapped Prisma error as `400 DATA_CONSTRAINT`, so the tablet sees a client error for a server fault.
  Before failing, the request spends ~145 s: the other event lookups (cycle-id lists of 7,930 and 32,767)
  make the planner **sequential-scan all 6.2 M events (342,802 buffers)** instead of using
  `filter_events_cycle_id_idx` — EXPLAIN 1.9–3.1 s, but the app spends 43–73 s per batch transferring
  wide rows (`attributes` jsonb). Seven days works but takes 52 s for 31 MB. 10-17 recorded the volume
  ("30-day window = 48 k cycles / 504 k events") as open; the hard limit is new.
- **P-5 in-progress cycles list** (equipment groups page): the events lookup for 2,932 cycle ids takes a
  bitmap scan over `filter_events_filter_id_cycle_id_event_type_idx` reading 29,615 buffers: 6.1 s
  EXPLAIN, 36.8 s cold in the app, 4.6 s warm. Scales with in-progress cycles, like P-1.
- **P-6 dashboard-stats**: 21 whole-table aggregates fired in parallel (`GROUP BY cleaning_reason_label`
  parallel seq scan 0.8 s alone, `COUNT … completed_at >= ?` 0.2 s alone), 4.6–6.0 s wall because they
  compete for the 9-connection pool and the disk. Open since 10-17 (05 §3).
- **P-7 stage approvals (default window)**: parallel seq scan of 1.02 M rows, 0.6 s in EXPLAIN, 1.5–4.9 s
  in the app. Fine at go-live volume; no index serves its filter.

None of these is a missing-index bug in the narrow sense: P-2, P-3 and P-6 are whole-table aggregates
driven by page loads and polls; P-1 and P-5 are per-row reads that scale with in-progress cycles; P-4 is
an unbounded result whose failure is a defect (D-DB-9). The others are design decisions, listed for the next performance round (07).

---

## 5. Carried forward from 2026-10-17

| Item | Value | Evidence |
|---|---|---|
| Volume at one year | audit 7.4 M rows / 5.3 GB, events 6.2 M / 4.0 GB, approvals 1.0 M, cycles 566 k; whole DB 10.2 GB; ≈ 50 GB at 5 years (linear) | CARRIED FORWARD 2026-10-17 (05 §1); sizes re-read today: audit 5,282 MB, events 4,003 MB (EXECUTED 2026-10-22, `warm-counts.sql`) |
| Lock waits / idle-in-transaction | 0 in every sample | CARRIED FORWARD 2026-10-17 (05 §4) |
| Prisma pool | default 9 connections, no `connection_limit`; P2024/P2028 now answer 503 SERVICE_BUSY (`lib/error-handler.ts`) | CARRIED FORWARD 2026-10-17 + code |
| Postgres memory settings | still stock (128 MB `shared_buffers`); `pg_stat_statements` still not installed | EXECUTED 2026-10-22 (`pg_settings`) |
| Not done (then and now) | scale-5 data, vacuum/bloat soak | CARRIED FORWARD 2026-10-17 (05 §6) |

---

## 6. Defects

Severity is this report's assessment. Nothing was fixed during the run; the Fix column was added later
the same day. "Rerun" = the round trip or rule script of §3 run again on a reloaded `digilog_restore_perf`.

| ID | Sev. | Where (file:line) | Failure scenario | Fix status |
|---|---|---|---|---|
| **D-DB-1** | Medium | `scripts/verify-migrations.ps1:101` (compares through `prisma migrate diff` only); claim at `CLAUDE.md:120` | A migration that drops or rewrites `asset_instances_active_name_key` (e.g. loses `WHERE is_active`) or drops `audit_trail_no_delete` passes the release gate with "PASS: migrations reproduce the reference schema exactly." Reproduced for all three (§1.4). A fresh install would then lack the §11 delete guard or the duplicate-name guard with no warning. | Fixed `6098b5e` — the guard also compares a catalog fingerprint (index predicates, triggers, function bodies, CHECKs, sequences) and the migration-only objects; header note `d077b21`. |
| **D-DB-2** | Medium | `apps/api/src/modules/assets/services/identifier.service.ts:58` (check outside the transaction) → `:93`/`:120` (insert); `apps/api/prisma/schema.prisma:798-808` (no unique per asset) | Two assign requests for the same filter with different tags arriving together (two tablets, or a double submit) both succeed: the filter holds two RFID tags. 10/10 trials (§2.4). | Fixed `df5e6a1` (checks inside the assign transaction behind advisory locks) + `dfa6073` (RFID Track Record edit takes the same locks). |
| **D-DB-3** | High (CSV format unusable) | `apps/api/src/modules/backup/backup.service.ts:110` (numeric re-typing of every text cell) + `backup.repository.ts:448` (hashes `user_id` as parsed) | Restoring the app's own CSV backup is refused with `BACKUP_AUDIT_CHAIN_INVALID` whenever an audit row's username is numeric (802 of 35,327 rows on the go-live copy; nearly all rows where usernames are numeric employee IDs). The only way through is `force`, which records "audit-chain verification BYPASSED" for an intact chain. `validate()` reports `valid: true` with 802 chain failures for the same file. | Fixed `7cdd9c5` — cells typed by the live column type; `validate()` uses the same parse. Rerun: 0 checksum failures, restores without `force`. |
| **D-DB-4** | Medium | `backup.helpers.ts:113` (NULL and `''` both written as an empty cell) + `backup.service.ts:112` (empty cell → NULL) | A CSV restore turns every empty string into NULL (64 values in 40 rows of 5 tables on the go-live copy: role, asset-template, checklist-question and notification-template descriptions, checklist-question sections, user departments). A NOT NULL text column holding `''` would make the restore fail outright. | Fixed `7cdd9c5` — `""` is an empty string, an empty cell is NULL; older files read as before. Rerun at `7cdd9c5`: no empty-string differences left; the 3 tables still differing held only µs timestamps (D-DB-5) and reached 0 after `0b823f4`. |
| **D-DB-5** | Low | rows read as JS `Date` in `fetchAllTablesRaw` (`backup.repository.ts:345`) and written back | JSON and CSV restores truncate timestamps to milliseconds (1,522 values on the go-live copy). App-written values are already milliseconds and the audit chain is unaffected; raw-SQL / default `now()` values change. pg_dump is exact. | Fixed `0b823f4` — timestamps exported as ISO text, microseconds kept; millisecond values unchanged. Rerun: JSON and CSV 0 table differences. |
| **D-DB-6** | High (recovery) | `backup.repository.ts:232-237` (500,000 rows per table) and `backup/routes.ts:11,133,282` (100 MB upload) | About 3–4 weeks after go-live at the modelled volume, in-app JSON/CSV/BAK/SQL exports are refused (verified on the one-year copy: `audit_trail` 7,407,352 > 500,000) and an in-app `.dump` can be downloaded but not restored (1,589 MB at one year vs 100 MB). Restore then needs a hand-run `pg_restore` that is not in the product's procedures. | Open — a scripted `pg_restore` is in progress (`scripts/restore-database.ps1`, not committed); the in-app ceilings need the operator's call. |
| **D-DB-7** | Low (tooling) | `package.json:14` (`powershell -NoProfile -File`, no `-ExecutionPolicy Bypass`) | `npm run db:verify-migrations` stops at "running scripts is disabled on this system" on a default Windows execution policy; the drift guard only runs when invoked by hand with Bypass. | Fixed `7cdd9c5` — the npm script passes `-ExecutionPolicy Bypass`. |
| **D-DB-8** | Low (test infra) | `apps/api/src/e2e/audit-chain.test.ts:48` (`beforeAll`, default 10 s hook timeout) | In a multi-file run under load the hook times out: the file is reported as failed and none of its 6 chain tests run; alone they pass 6/6. | Fixed `7cdd9c5` — the file builds only the routes it uses (~0.2 s). Follow-up `e7312ca`: it asserts on its own rows (a concurrent writer made its row count read 5). |
| **D-DB-10** | Low–Medium | `apps/api/src/modules/backup/backup.service.ts:771` (keep schema dropped only on success; failure path `:772-795`) | After any failed `.dump` restore, schema `digilog_keep` stays with a full, mutable, unchained copy of `audit_trail` (35,353 rows here; ~5 GB at one year). Every later backup includes it; it disappears only at the next successful `.dump` restore. Reproduced with a truncated archive (§3.4). | Fixed `7cdd9c5` — the park is dropped on every exit except a failed rollback. Follow-up `eadcf9a` (D-DB-11). |
| **D-DB-9** | High (at volume) | `apps/api/src/modules/filter-operations/filter-operations.service.ts:535` (all page cycle ids + 3 parameters in one `IN`); answered as 400 by `lib/error-handler.ts` (unmapped Prisma error) | `GET /api/filters/cycles` fails whenever the requested page holds more than ~32,764 cycles: *"too many bind variables in prepared statement, expected maximum of 32767, received 32770"* → `400 DATA_CONSTRAINT` after ~145 s. The tablet's Cycles view asks for ALL cycles of the last 30 days (`mobile-wrapper.tsx:371`, `limit=1000000`), so at the modelled 1,500 cycles/day it breaks once 30 days hold > 32,764 cycles (≈ 22 days of production) and stays broken. Reproduced cold and warm on the one-year copy. | API fixed `928ea36` (any page size; a database-limit failure answers 500). Tablet paging: in progress. |
| **D-DB-11** | High | `apps/api/src/modules/backup/backup.service.ts:748-750` (park in the fixed schema `digilog_keep`) + `pg-tools.ts:314-315` (`--clean --if-exists`) | A `.dump` archive that carries a `digilog_keep` of its own (any dump taken after a failed `.dump` restore while D-DB-10 stood, or during a restore) drops the parked live trail and loads its stale copy: every audit row written after the backup is lost, the restore reports success, and the chain still verifies because the rows were cut from the tail. 0 of 6 rows survived (§3.4). Found after the run. | Fixed `eadcf9a` — park named per run, every park dropped after a successful restore, pg_dump leaves park schemas out. After: 6/6, BR-100/BR-101 re-run PASS. |

Performance findings P-1 … P-3 and P-5 … P-7 (§4.3) are reported, not filed as defects; P-4's failure is D-DB-9.

---

## 7. Evidence

All under `C:\Users\hello\AppData\Local\Temp\claude\C--Users-hello-21cfrlogbook-DigitalFMS\b0eb7933-5ac2-4a74-9db1-1b2a29e7de92\scratchpad\db05\`:

| File | What |
|---|---|
| `drift-dev.log`, `drift-test.log` | drift guard runs |
| `catalog.sql`, `fp-*.txt`, `fp-diff-*.txt`, `fn-*.sql` | schema fingerprints and function-body diffs |
| `drift-blindspots.log`, `fp-after-blindspot.txt` | §1.4 |
| `migrate-fresh.log`, `seed-fresh.log`, `seed-fresh-rerun.log`, `upgrade-*.log/txt` | §1.2, §1.5 |
| `integrity.mts`, `integrity.json`, `trigger-probes.log`, `tamper.log`, `constraints.sql`, `constraints*.log` | §2 |
| `vitest-integrity.log`, `vitest-audit-chain-alone.log` | §2.5 |
| `day1.dump`, `reload-restore-perf.sh`, `roundtrip.mts`, `summarize-rt.cjs`, `rt*.json`, `csv-why.mts`, `csv-why.log`, `export-cap.mts`, `export-cap.log` | §3 |
| `br100-101.mts`, `br100-101.json`, `br100-101.err`, `br101-truncated.dump` | §3.4 (BR-100, BR-101). `br100-101.json` now holds the last re-run (after `eadcf9a`, = `br100-101-after-keepfix.json`); the 17:40 figures are the ones in §3.4's tables. `br100-101-before-fix.json` / `-after-fix.json`: re-runs before and after `7cdd9c5` |
| `br100-keep-archive.mts`, `fail-br100-keep.json`, `pass-br100-keep.json`, `pass-br100-keep-livepark.json`, `br100-keep-*.dump` | §3.4 (D-DB-11) |
| `fail-DDB-*.log`, `pass-DDB-*.log`, `fix-rt-csv.json`, `fix5-rt-json.json`, `fix5-rt-csv.json`, `fail-keep-archive-unit.log`, `pass-keep-archive-unit.log` | the fixes in §6: failing test first, then passing, then the rerun |
| `hotpaths.mts`, `hotpaths.json`, `explain2.mts`, `explain2.json`, `batch-group*.mts`, `batch-*.json`, `warm-counts.sql` | §4 |

Databases left behind: `digilog_migrate_perf` (fresh build + seed + the probe rows, incl. the tampered
row 30 and the 10 two-tag filters) and `digilog_restore_perf` (go-live copy after the last BR-100 /
BR-101 re-run; it no longer holds a `digilog_keep` schema). Both are disposable; dropping them is the operator's call.
