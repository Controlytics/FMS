# Backup & Restore API

The Backup API provides endpoints for exporting, validating, and restoring database backups. Backups include SHA-256 checksums for integrity verification, meeting 21 CFR Part 11 requirements for data protection.

---

## Export

### GET /api/backup/export

Generate and download a full database backup.

```bash
curl "http://your-server/api/backup/export?format=json" \
  -H "Authorization: Bearer USER_TOKEN" \
  -o backup.json
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `format` | string | `json` (default), `bak`, `sql`, or `csv` |

**Formats:**

| Format | Content-Type | Description |
|--------|-------------|-------------|
| `json` | application/json | Full JSON backup with all tables, metadata, and SHA-256 checksum. Restorable. |
| `bak` | application/octet-stream | Gzip-compressed JSON (~7x smaller). Restorable. Includes checksum. |
| `sql` | application/sql | PostgreSQL INSERT statements. Not directly restorable via API. |
| `csv` | application/zip | ZIP archive of per-table CSV files. Not directly restorable via API. |

**JSON/BAK backup structure:**
```json
{
  "metadata": {
    "version": "1.0.0",
    "timestamp": "2026-03-01T08:00:00Z",
    "exportedBy": "admin",
    "tables": ["users", "asset_templates", "asset_instances", "..."]
  },
  "data": {
    "users": [...],
    "asset_templates": [...],
    "asset_instances": [...]
  },
  "checksum": "sha256:abc123..."
}
```

> **Note:** Exporting a backup requires **re-authentication**.

**Permission:** `CONFIG_UPDATE`

---

## Validate

### POST /api/backup/validate

Upload a backup file to validate its structure and checksum without restoring.

```bash
curl -X POST "http://your-server/api/backup/validate" \
  -H "Authorization: Bearer USER_TOKEN" \
  -F "file=@backup.json"
```

**Response (200):**
```json
{
  "valid": true,
  "metadata": {
    "version": "1.0.0",
    "timestamp": "2026-03-01T08:00:00Z",
    "exportedBy": "admin"
  },
  "tableSummary": {
    "users": 15,
    "asset_templates": 5,
    "asset_instances": 42
  },
  "checksumValid": true,
  "totalRecords": 235
}
```

**Error responses:**

| Code | Error | Description |
|------|-------|-------------|
| 400 | `INVALID_BAK` | BAK file cannot be decompressed |
| 400 | `INVALID_JSON` | JSON cannot be parsed |
| 400 | `INVALID_BACKUP` | Missing required backup structure |

**Permission:** `CONFIG_UPDATE`

---

## Restore

### POST /api/backup/restore

Upload a JSON or BAK backup file to restore the database.

```bash
curl -X POST "http://your-server/api/backup/restore" \
  -H "Authorization: Bearer USER_TOKEN" \
  -F "file=@backup.bak"
```

**Response (200):**
```json
{
  "success": true,
  "message": "Database restored successfully",
  "backupTimestamp": "2026-03-01T08:00:00Z",
  "backupVersion": "1.0.0"
}
```

**Restore process:**
1. Validates file format (JSON or BAK decompression)
2. Verifies SHA-256 checksum integrity
3. Temporarily disables audit trail immutability triggers
4. Clears existing data in dependency order
5. Restores all tables from the backup
6. Re-enables audit trail triggers

**Error responses:**

| Code | Error | Description |
|------|-------|-------------|
| 400 | `NO_FILE` | No file uploaded |
| 400 | `INVALID_BAK` | Cannot decompress BAK file |
| 400 | `INVALID_JSON` | Cannot parse JSON |
| 400 | `INVALID_BACKUP` | Missing backup structure |
| 400 | `INVALID_METADATA` | Missing or invalid metadata |
| 400 | `CHECKSUM_MISMATCH` | Checksum verification failed — file may be corrupted |
| 500 | `RESTORE_FAILED` | Database restore failed |

> **Warning:** Restoring a backup replaces **all existing data**. This operation is irreversible. Always validate the backup file first.

> **Note:** Restoring a backup requires **re-authentication**.

**Permission:** `CONFIG_UPDATE`

---

## File Size Limit

Backup upload limit: **100 MB** (enforced by Fastify multipart).

---

## Next Steps

- [System Configuration](configuration.md) — Configuration management
- [Audit Trail](../administration/audit/audit-trail.md) — Audit record integrity
- [21 CFR Part 11](../compliance/21-cfr-part-11.md) — Compliance mapping
