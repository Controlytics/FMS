# Perf data generation (digilog_perf only)

`seed-perf-db.ts` fills the disposable `digilog_perf` clone with production-volume
synthetic history. Every record goes through the same tables, triggers and audit
chain as the app writes them.

```bash
cd apps/api
# smoke first (about 7 days of history)
npx tsx ../../tests/performance/data-generation/seed-perf-db.ts --scale 0.02 --users 300 --verify
# one year of production volume (resumes after the smoke days)
npx tsx ../../tests/performance/data-generation/seed-perf-db.ts --scale 1 --users 300 --verify
# whole-chain verification + sanity report
npx tsx ../../tests/performance/data-generation/verify-perf-chain.ts
npx tsx ../../tests/performance/data-generation/check-perf-db.ts
```

Run the commands from `apps/api`, so that `@prisma/client`, bcrypt and the app's
`.env` resolve. `package.json` in this folder only marks the scripts as ESM, because
they use top-level `await`.

## Safety

- **Target:** `--db-url`, then `PERF_DATABASE_URL`, then
  `postgresql://digilog:digilog123@localhost:5432/digilog_perf`. The scripts throw
  **before connecting** unless the database name ends in `_perf`. After connecting,
  they check `current_database()` again.
- `perf-env.ts` pins `DATABASE_URL` first and loads `apps/api/.env` after it.
  dotenv never overrides a variable that is already set, so `.env` contributes only
  `AUDIT_CHAIN_KEY`, `AUDIT_CHAIN_KEYED_FROM` and `BCRYPT_ROUNDS`. If the chain key
  is missing, the scripts refuse to run, because unkeyed rows would be flagged
  `KEYED_ERA_DOWNGRADE`.
- The scripts never run migrate, db push or reset, and never change schema or
  application source.
- `--scale` only lengthens the history; it never runs past today. The plant size is
  the same at every scale.

## What is generated

At `--scale 1` the defaults below model one year. Override them with `--cycles-per-day`,
`--blocks`, `--ahus` and `--filters`.

| Item | Default | Notes |
|---|---|---|
| Users | `perf_user_001..300` | Roles: OPERATOR 219, SHIFTOFFICER 30, SUPERVISOR 21, QA 15, MANAGER 10, ADMIN 5. Users are spread over the blocks (`department` = block). Password `PerfTest@2026!`, hashed once with the app's `lib/password.ts` (bcrypt). `force_password_change=false`, `is_temporary_password=false`, `password_changed_at=now`, expiry set by the live policy (360 d), plus a `password_history` row. The credential list is written to `tests/performance/results/perf-users.json` (gitignored). |
| Hierarchy | 5 blocks, 6 areas, 150 AHUs, 3,000 filters | Names `PF-B1`, `PF-B1/AR-1`, `PF-B1/AHU-01`, `PF-B1/AHU-01/01-00`. Areas are optional: blocks 1–3 have two areas each, and blocks 4–5 hold their AHUs directly. Blocks, areas and AHUs are inserted into `asset_instances` one level at a time, and the mirror trigger fills `blocks`/`areas`/`ahus`. Each one gets its CONTAINS/CONTAINED_IN pair, as `instance.service.create` does. Filters are inserted into the typed `filters` table, as `filter.service.create` does, and the reverse-mirror trigger creates the `asset_instances` row under the AHU. Each filter also gets a `filter_details` row (SET_A/SET_B) and a primary RFID tag. |
| Filter approval | APPROVED | The clone has the filter approval workflow enabled. Each filter therefore carries submitted (SUPERVISOR), reviewed (MANAGER) and approved (QA) attribution, with ASSET_CREATED, FILTER_REVIEWED, FILTER_APPROVED and ASSET_IDENTIFIER_CREATED audit rows. |
| Equipment | 1 group per block | Three instruments: compressed air and RO water at WASH_IN, dryer temperature at DRY_IN. Readings reference the real instrument ids. |
| Cleaning profiles | Existing ACTIVE ones | The generator walks each pipeline from START to END. Profiles that begin with DRY_IN are skipped, because they need a dryer duration at start. The longest pipeline (`CWH/RDU`: Wash, Dry, Storage, then the DRY checklist) runs on 4 of every 5 AHUs; `CWH/RDU/02` (Wash, Storage) runs on the rest. BY_AHU rules are appended to `cleaning-profile-assignment` (CONFIG_CHANGED audited), so the app resolves the same profile the history used. |
| Cleanings | about 1,500 a day | A rotating slice of the filters is cleaned each day, so each filter is cleaned every second day. Starts are spread over 06:00–20:30 local time; each cycle takes about 40–90 minutes. All cycles are COMPLETED. Each cycle holds 12 events (full profile) or 7 events (short profile), with exactly the shapes, remarks, checksums (`helpers.computeChecksum`) and audit rows of a real tablet cycle. DRY_IN emits two transitions: dryer start, then the readings with `fromState` null. The stage interlock is enabled in the clone, so WASH_OUT and DRY_OUT each get a `cleaning_stage_approvals` row decided by a SHIFTOFFICER of the same block. That decision adds an APPROVAL_GRANTED event, a REAUTH_SUCCESS row and a STAGE_APPROVAL_APPROVED row linked by `signature_audit_id`. A terminal checklist adds CHECKLIST_COMPLETED, with a pinned live version and a question snapshot. After each day, `filter_details` and `lastCleaningDate` match the last cycle. |
| Logins | 1 session per active user per day | LOGIN_SUCCESS and LOGOUT audit rows only. No `sessions` rows are created. |
| PM | About 13 irregular visits per AHU over the year | Gaps of 26–34 days and tolerance ±3 days, so windows never overlap (`pm-separation` rule). Entries are APPROVED through review and approval, with PM_SCHEDULE_IMPORTED, REVIEWED and APPROVED audit rows. On a visit day every filter of the AHU is cleaned with reason PM, always before `windowEnd` (stored as UTC midnight). |
| Deviations | About 4% of visits | A missed visit gets a deviation opened at 03:00 the day after its window closes, as the cron sweep does: system actor, DEVIATION_OPENED. The next PM cleaning writes the visit off, as `applyPmSkips` does: `skipped_*` columns, deviation CLOSED/SKIPPED, PM_TASK_SKIPPED. |
| Not generated | — | Notifications, `sessions`, quality notifications, terminations, bypasses and replacements. |

### Volume at scale 1

About 550k cycles, 6M filter events and 7M audit rows. The audit count is higher
than the event count because of the two e-signatures per full cycle and the logins.
See the run report for exact counts and the database size.

## Audit chain correctness

- Rows are written in batches, with one transaction per simulated day. The
  checksum is the app's `computeChainedChecksumV3` (`lib/hash-chain.ts`), computed
  over exactly the field set `lib/audit.ts` hashes. Each batch takes the app's
  advisory lock (`pg_advisory_xact_lock(7421151037)`), reads the head inside the
  lock and takes `chain_position` values from the table's own sequence, in order.
  Every row is checked in memory with the app's `verifyAuditChecksum` before it is
  inserted. Values that would fail the INSERT are rejected before `nextval()`, so a
  rollback cannot leave a position gap.
- The 300 USER_CREATED rows are written through the real `auditLog()`. Live API
  writes, such as logins during the run, interleave on the same chain.
  Verification therefore covers app-written rows, batch-written rows and the links
  between them.
- History is back-dated evenly across the period. The chain is ordered by
  `chain_position`, not by time, so back-dated rows are chain-safe. This is
  documented in `audit.ts`.
- `verify-perf-chain.ts` runs the app's `verifyAuditChain` in row windows that
  overlap by one row. A single call loads the whole table, which does not fit at
  this volume. Each window treats its first row as a genesis, so the overlap row
  re-checks the link into the next window.

**Known app defect (found here, not fixed: application source is off-limits).**
`verifyAuditChain`'s SELECT does not fetch `signature_audit_id`, but `auditLog`
hashes that column whenever it is set. As a result, every signed row, such as
STAGE_APPROVAL_APPROVED written under a re-auth, is reported as
`PER_ROW_CHECKSUM_MISMATCH`. This includes the 138 real app-written signed rows
already in the clone. `verify-perf-chain.ts` re-checks each such row with the
app's `verifyAuditChecksum`, with the column filled in. It reports these rows
separately as `signedRowFalsePositives`, and anything that still fails stays a
real anomaly. Do **not** call `GET /api/audit/verify-chain` on the perf API at
this volume: it loads the whole table into one process.

## Resuming and starting over

- Runs are resumable. Each day is one transaction, and a re-run continues after
  the last committed synthetic day, read from the database. Setup steps are
  idempotent by name. The timeline anchor is fixed by the first run: today − 365 d,
  or `--start-date`. Later runs derive it from `PF-B1.created_at`.
- `--max-days N` caps the number of days generated in one run.
- PM entries are inserted only once their history is generated, or while their
  window has not closed yet. A past entry left with no PM cleaning is repaired as
  a missed PM on the next generated day, so no false overdue task is left behind.
  Otherwise the perf API's 03:00 sweep would open deviations for it, and PM starts
  would get 409 `PM_PREVIOUS_TASK_PENDING`.
- Generate history **before** load-testing. The generator refuses to run if a
  synthetic filter has a live IN_PROGRESS cycle.
- **Rows cannot be deleted from `audit_trail`**: a no-delete trigger blocks it, and
  a hard delete would break the chain. To start over, re-clone the database:

  ```bash
  powershell -File tests\performance\stop-perf-api.ps1     # the perf API holds connections to digilog_perf
  # stop the dev API too: createdb -T fails while anything is connected to digilog_db
  dropdb -U digilog digilog_perf
  createdb -U digilog -T digilog_db digilog_perf
  powershell -File tests\performance\start-perf-api.ps1 -NoBuild
  ```

## Caveats

- `perf_user_NNN` does not match the clone's `user-id` rule (NUMBERS_ONLY, length 6).
  That rule is enforced only when a user is created through the API; login does
  not check it. The names were requested explicitly.
- Approver session ids in audit rows have no matching `sessions` row. Sessions
  are not generated.
- Uploads, reviews and approvals of PM entries added in later runs are back-dated
  to the same upload day. Their `chain_position` is therefore later than rows with
  newer timestamps. This is valid, but it is not chronological.
