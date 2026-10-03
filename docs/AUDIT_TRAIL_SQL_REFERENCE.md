# Audit Trail SQL Reference

As of 2026-10-03. Verified against branch `RFID` and the live `digilog_db` on that date.

## Read this first

Every row in `audit_trail` is sealed twice: a per-row checksum over its own fields, and a chain link to the previous row's checksum. Any change you make with SQL to a sealed field makes that row, and every row after it, fail the app's integrity check (`GET /api/audit/verify-chain`, and the red integrity badge on the Audit Trail page). Rows written since the keyed-chain cutover carry `checksum_version = 3`, an HMAC that needs the server's `AUDIT_CHAIN_KEY`; SQL alone cannot reproduce it. Postgres also refuses `DELETE` on this table through the trigger `audit_trail_no_delete`.

The commands below are safe to run on a local development machine, but understand what each one does to the chain before using it on any machine an inspector could see.

The application already has audited, chain-aware paths for the same jobs. Prefer them:

| Job | App path | What it does to the chain |
| --- | --- | --- |
| Create a record | Any normal action, or Config → Filter Data Management → Retirement / Replacement tab → Create | Writes a correctly chained row through `auditLog()` |
| Edit a record | Audit Trail tab → Edit (`PUT /api/audit/:id`, SUPER_ADMIN + re-auth + reason) | Writes an `AUDIT_RECORD_UPDATED` meta-row first; the edited row then fails verification (reported as `chainBroken: true`) |
| Hide a payload | Audit Trail page → Redact (`POST /api/audit/:id/redact`) | NULLs before/after values, stamps `redacted_at`; chain stays intact |
| Remove a record | Audit Trail page → Delete Permanently (`DELETE /api/audit/:id`, `POST /api/audit/bulk-delete`) | Writes an `AUDIT_RECORD_DELETED` meta-row, disables the trigger for one transaction, deletes; chain is broken from that point on, by design |

## The audit_trail table, column by column

23 columns. "Sealed" means the value is part of the row checksum: changing it by SQL makes the row fail verification. Live table on 2026-10-03: 20,462 rows, chain head at position 21,395, 3,160 rows keyed (`checksum_version = 3`), 18,061 older unkeyed rows.

| Column | Type | Who fills it | Sealed | Meaning |
| --- | --- | --- | --- | --- |
| `id` | uuid, PK | Postgres default `gen_random_uuid()` | no | Row identity; referenced by `signature_audit_id` of later rows and by `target_id` of meta-rows |
| `timestamp` | timestamptz | `auditLog()`; default `now()` | yes | When the event happened (back-dated manual records pass it explicitly) |
| `user_id` | varchar(100) | app, usually the username | yes | Who did it; NULL only for system jobs |
| `user_name` | varchar(100) | app | yes | Display name, often NULL |
| `user_role` | varchar(20) | app | yes | Role at the time (SUPER_ADMIN, OPERATOR, ...) |
| `action` | varchar(100), not null | app | yes | Catalog key such as `FILTER_RETIRED`, `LOGIN_SUCCESS`. Must exist in the audit-actions registry for the page to render a template |
| `target_type` | varchar(50) | app | yes | Kind of record touched (`asset_instance`, `user`, `system_config`, `audit_trail`) |
| `target_id` | varchar(255) | app | yes | Id of that record (free text, no FK) |
| `before_value` | jsonb | app | yes | State before the change |
| `after_value` | jsonb | app | yes | State after; the Retirement, Replacement and RFID history pages read their columns from here |
| `reason` | text | app | yes | Operator reason / remarks |
| `ip_address` | varchar(45) | app | yes | Client IP |
| `user_agent` | text | app | yes | Browser or tablet string |
| `session_id` | varchar(100) | app | yes | Login session the action ran in |
| `checksum` | varchar(64), not null | `auditLog()` | n/a | SHA-256 (old rows) or HMAC-SHA256 (keyed rows) over the sealed columns plus `previous_checksum` |
| `checksum_version` | smallint | `auditLog()` | no | `3` = keyed HMAC, NULL = legacy unkeyed. A `3` row can only be verified with the server key |
| `previous_checksum` | varchar(64) | `auditLog()` | yes | Checksum of the row with the next-lower `chain_position`; the chain link |
| `chain_position` | bigint | sequence `audit_trail_chain_position_seq` | no | Order of the chain; gaps are reported as anomalies |
| `signature_meaning` | varchar(255) | app | yes | 21 CFR 11.50 meaning text shown on signed rows |
| `redacted_at` | timestamptz | redact endpoint | no | Set when payload was masked; a redacted row verifies only if both payloads are NULL |
| `redacted_by` | varchar(100) | redact endpoint | no | User uuid of the redactor |
| `redaction_reason` | text | redact endpoint | no | Why it was masked |
| `signature_audit_id` | uuid | re-auth gate | yes, when present | The `REAUTH_SUCCESS` row that signed this action. Never set it on an old row: adding the key changes the hash |

Triggers and indexes: `audit_trail_no_delete` (BEFORE DELETE, raises), nine btree indexes on timestamp, user, action, target, session, chain position and signature link. There are no foreign keys in or out of this table; every link is by value.

## How the checksum and chain are computed

A new row is sealed in four steps inside one transaction (`apps/api/src/lib/audit.ts`, `writeAuditRow`):

1. Take a Postgres advisory lock so two writers cannot both link to the same predecessor.
2. Read the `checksum` of the row with the highest `chain_position`. That becomes this row's `previous_checksum`.
3. Build the canonical payload: the sealed columns as one JSON object, keys sorted at every depth, `undefined` written as `null`, `timestamp` as an ISO string, plus the key `previousChecksum`. `signatureAuditId` is added only when it is set.
4. Hash it. With `AUDIT_CHAIN_KEY` set in `apps/api/.env` the hash is `HMAC-SHA256(key, payload)` and `checksum_version = 3`. Without the key it is plain `SHA-256(payload)` and the version is NULL.

The field set, in the order the code lists it (sorting happens afterwards):

```
timestamp, userId, userName, userRole, action, targetType, targetId,
beforeValue, afterValue, reason, ipAddress, userAgent, sessionId,
signatureMeaning, [signatureAuditId], previousChecksum
```

The verifier (`apps/api/src/lib/hash-chain.ts`, `verifyAuditChecksum`) recomputes this and compares. For version-3 rows it insists on the key and never accepts the unkeyed formula. For older rows it also tries the original six-field formula and the old top-level-sort form, so history written before each change still verifies.

What this means for SQL work:

- You can compute a valid checksum for a **legacy-style** row (version NULL) in Node, because it is unkeyed. The app will accept it today.
- You cannot compute a valid **version-3** checksum without the key from `.env`. The Node helper in the next section reads the key from that file, so on a dev PC it works; on a customer machine you would not have it, and that is the point.
- `chain_position` must be the next value of the sequence and `previous_checksum` must equal the head row's checksum, or verify-chain reports a gap or a broken link.

## SQL: create a new record that verifies

A row inserted by SQL passes the integrity check only if its `checksum` was computed the way the server computes it. The helper below does that; it was checked against two real keyed rows (position 21,395 and a signed row from 2026-10-01) and reproduced both stored checksums exactly.

### Step 1: read the head of the chain

```sql
SELECT chain_position, checksum FROM audit_trail ORDER BY chain_position DESC LIMIT 1;
```

Keep the `checksum` value; it becomes the new row's `previous_checksum`. Do this with the API idle, or another write may take the head first and your link will be wrong.

### Step 2: describe the row in a JSON file

Save as `fields.json`. Keys you leave out hash as null. The timestamp must be an ISO string in UTC with millisecond precision, and you must insert exactly the same instant in step 4.

```json
{
  "timestamp": "2026-10-03T10:15:30.123Z",
  "userId": "superadmin",
  "userName": null,
  "userRole": "SUPER_ADMIN",
  "action": "FILTER_RETIRED",
  "targetType": "filter",
  "targetId": "217a97bd-625d-447f-bed6-cefa8ea111c9",
  "beforeValue": null,
  "afterValue": { "remarks": "Media torn", "filterName": "CWH/RDU/01-00" },
  "reason": null,
  "ipAddress": "127.0.0.1",
  "userAgent": null,
  "sessionId": null,
  "signatureMeaning": null
}
```

Rules the server enforces that SQL will not: `userId` is required unless the action is a system action; `action` should be a key in `packages/shared/src/types/audit-actions.ts` so the page can render it; `afterValue` keys are what the pages read (see the section on where columns show up).

### Step 3: compute the checksum

```
node audit-checksum.mjs fields.json <previous_checksum from step 1>
```

It prints `checksum`, `checksumVersion` (3 while `AUDIT_CHAIN_KEY` is set in `apps/api/.env`, NULL otherwise) and the exact timestamp string it hashed. The script is deliberately NOT kept in the repository (it can mint rows that pass verification); keep it outside the product tree:

```javascript
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
const ENV = '<repo>/apps/api/.env';
const key = (readFileSync(ENV, 'utf8').match(/^AUDIT_CHAIN_KEY=(.*)$/m)?.[1] ?? '').trim();
const [, , fieldsPath, prevArg] = process.argv;
const input = JSON.parse(readFileSync(fieldsPath, 'utf8'));
const previousChecksum = !prevArg || prevArg === 'null' ? null : prevArg;
function canonicalize(v) {
  if (v === null) return 'null';
  if (['number', 'boolean', 'string'].includes(typeof v)) return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonicalize(v[k])).join(',') + '}';
  return 'null';
}
const ts = new Date(input.timestamp).toISOString();
const fields = {
  timestamp: ts, userId: input.userId ?? undefined, userName: input.userName ?? undefined,
  userRole: input.userRole ?? undefined, action: input.action, targetType: input.targetType ?? undefined,
  targetId: input.targetId ?? undefined, beforeValue: input.beforeValue ?? undefined,
  afterValue: input.afterValue ?? undefined, reason: input.reason ?? undefined,
  ipAddress: input.ipAddress ?? undefined, userAgent: input.userAgent ?? undefined,
  sessionId: input.sessionId ?? undefined, signatureMeaning: input.signatureMeaning ?? undefined,
  ...(input.signatureAuditId ? { signatureAuditId: input.signatureAuditId } : {}),
  previousChecksum,
};
const payload = canonicalize(fields);
const checksum = key ? createHmac('sha256', key).update(payload).digest('hex')
                     : createHash('sha256').update(payload).digest('hex');
console.log(JSON.stringify({ checksum, checksumVersion: key ? 3 : null, timestampUsed: ts }, null, 2));
```

### Step 4: insert

```sql
BEGIN;
INSERT INTO audit_trail (
  "timestamp", user_id, user_name, user_role, action, target_type, target_id,
  before_value, after_value, reason, ip_address, user_agent, session_id,
  signature_meaning, checksum, previous_checksum, checksum_version, signature_audit_id
) VALUES (
  '2026-10-03T10:15:30.123Z',                        -- same instant as fields.json
  'superadmin', NULL, 'SUPER_ADMIN', 'FILTER_RETIRED', 'filter', '217a97bd-625d-447f-bed6-cefa8ea111c9',
  NULL, '{"remarks":"Media torn","filterName":"CWH/RDU/01-00"}'::jsonb, NULL, '127.0.0.1', NULL, NULL,
  NULL, '<checksum from step 3>', '<previous_checksum from step 1>', 3, NULL
) RETURNING id, chain_position;
COMMIT;
```

Leave `id` and `chain_position` to their defaults: `gen_random_uuid()` and the next value of `audit_trail_chain_position_seq`. Setting `chain_position` by hand is how gaps and duplicates are made.

### Step 5: check

`GET /api/audit/<new id>` must return `integrityValid: true`, and `GET /api/audit/verify-chain?fromPosition=<head position>` must list no new anomaly. Queries for the same checks are in the last section.

### Easier paths that need no key

- A real action in the app writes its own row.
- Config, then Filter Data Management, then the Retirement or Replacement tab, then Create: writes a chained `FILTER_RETIRED` or `FILTER_REPLACED` row with a back-dated timestamp, plus the `MANUAL_RECORD_CREATED` marker.
- Any TypeScript script can call `auditLog()` from `apps/api/src/lib/audit.ts`; it handles the lock, the link, the key and the version.

## SQL: modify an existing record

Postgres has no UPDATE trigger on this table, so every statement below succeeds silently. The damage shows up later, in `verify-chain` and in the integrity badge. Always run inside a transaction and look at the row first:

```sql
BEGIN;
SELECT chain_position, action, checksum_version, redacted_at FROM audit_trail WHERE id = '<row uuid>'::uuid;
-- ... your UPDATE ...
COMMIT;   -- or ROLLBACK
```

### Sealed columns (the row fails its own checksum; later rows keep passing)

A later row links to this row's *stored* checksum, which you did not touch, so only this one row is reported, as `PER_ROW_CHECKSUM_MISMATCH`.

```sql
-- who / when / what
UPDATE audit_trail SET "timestamp" = '2026-10-03 14:05:00+05:30' WHERE id = '<uuid>'::uuid;
UPDATE audit_trail SET user_id = '101012', user_name = NULL, user_role = 'OPERATOR' WHERE id = '<uuid>'::uuid;
UPDATE audit_trail SET action = 'FILTER_RETIRED' WHERE id = '<uuid>'::uuid;   -- must be a key in packages/shared/src/types/audit-actions.ts or the page shows the raw key
UPDATE audit_trail SET target_type = 'filter', target_id = '<filter uuid>' WHERE id = '<uuid>'::uuid;

-- payload: change one key, or replace the whole object
UPDATE audit_trail SET after_value = jsonb_set(after_value, '{remarks}', '"Torn media, replaced"') WHERE id = '<uuid>'::uuid;
UPDATE audit_trail SET after_value = '{"remarks":"Torn media","filterName":"CWH/RDU/01-00"}'::jsonb WHERE id = '<uuid>'::uuid;
UPDATE audit_trail SET before_value = NULL WHERE id = '<uuid>'::uuid;

-- the rest of the sealed set
UPDATE audit_trail SET reason = 'Correction of mis-keyed entry' WHERE id = '<uuid>'::uuid;
UPDATE audit_trail SET ip_address = '192.168.1.53', user_agent = 'DigiLog tablet', session_id = NULL WHERE id = '<uuid>'::uuid;
UPDATE audit_trail SET signature_meaning = 'Reviewed and approved' WHERE id = '<uuid>'::uuid;
```

### Re-sealing an edited row (do not, except on a throwaway database)

You can recompute the row's `checksum` with the helper above and write it back. The row then passes, but the *next* row's `previous_checksum` no longer matches, so the fault moves one position forward as `CHAIN_LINK_MISMATCH`. Making the whole table pass again means recomputing every later row; that is exactly the rewrite the chain exists to expose. The app's own edit endpoint refuses to touch these columns for that reason.

```sql
UPDATE audit_trail SET checksum = '<64 hex from helper>', checksum_version = 3 WHERE id = '<uuid>'::uuid;
```

Never set `checksum_version = NULL` on a row at or after `AUDIT_CHAIN_KEYED_FROM`: the walker reports `KEYED_ERA_DOWNGRADE`.

### Unsealed columns

```sql
-- id: not hashed, but meta-rows point at it through target_id and signed rows through signature_audit_id
UPDATE audit_trail SET id = gen_random_uuid() WHERE id = '<uuid>'::uuid;   -- avoid; breaks those references

-- chain_position: moving a row opens a gap (CHAIN_POSITION_GAP) and reorders the walk; never change it

-- redaction stamps: setting them by hand is the same as the Redact button, minus its meta-row
UPDATE audit_trail SET before_value = NULL, after_value = NULL,
       redacted_at = now(), redacted_by = '<your user uuid>', redaction_reason = 'Contains personal data'
 WHERE id = '<uuid>'::uuid;
-- undo a redaction: the row is then reported as tampered (a redacted row must have both payloads NULL)
UPDATE audit_trail SET redacted_at = NULL, redacted_by = NULL, redaction_reason = NULL WHERE id = '<uuid>'::uuid;
```

### What the app's Edit does that SQL does not

`PUT /api/audit/:id` writes an `AUDIT_RECORD_UPDATED` row first, in the same transaction, holding the old values and your reason, then applies the change. It refuses rows whose action is itself a meta-action and rows already redacted. If you edit by SQL, write that meta-row yourself with the create procedure above, or the change leaves no trace.

## SQL: delete or redact a record

A plain `DELETE` is refused:

```
ERROR:  audit_trail rows are immutable. Use the admin delete endpoint which temporarily disables this trigger under audit.
```

To delete anyway, do what `DELETE /api/audit/:id` does: disable the trigger for one transaction. `ALTER TABLE` takes an exclusive lock, so nothing else can slip a delete through while it is off.

```sql
BEGIN;
ALTER TABLE audit_trail DISABLE TRIGGER audit_trail_no_delete;
DELETE FROM audit_trail WHERE id = '<uuid>'::uuid;
-- or several: DELETE FROM audit_trail WHERE id = ANY('{<uuid>,<uuid>}'::uuid[]);
-- or by rule:  DELETE FROM audit_trail WHERE action = 'FILTER_REPLACED';
ALTER TABLE audit_trail ENABLE TRIGGER audit_trail_no_delete;
COMMIT;
```

Effect, permanent: the row after the hole reports `CHAIN_POSITION_GAP` and `CHAIN_LINK_MISMATCH`. Deleting the newest row still leaves a gap, because the sequence does not step back. The app never teaches the verifier to forgive this; it writes an `AUDIT_RECORD_DELETED` row first so the deletion itself is on record. SQL writes nothing, so add that row yourself (create section) if the deletion should be accountable.

This is the command that would empty the Replacement List and the RFID Track Record of the historic rows left behind by the 2026-10-03 hierarchy reset (138 `FILTER_REPLACED`, 460 `ASSET_IDENTIFIER_CREATED`, 297 `ASSET_IDENTIFIER_DELETED`). It has not been run.

### Redact instead (chain stays intact)

The Redact button runs this update and adds an `AUDIT_RECORD_REDACTED` meta-row:

```sql
UPDATE audit_trail
   SET before_value = NULL, after_value = NULL,
       redacted_at = now(), redacted_by = '<your user uuid>',
       redaction_reason = 'Reason, at least 5 characters'
 WHERE id = '<uuid>'::uuid AND redacted_at IS NULL;
```

The checksum and the link are untouched; the verifier accepts a redacted row as long as both payloads stay NULL. The page shows the row with a redacted badge and no details. There is no un-redact in the app, and restoring the payload by SQL makes the row fail verification.

## Where each column shows up in the application

Every reader below queries `audit_trail` directly. A change to a column changes what these places display.

| Place | Rows it reads | Columns it uses |
| --- | --- | --- |
| Audit Trail page (`/audit`, `GET /api/audit`) | All, minus the visibility rules below | List: `timestamp`, `action`, `user_name` or `user_id`, `user_role`, `target_type`, description, `ip_address`. Detail: `before_value`, `after_value`, `reason`, `signature_meaning`, `session_id`, `user_agent`, redaction stamps, and an integrity badge computed from `checksum` + `previous_checksum` + `checksum_version` + `redacted_at` |
| Description text on that page | Each row | `packages/shared/src/types/audit-templates.ts` picks a sentence by `action` and fills placeholders from `after_value` / `before_value`. An `action` not in the registry shows as the raw key |
| Config, Filter Data Management, Audit Trail tab | Same rows | Same columns; Edit sends `PUT /api/audit/:id` with `timestamp`, `user_name`, `user_role`, `action`, `target_type`, `target_id`, `signature_meaning`, `before_value`, `after_value` |
| Retirement List (`GET /api/filters/retirements`) | `FILTER_RETIRED` rows matched to retired filters by `target_id` | `after_value.remarks`, `user_name` or `user_id` as "retired by", `timestamp` |
| Replacement List (`GET /api/filters/replacements`) | Every `FILTER_REPLACED` row, no join | `after_value.oldFilterId`, `.oldFilterName`, `.newFilterId`, `.newFilterName`, `.remarks`; `user_name`; `timestamp`. Block and AHU columns come from the asset rows, so they read "—" when the filter is gone |
| RFID Track Record | `ASSET_IDENTIFIER_CREATED` (reads `after_value`) and `ASSET_IDENTIFIER_DELETED` (reads `before_value`) | `.identifierValue`, `.identifierType` (must be `RFID`), `.assetId`; `reason`; `user_id`, `user_name`; `timestamp` |
| Debug Traces (`/debug/traces`) | All, SUPER_ADMIN scoped | The whole row, rendered as a single-stage trace |
| Dashboard tile "Audit Trail" | Count only | none |
| Report downloads (`POST /api/audit/report-export-log`) | Writes a `REPORT_GENERATED` row per export | `after_value.reportType` and the export parameters |
| Electronic signatures | `REAUTH_SUCCESS` rows | `signature_audit_id` on the signed row points at the signature row's `id`; both are hashed |
| `GET /api/audit/verify-chain` | All, in `chain_position` order | `checksum`, `previous_checksum`, `chain_position`, `checksum_version`, `redacted_at`, plus every sealed column |
| Backup and restore | All | Backed up in JSON/BAK and pg_dump; the backup's own chain is verified; restore never deletes live rows the backup lacks |

### Who sees what

`apps/api/src/lib/audit-visibility.ts` applies two rules to every non-SUPER_ADMIN reader: rows whose `user_role` is `SUPER_ADMIN` are hidden, and rows whose `action` is `MANUAL_RECORD_CREATED`, `MANUAL_RECORD_UPDATED`, `MANUAL_RECORD_DELETED`, `AUDIT_RECORD_UPDATED`, `AUDIT_RECORD_DELETED`, `AUDIT_RECORDS_BULK_DELETED`, `AUDIT_RECORD_REDACTED`, `AUDIT_RECORDS_BULK_REDACTED` or `GRANT_OFFLINE_REPLAY` are hidden. So setting `user_role = 'SUPER_ADMIN'` on a row removes it from every operator's view, and setting one of those actions does the same.

## Verification queries to run after any change

The chain is **already not intact** on the dev machine, so compare counts before and after rather than expecting zero. Baseline from `GET /api/audit/verify-chain` on 2026-10-03, 21,223 rows walked, head position 21,397:

| Anomaly kind | Count | Meaning |
| --- | --- | --- |
| `CHAIN_POSITION_GAP` | 62 | Interior rows were deleted (earlier chain tests and hard-deletes) |
| `CHAIN_LINK_MISMATCH` | 44 | A row's `previous_checksum` is not the prior row's checksum |
| `PER_ROW_CHECKSUM_MISMATCH` | 17 | A row's fields no longer match its checksum (in-place edits) |
| `LEGACY_V1_KEY_ORDER` | 2,376 | Informational: pre-2026-05-30 rows whose JSON keys Postgres reordered; proven not tampered |
| `LEGACY_V1_KEY_ORDER_UNVERIFIABLE` | 931 | Informational: same era, payload too large to prove |

### Structure checks you can do in SQL

```sql
-- head of the chain
SELECT chain_position, checksum, checksum_version FROM audit_trail ORDER BY chain_position DESC LIMIT 1;

-- gaps in chain_position
SELECT prev_pos, chain_position
FROM (SELECT chain_position, lag(chain_position) OVER (ORDER BY chain_position) AS prev_pos FROM audit_trail) t
WHERE chain_position - prev_pos > 1;

-- broken links (previous_checksum does not equal the prior row's checksum)
SELECT chain_position
FROM (SELECT chain_position, previous_checksum, lag(checksum) OVER (ORDER BY chain_position) AS prev_sum FROM audit_trail) t
WHERE prev_sum IS NOT NULL AND previous_checksum IS DISTINCT FROM prev_sum;

-- keyed-era downgrade: replace 0 with the AUDIT_CHAIN_KEYED_FROM value from apps/api/.env
SELECT id, chain_position, checksum_version FROM audit_trail
WHERE chain_position >= 0 AND checksum_version IS DISTINCT FROM 3;

-- redacted rows that still carry a payload (always tampering)
SELECT id FROM audit_trail WHERE redacted_at IS NOT NULL AND (before_value IS NOT NULL OR after_value IS NOT NULL);

-- rows by checksum version
SELECT checksum_version, count(*) FROM audit_trail GROUP BY 1;

-- the no-delete trigger must read O (enabled), never D
SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'audit_trail'::regclass;
```

### Content checks that need the app or the helper

SQL cannot recompute a checksum, because the keyed formula lives in Node with the key. Use one of these:

```
# one row
curl -sk https://localhost:3000/api/audit/<id> -H "Authorization: Bearer <SUPER_ADMIN token>"   # look at integrityValid

# a range of the chain
curl -sk "https://localhost:3000/api/audit/verify-chain?fromPosition=21390" -H "Authorization: Bearer <token>"

# offline: rebuild a row's checksum from its current fields and compare with the stored one
node audit-checksum.mjs fields.json <that row's previous_checksum>
```

A login for the token, and the verify-chain call, each write their own audit rows, so the head position moves by two every time you check.

### Sources

`apps/api/prisma/schema.prisma` (model `AuditTrail`), `apps/api/src/lib/audit.ts`, `apps/api/src/lib/hash-chain.ts`, `apps/api/src/lib/audit-verify.ts`, `apps/api/src/lib/audit-visibility.ts`, `apps/api/src/modules/audit/routes.ts`, `apps/api/prisma/sql/invariants.sql`, live `digilog_db` on 2026-10-03.
