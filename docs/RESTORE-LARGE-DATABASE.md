# Restoring the FMS database from a backup file (any size)

**For:** the person who looks after the FMS server. You do not need to know databases.
**Tool:** `restore-database.ps1` (in `C:\Program Files\DigiLog\scripts\`).
**Decision:** D-DB-6, 2026-10-22 (`test-results/05-database-testing.md` §3.3).

---

## 1. When to use this

Use it when you need to put the database back to the state of an earlier backup, and:

- the **Backup page in the app refuses the file** ("file too large" or "too many rows"). The app
  only restores files up to 100 MB, and a site reaches that about 3–4 weeks after go-live; or
- the **server was rebuilt** and the app has to start from last night's backup; or
- you are asked to restore a **pre-upgrade backup** after a failed upgrade.

For a small file that the Backup page accepts, you can still use the Backup page.

> **Restoring is a big step.** Everything entered after the backup was taken (cleaning
> cycles, PM records, filters, users, settings) is **lost**. The only thing that is kept is
> the **audit trail**: audit records written after the backup are carried over, so the
> history of who did what is never lost. Ask QA before you restore.

---

## 2. Before you start (checklist)

| | What | Why |
|---|---|---|
| ☐ | You can sign in to the server as a **Windows Administrator**. | The tool stops and starts the FMS service. |
| ☐ | You know **which backup file** to restore (see §3). | |
| ☐ | Users are told the app is **unavailable** for the time in §8, and they should sign out. | The app is stopped during the restore. Work entered then would be lost. |
| ☐ | **Tablets:** each tablet shows "Data Synced" (nothing waiting to send). | Work a tablet sends after the restore lands in the restored data. Cleaning steps for cycles that are not in the backup will be refused. |
| ☐ | Nobody has the database open in another program (pgAdmin), and it is **not 01:30** (the nightly backup runs then). | The tool refuses to start while other connections are open. |
| ☐ | **Rebuilt server only:** the old server's `C:\ProgramData\DigiLog\config\digilog.env` lines `AUDIT_CHAIN_KEY=` and `AUDIT_CHAIN_KEYED_FROM=` are copied into the new server's `digilog.env` **before** you restore, and the FMS service has been restarted. | These keys sign the audit trail. With the wrong key every restored audit record shows as "checksum mismatch". This is why install.ps1 says to keep a copy of digilog.env outside the server. |
| ☐ | The FMS program on the server is the **same version** as the one that made the backup, or newer. | An older program refuses a newer backup. A newer program can bring an older backup up to date (§7, `-ApplyMigrations`). |
| ☐ | **Rebuilt server only:** FMS is installed and starts (an empty database is enough). | The tool restores into the existing database; it cannot create one. |

You do **not** need to make a backup first. The tool takes a safety backup of the current
database before it changes anything.

---

## 3. Which backup file?

All backups are in **`C:\ProgramData\DigiLog\backups`**:

| File name | Made by | Notes |
|---|---|---|
| `nightly-<database>-<yyyyMMdd>-<HHmmss>.sql` | the nightly backup task (01:30) | The usual choice. Kept for 14 days. The date and time are in the name. `LAST-BACKUP-STATUS.txt` in the same folder says whether last night's backup worked. |
| `pre-upgrade-v<version>-<yyyyMMdd>-<HHmmss>.sql` | the installer, just before an upgrade | Use it after a failed upgrade, together with the previous program version. |
| `pre-restore-<database>-<yyyyMMddHHmmss>.dump` | this tool, just before a restore | Use it to **undo** a restore (§6). |
| a `.dump` file you downloaded from **Configuration → Backup** in the app | the app | Copy it to the server first. |

JSON / BAK / CSV / SQL files exported from the app's Backup page are **not** for this tool. The tool says so and stops.

---

## 4. Step by step

**Step 1. Start the tool.**

- **Start menu → FMS → "Restore database from backup"**, if your installation has that entry.
  Windows asks for Administrator permission. Click *Yes*.
- If there is no such entry: right-click **Windows PowerShell** → *Run as administrator*, and type:

  ```
  powershell -ExecutionPolicy Bypass -File "C:\Program Files\DigiLog\scripts\restore-database.ps1" -DumpFile "C:\ProgramData\DigiLog\backups\nightly-dfms-20261022-013000.sql"
  ```

  Use your own file name after `-DumpFile`.

**Step 2. Give the backup file.** The Start-menu window lists the backups, newest first. Type
the full path, or drag the file onto the window, then press **Enter**.

**Step 3. Wait for the checks [1/9] and [2/9].** The tool reads the whole backup file and
checks the current database and the free disk space. Nothing has changed yet, and the app is
still running. If the file is damaged or incomplete, the tool stops here: **"Nothing was
changed. Use another backup."**

**Step 4. Type your full name.** It is recorded in the audit trail, together with your Windows account.

**Step 5. Type `RESTORE`** (capital letters) and press Enter. Anything else cancels. Nothing is changed.
The tool then checks the current audit trail, so it can compare it with the restored one.
The app is still running during this check. It takes about 20 minutes per year of data (§8).

**Step 6. Wait. Do not close the window.** You will see the steps:

| Step | What happens | Changes anything? |
|---|---|---|
| [4/9] Stopping the application | The FMS service is stopped and set to *Disabled* while the restore runs. A restart of the PC then cannot start the app on half-finished data. | No data |
| [5/9] Safety backup | A copy of the current database: `backups\pre-restore-....dump` | No |
| [6/9] Loading the backup | The current data is moved to one side and the backup is loaded, **in one step**. If anything goes wrong, the database stays exactly as it was. | Yes, all or nothing |
| [7/9] Checking the restored data | Program version, row counts, and the audit records written after the backup are carried over. | Yes |
| [8/9] Verifying the restored audit trail | The audit trail's tamper-evidence chain is checked. A `BACKUP_RESTORED` record is written. | Yes |
| [9/9] Finishing | The old data that was moved aside is deleted (the safety backup keeps it). The service start type is put back and the app is started. | Yes |

If a check in [7/9] or [8/9] fails, the tool moves the old data back and says **"The database
is exactly as it was before the restore"**.

**Step 7. If you are asked to type `ACCEPT`.** This only happens when the restored audit trail
shows a problem that the current one did not have. The tool lists the problems first.

- **Do not type ACCEPT on your own.** Call QA. Typing anything else undoes the restore (nothing is lost).
- Typical harmless cause: the backup comes from a **different history**, so audit records
  carried over from the current database do not link to the backup's records. The window says
  so. This is **always** the case when you restore onto a **freshly installed** server. The few
  records the new installation wrote (first sign-in, password change) are kept, but they do
  not belong to the backup's chain.
- Typical serious cause: "checksum mismatch" on many records. The `AUDIT_CHAIN_KEY` in
  `digilog.env` is not the one that wrote the backup. See the checklist in §2. Do not accept. Fix the key first.
- If QA agrees, type `ACCEPT`. The audit trail records that the restore was accepted with
  those problems (`forced: true`).

**Step 8. "RESTORE COMPLETE".** Then:

1. Open FMS in the browser and sign in. Everyone has to sign in again.
2. **Audit Trail:** the newest record is *BACKUP_RESTORED*, with your name, the file, and how
   many audit records were carried over.
3. Look at a few recent records (cleaning cycles, PM): the newest ones should be from around
   the time the backup was taken.
4. Write the restore into your site's change log, with the safety-backup file name the tool printed.

---

## 5. If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| `REFUSED: ...` or `FAILED: ... Nothing was changed.` | The tool stopped before changing anything. The app was started again. | Read the message. Usually: a damaged file, wrong file type, too little disk space, or the database is open in another program. Fix that and run again. |
| `FAILED: ...` then `The database is exactly as it was before the restore` | A check failed after loading. The old data was put back and checked. | Read the first message, e.g. "backup comes from an OLDER program version". |
| `A previous restore did not finish` | The last run was interrupted (window closed, power cut). The app stays stopped and Disabled. | Run the tool once with **`-RollBackInterrupted`** (below). It puts the old data back and starts the app. Then start again. |
| `Moving the data back FAILED` | Very rare. **No data is lost.** The old data is still in the database, in a schema named `digilog_prerestore_<time>`. | Do not try anything else. Run `-RollBackInterrupted` once. If that also fails, send the logs (§9) to support. |
| `WARNING: the API did not report healthy` | The restore finished, but the app did not answer within 60 s. | Wait a minute, then open the app. If it still does not open, check `C:\ProgramData\DigiLog\logs\app\error`. |

Rolling back an interrupted restore (Administrator PowerShell):

```
powershell -ExecutionPolicy Bypass -File "C:\Program Files\DigiLog\scripts\restore-database.ps1" -RollBackInterrupted
```

---

## 6. Undoing a restore

The tool's last line names the safety backup, for example
`C:\ProgramData\DigiLog\backups\pre-restore-dfms-20261022193653.dump`. To go back to the
state before the restore, run the tool again **with that file**. The audit records written
in between are carried over as usual.

Safety backups are **not deleted automatically**. The nightly task only cleans up
`nightly-*.sql` files. Delete old `pre-restore-*.dump` files yourself once you are sure you
no longer need them.

---

## 7. Options

Add these after the command in §4.

| Option | Use it when |
|---|---|
| `-DumpFile "<path>"` | Always: the backup to restore. |
| `-PerformedBy "Full Name"` | To give your name on the command line instead of being asked. |
| `-ApplyMigrations` | The tool said **"backup comes from an OLDER program version"**. The restored data is brought up to this program's version, exactly as an upgrade does, before the app uses it. Recorded in the audit trail. |
| `-ChainCheck Tail` | To save time on a large database. The audit-trail chain is verified only for the records carried over, and where they join the backup, instead of the whole trail (see §8). Recorded in the audit trail. Run *Audit Trail → Verify chain* in the app afterwards, at a quiet time. |
| `-AcceptChainAnomalies` | Only when QA has already agreed to accept audit-chain problems (step 7) and you run the tool without being asked. Recorded as `forced: true`. |
| `-RollBackInterrupted` | After an interrupted run (§5). |
| `-SkipDiskSpaceCheck` | The tool's free-space estimate is too cautious and you have checked the disk yourself. |
| `-Force` | Do not ask for the RESTORE confirmation. Needs `-PerformedBy`. It never skips a safety check. |

---

## 8. How long it takes

Measured on the development PC (PostgreSQL 18, other work running at the same time) on 2026-10-22:

| Database | Backup file | Checks before the app stops (§4 steps 3–5) | App stopped (steps 6–8) |
|---|---|---|---|
| Go-live day 1 (35 k audit records, 60 MB) | 7 MB `.dump` / 35 MB `.sql` | under 1 min | about 1 min |
| One year (7.4 M audit records, 10 GB) | 1.6 GB `.dump` / 7.7 GB `.sql` | reading the file + about 22 min chain check | about 15 min safety backup + the load (see below) + about 22 min chain check |

Measured parts of the one-year row:
- The safety backup (`pg_dump`) of the 10 GB database took **14.7 minutes**.
- The chain check ran at **5,700 records per second** (200,000 records in 35 s). That gives
  about 22 minutes for 7.4 M records. This is extrapolated, not timed end to end.
- The load itself was not timed end to end by this tool. An earlier measurement (2026-10-17)
  replayed a 7.7 GB `.sql` in 10.4 minutes. Inside one transaction, expect at least that.

`-ChainCheck Tail` skips both full chain checks. At one year, plan for **about an hour of
downtime** with the default settings.

**Disk space:** the tool estimates what it needs and stops if the disk is too full. Roughly, the
database drive needs free space for **one more copy of the database**, and the backups folder
for a safety backup (about a quarter of the database size).

---

## 9. Logs

- `C:\ProgramData\DigiLog\logs\restore-database-<yyyyMMddHHmmss>.log`: everything one run did.
  It includes the row counts before and after for every table, and the output of the PostgreSQL tools.
- `C:\ProgramData\DigiLog\logs\restore-database.log`: one line per run (OK / FAIL / CANCELLED / ROLLED-BACK).
- `scripts\collect-logs.ps1` puts both into the support zip.

These files are **not** the 21 CFR Part 11 record. That is the *BACKUP_RESTORED* audit record in the database.

---

## 10. What a database restore does NOT bring back

- **Uploaded files** (photos and attachments in `C:\ProgramData\DigiLog\uploads`). They are not
  in the database backup. Files uploaded after the backup stay on disk. The nightly clean-up
  removes profile photos that no restored record refers to.
- **Settings outside the database**: `digilog.env`, certificates, `digilog-addresses.ini`.
- **The program version.** After a failed upgrade, reinstall the previous FMS version as well.

---

## 11. For support: how it works

- **No new database, no superuser.** The installed database role cannot create or rename
  databases, and the cluster superuser's password is generated at install and stored nowhere.
  So the tool restores **inside the existing database** as the app's own role (`DATABASE_URL`
  in `digilog.env`).
- **One transaction for the swap.** A single `psql --single-transaction` session:
  1. moves every non-extension object out of `public` into `digilog_prerestore_<stamp>`
     (`pg_temp.digilog_move_objects`). It refuses any object kind it cannot move, and then nothing changes;
  2. renames any other schema that the backup also contains (e.g. a leftover `digilog_keep`);
  3. streams the backup into the empty `public`. A `.dump` goes through `pg_restore -L <list> -f -`,
     a `.sql` through a byte-exact filter.

  The transaction can only commit when the stream finished cleanly, marked by a
  `digilog.stream_complete` setting that the helper sends last. A truncated stream
  therefore cannot commit half a database.

  Statements skipped from the backup, all logged:
  - `CREATE SCHEMA public` / `ALTER SCHEMA public OWNER` / `COMMENT ON SCHEMA public` (the schema already exists);
  - `COMMENT ON EXTENSION` (the extensions belong to the cluster superuser on an installed server).
- **The app's own code for the audit trail** (`scripts/restore-database-helper.mjs`, run with
  the bundled `node.exe` against `runtime\api\dist`):
  - `preserveUnbackedAuditRows` + `resyncSequencesAfterRestore`, exactly as the in-app
    `.dump` restore (BR-100, D1 2026-10-21). The sources are the moved-aside live trail, any
    moved-aside `audit_trail`, and a `digilog_keep.audit_trail` that came inside the backup
    (an interrupted in-app restore leaves one; it is dropped after its rows are carried over);
  - `verifyAuditChain`, in windows of 200,000 records that overlap by one;
  - `auditLog` for `BACKUP_RESTORED`. The actor is `windows:<DOMAIN\user>` and the name is
    the one typed. The `afterValue` holds the file, its SHA-256, the safety backup and its
    SHA-256, the rows carried over per source, migrations applied, and the chain-check result.
- **Gate before the old data is deleted.** The checks are:
  - program-version match (`_prisma_migrations` against the shipped migrations);
  - the core tables are not empty, and no table of this program is missing;
  - audit carry-over done;
  - no audit-chain anomaly that the pre-restore chain did not have (compared by record id
    and kind), unless accepted;
  - the `BACKUP_RESTORED` record links into the chain.

  On failure the objects are moved back in one transaction. Then a fingerprint shows the database
  is unchanged: per-table row counts, the audit-chain tip, and the schema list.
- **Interrupted runs** leave `backups\restore-in-progress.json` and schemas commented
  `digilog-restore-aside <stamp> of <schema>`. A new run refuses to start, and
  `-RollBackInterrupted` moves the data back.
- **Test mode** (development PC only): `-TestDatabaseUrl postgresql://...<name>_perf`
  `-TestWorkDir <dir>`. It refuses any database whose name does not end in `_perf`, does not
  touch services, and runs the helper on `apps/api/src` through tsx. `-TestFailAfter
  load|carry-over|verify|crash-after-load` injects failures.
