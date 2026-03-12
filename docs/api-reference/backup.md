# Backup & Restore API

The Backup API provides endpoints for exporting, validating, and restoring the DigiLog database. All operations require ADMIN+ role and re-authentication.

---

## Export Backup

### GET /api/backup/export

Generate and download a full database backup.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `format` | string | `json` | Export format: `json`, `bak`, `sql`, `csv` |

**Formats:**

| Format | Extension | Description | Restorable via App |
|--------|-----------|-------------|-------------------|
| **JSON** | `.json` | Full backup with SHA-256 checksum verification | Yes |
| **BAK** | `.bak` | Gzip-compressed JSON (~7x smaller) | Yes |
| **SQL** | `.sql` | PostgreSQL INSERT statements | Yes |
| **CSV** | `.zip` | ZIP archive of per-table CSV files + metadata | Yes |

```bash
# Export as JSON
curl -o backup.json "http://your-server/api/backup/export?format=json" \
  -H "Authorization: Bearer TOKEN" \
  -H "x-reauth-password: YOUR_PASSWORD"

# Export as BAK (smallest file)
curl -o backup.bak "http://your-server/api/backup/export?format=bak" \
  -H "Authorization: Bearer TOKEN" \
  -H "x-reauth-password: YOUR_PASSWORD"

# Export as SQL
curl -o backup.sql "http://your-server/api/backup/export?format=sql" \
  -H "Authorization: Bearer TOKEN" \
  -H "x-reauth-password: YOUR_PASSWORD"

# Export as CSV (ZIP)
curl -o backup.zip "http://your-server/api/backup/export?format=csv" \
  -H "Authorization: Bearer TOKEN" \
  -H "x-reauth-password: YOUR_PASSWORD"
```

**Included Tables (11):**
roles, users, system_config, audit_trail, notifications, password_history, sessions, field_id_config, user_configs, role_configs, password_reset_requests

---

## Validate Backup

### POST /api/backup/validate

Upload a backup file to validate its structure and integrity without restoring.

Accepts: `.json`, `.bak`, `.sql`, `.zip` (CSV)

```bash
curl -X POST "http://your-server/api/backup/validate" \
  -H "Authorization: Bearer TOKEN" \
  -F "file=@backup.json"
```

**Response (200):**
```json
{
  "valid": true,
  "metadata": {
    "version": "1.0.0",
    "timestamp": "2026-03-12T08:00:00.000Z",
    "generatedBy": "superadmin",
    "tableCount": 11,
    "checksum": "abc123...",
    "format": "json"
  },
  "tableSummary": {
    "users": 5,
    "roles": 7,
    "systemConfig": 15,
    "auditTrail": 2000,
    "notifications": 50
  },
  "checksumValid": true,
  "totalRecords": 2565
}
```

**Validation by format:**
- **JSON/BAK**: SHA-256 checksum verified against stored checksum
- **SQL**: Parsed and structure validated (no checksum - regenerated on import)
- **CSV/ZIP**: ZIP structure, CSV headers, and metadata validated (no checksum - regenerated on import)

---

## Restore from Backup

### POST /api/backup/restore

Upload a backup file to restore the entire database. Requires re-authentication.

Accepts all 4 formats: `.json`, `.bak`, `.sql`, `.zip` (CSV)

```bash
curl -X POST "http://your-server/api/backup/restore" \
  -H "Authorization: Bearer TOKEN" \
  -H "x-reauth-password: YOUR_PASSWORD" \
  -F "file=@backup.json"
```

**Response (200):**
```json
{
  "success": true,
  "message": "Database restored successfully",
  "backupTimestamp": "2026-03-12T08:00:00.000Z",
  "backupVersion": "1.0.0"
}
```

**Restore process:**
1. File format auto-detected (ZIP magic bytes, gzip magic bytes, SQL header, or JSON)
2. Parsed into internal format with table data
3. Checksum verified (JSON/BAK only)
4. Audit trail immutability triggers temporarily disabled
5. All tables truncated in FK-safe order
6. Data inserted in dependency order
7. Audit trail triggers re-enabled
8. Auto-increment sequences reset
9. Restore logged in audit trail

**Error codes:**
| Code | Description |
|------|-------------|
| `INVALID_BAK` | Failed to decompress .bak file |
| `INVALID_JSON` | File is not valid JSON |
| `INVALID_BACKUP` | Missing metadata or data sections |
| `INVALID_METADATA` | Incomplete metadata |
| `CHECKSUM_MISMATCH` | File integrity check failed (JSON/BAK only) |

> **Warning:** Restore replaces ALL existing data. Active sessions are terminated. Create a backup before restoring.

---


### Known Fixes (2026-03-12)

- **SQL/CSV restore column mapping**: SQL and CSV formats use raw PostgreSQL column names (snake_case). The restore process now includes a comprehensive column-name-to-Prisma-field mapping (50+ columns) via `convertDbColumnsToPrisma()` to ensure correct field names during `createMany()` operations.
- **CSV numeric string coercion**: CSV parser auto-converts numeric strings (e.g., username "123456") to integers. The restore now coerces known string fields back to strings using a `STRING_FIELDS` set.

## Format Details

### JSON Format
```json
{
  "metadata": {
    "version": "1.0.0",
    "timestamp": "2026-03-12T08:00:00Z",
    "generatedBy": "superadmin",
    "tableCount": 11,
    "checksum": "sha256-hash",
    "format": "json"
  },
  "data": {
    "users": [...],
    "roles": [...],
    "systemConfig": [...]
  }
}
```

### BAK Format
Same as JSON but gzip-compressed. ~7x smaller file size.

### SQL Format
```sql
-- DigiLog Database Backup
-- Generated: 2026-03-12T08:00:00Z
-- Generated By: superadmin
BEGIN;
TRUNCATE TABLE "roles" CASCADE;
INSERT INTO "roles" ("id", "name", ...) VALUES ('uuid', 'ADMIN', ...);
COMMIT;
```

### CSV Format (ZIP)
```
backup.zip/
  _metadata.json     # Backup metadata
  roles.csv          # One CSV per table
  users.csv
  system_config.csv
  ...
```

---

## Next Steps

- [System Configuration](configuration.md) — Configuration management
- [Audit Trail API](audit.md) — Audit log queries
