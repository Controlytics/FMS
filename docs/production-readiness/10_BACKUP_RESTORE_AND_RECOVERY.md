# 10 — Backup, Restore and Recovery

Measured 2026-10-17 on the dev PC (SSD) with the one-year clone `digilog_perf` (10,178 MB:
7,407,111 audit rows, 569,041 cycles, 6,233,900 filter events). Script:
`tests/performance/recovery/backup-restore-timing.ps1`. The client's server (SAS/SATA RAID5, per the
quote) may be slower on the restore side; these are the first real numbers the product has.

## 1. What the product does today

| Mechanism | What | Where | Retention |
|---|---|---|---|
| Nightly Windows Scheduled Task (`scripts/backup-db.ps1`, registered by the installer at 01:30) | `pg_dump` **plain SQL** of the app database | `<DataRoot>\backups\nightly-*.sql` — **the same disk as the database** | 14 days, prunes only its own files |
| In-app full backup (`backup.service.ts`, Config → Backup, "dump" format default since 2026-08-08) | `pg_dump -Fc` custom archive, audited | download / `<DataRoot>` | manual |
| In-app restore | `pg_restore --single-transaction --exit-on-error` after a safety dump; `preserveUnbackedAuditRows` keeps live audit rows the backup lacks | — | — |
| Uploads, certificates, `digilog.env` | **not** in the nightly dump | — | — |

There is **no off-box copy, no encryption at rest of the dumps, and no restore drill** in the product's
own procedures. RPO and RTO have **not been defined by the client** (12 G3).

## 2. Measured at one year of data

| Step | Time | Output |
|---|---|---|
| `pg_dump -Fc` (in-app full backup) | **247 s** (4.1 min) | 1,589 MB |
| `pg_restore --jobs=4` into an empty database | **383 s** (6.4 min) | 9,236 MB database |
| `pg_dump` plain SQL (the nightly task) | **96 s** (1.6 min) | 7,693 MB |
| `psql -f` replay of the plain dump | **625 s** (10.4 min) | — |
| Row counts after either restore | identical to the source (audit 7,407,111 / cycles 569,041 / events 6,233,900) | |

Linear projection to five years (≈ 50 GB): nightly dump ≈ 8 min and ≈ 38 GB per file (×14 days ≈
540 GB of retention on the data disk — **this will not fit a 1.5 TB RAID5 alongside the database for
long**; the custom format is 5× smaller); plain-SQL restore ≈ 50 min, custom-format restore ≈ 32 min.

## 3. RPO / RTO as they stand (not as the client needs them)

- **RPO today = up to 24 h** (one nightly dump). Anything recorded after 01:30 and before a disk loss is
  gone, including audit rows. If the client needs an RPO of minutes, the product has no mechanism yet
  (WAL archiving / `pg_basebackup` + continuous archiving, or streaming replication to a second box, are
  the standard answers — a decision for the client, not a code change here).
- **RTO today ≈ reinstall + restore**: the measured restore alone is 6–10 min at one year on an SSD, so
  realistically **30–60 min** including re-installing the product, restoring `digilog.env`, uploads and
  certificates (which the nightly backup does not include), and re-trusting the LAN certificate on
  tablets. Not rehearsed end to end — the installer's reinstall path was exercised on 2026-10-17 (FMS
  1.2.1), the restore-into-it was not.
- **Backups on the same disk as the database** mean a disk failure takes both. This is the single
  biggest recovery risk and needs no code: copy `<DataRoot>\backups` to another machine or share
  nightly.

## 4. Recommendations (for the client to decide)

1. Define RPO/RTO in writing; test the restore once on the production server before go-live and once
   per quarter (the `_perf` script above is the template; it refuses non-`_perf` targets by design, so
   the production drill needs a deliberate copy of it).
2. Switch the nightly to the custom format (`-Fc`, 5× smaller, parallel restore) or at least add
   compression; keep plain SQL only if someone needs to read it.
3. Copy backups off the box every night (a second share or machine); encrypt if they leave the site.
4. Include `digilog.env`, `certs\` and `uploads\` in the nightly set, or document that they are
   recreated by the installer.
5. If RPO < 24 h is required: WAL archiving to the off-box location (`archive_mode=on`,
   `archive_command`) — standard PostgreSQL, no application change.

## 5. Integrity after restore

The restored copy's audit chain was verified over its last 100,001 positions (7,329,090 → 7,429,090):
**0 anomalies, intact, 4.7 s** (`verify-perf-chain.ts --db-url …digilog_restore_perf`); the in-app
restore path additionally re-links live rows the backup lacks
(`preserveUnbackedAuditRows`, CHANGELOG 2026-09-25) — not exercised here because the in-app restore
needs the running app, and this test used `pg_restore` directly.
