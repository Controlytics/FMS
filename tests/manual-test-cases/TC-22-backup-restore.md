# TC-22: Backup & Restore — Test Cases

## Overview
- **Module**: Database Backup and Restore
- **API Endpoints**: 3 (GET /api/backup/export, POST /api/backup/restore, POST /api/backup/validate)
- **Frontend Pages**: /config/backup
- **Permissions**: CONFIG_UPDATE permission required (ADMIN+)
- **Reauth Actions**: EXPORT_BACKUP, RESTORE_BACKUP
- **Export Formats**: json (default), bak (gzip-compressed), sql (INSERT statements), csv (ZIP)
- **Prefix**: /api/backup

---

## Positive Test Cases

### TC-22-P01: Export Full Backup as JSON
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN or ADMIN with CONFIG_UPDATE permission
- **Test Data**: None (default format=json)
- **Steps**:
  1. Send GET /api/backup/export (reauth required)
  2. Verify response status is 200
  3. Verify Content-Type header is "application/json"
  4. Verify Content-Disposition header has filename pattern `digilog-backup-*.json`
  5. Verify response body is valid JSON
  6. Verify JSON contains `metadata` with timestamp, version, exportedBy
  7. Verify JSON contains table data sections (users, roles, configs, templates, instances, etc.)
  8. Verify JSON contains `checksum` for integrity verification
  9. Save the backup file for restore testing
- **Expected Result**: 200 OK with complete JSON backup file containing all database tables, metadata, and SHA-256 checksum

### TC-22-P02: Export Backup as BAK (Gzip Compressed)
- **Priority**: High
- **Preconditions**: Logged in as ADMIN+ with CONFIG_UPDATE
- **Test Data**: `?format=bak`
- **Steps**:
  1. Send GET /api/backup/export?format=bak
  2. Verify response status is 200
  3. Verify Content-Type header is "application/octet-stream"
  4. Verify Content-Disposition has filename pattern `digilog-backup-*.bak`
  5. Verify response body is binary (gzip compressed)
  6. Verify file size is significantly smaller than JSON export (~7x smaller)
- **Expected Result**: 200 OK with gzip-compressed backup file

### TC-22-P03: Export Backup as SQL
- **Priority**: Medium
- **Preconditions**: Logged in as ADMIN+ with CONFIG_UPDATE
- **Test Data**: `?format=sql`
- **Steps**:
  1. Send GET /api/backup/export?format=sql
  2. Verify response status is 200
  3. Verify Content-Type header is "application/sql"
  4. Verify Content-Disposition has filename pattern `digilog-backup-*.sql`
  5. Verify response body contains INSERT INTO statements
- **Expected Result**: 200 OK with PostgreSQL INSERT statement export

### TC-22-P04: Export Backup as CSV (ZIP)
- **Priority**: Medium
- **Preconditions**: Logged in as ADMIN+ with CONFIG_UPDATE
- **Test Data**: `?format=csv`
- **Steps**:
  1. Send GET /api/backup/export?format=csv
  2. Verify response status is 200
  3. Verify Content-Type header is "application/zip"
  4. Verify Content-Disposition has filename pattern `digilog-backup-*.zip`
  5. Verify the ZIP contains individual CSV files per table
- **Expected Result**: 200 OK with ZIP file containing per-table CSV files

### TC-22-P05: Validate Backup File
- **Priority**: High
- **Preconditions**: Have a valid backup file from TC-22-P01 or TC-22-P02
- **Test Data**: Backup file (JSON or BAK format)
- **Steps**:
  1. Send POST /api/backup/validate with the backup file as multipart/form-data
  2. Verify response status is 200
  3. Verify response contains `valid: true`
  4. Verify response contains `metadata` with backup timestamp and version
  5. Verify response contains `tableSummary` with row counts per table
  6. Verify response contains `checksumValid: true`
  7. Verify response contains `totalRecords` count
- **Expected Result**: 200 OK confirming backup file is valid, checksum matches, with table summary

### TC-22-P06: Restore from JSON Backup
- **Priority**: High
- **Preconditions**: Valid JSON backup file, logged in as ADMIN+ with CONFIG_UPDATE
- **Test Data**: JSON backup file from TC-22-P01
- **Steps**:
  1. Send POST /api/backup/restore with backup file as multipart/form-data (reauth required)
  2. Verify response status is 200
  3. Verify response contains `success: true`
  4. Verify response contains `message` indicating successful restore
  5. Verify response contains `backupTimestamp` and `backupVersion`
  6. Log in again after restore
  7. Verify data integrity — users, configs, entities still exist
- **Expected Result**: 200 OK with successful restore confirmation, all data restored correctly

### TC-22-P07: Restore from BAK (Compressed) Backup
- **Priority**: High
- **Preconditions**: Valid BAK backup file from TC-22-P02
- **Test Data**: BAK backup file
- **Steps**:
  1. Send POST /api/backup/restore with BAK file as multipart/form-data
  2. Verify response status is 200
  3. Verify `success: true`
  4. Verify data integrity after restore
- **Expected Result**: 200 OK, BAK file decompressed and restored successfully

### TC-22-P08: Verify Data Integrity After Restore
- **Priority**: High
- **Preconditions**: Restore completed successfully (TC-22-P06 or TC-22-P07)
- **Test Data**: None
- **Steps**:
  1. Log in with SUPER_ADMIN credentials
  2. Verify user list matches pre-backup state
  3. Verify system configs (password policy, session, datetime) are correct
  4. Verify entity templates exist with correct schemas
  5. Verify entity instances exist with correct attributes
  6. Verify roles and permissions are intact
  7. Verify audit trail entries exist
- **Expected Result**: All database tables restored to the state captured in the backup

---

## Negative Test Cases

### TC-22-N01: Export Without CONFIG_UPDATE Permission
- **Priority**: High
- **Preconditions**: Logged in as VIEWER (no CONFIG_UPDATE permission)
- **Test Data**: VIEWER JWT token
- **Steps**:
  1. Send GET /api/backup/export with VIEWER token
  2. Verify response status is 403
- **Expected Result**: 403 Forbidden — missing CONFIG_UPDATE permission

### TC-22-N02: Restore Corrupted File
- **Priority**: High
- **Preconditions**: Logged in as ADMIN+
- **Test Data**: A text file with random/invalid content
- **Steps**:
  1. Create a file with invalid content: `echo "not a valid backup" > invalid.json`
  2. Send POST /api/backup/restore with the invalid file
  3. Verify response status is 400
  4. Verify error code is INVALID_JSON or INVALID_BACKUP
- **Expected Result**: 400 Bad Request — invalid backup file format

### TC-22-N03: Validate Invalid JSON File
- **Priority**: Medium
- **Preconditions**: Logged in as ADMIN+
- **Test Data**: File with malformed JSON
- **Steps**:
  1. Send POST /api/backup/validate with a file containing `{invalid json`
  2. Verify response status is 400
  3. Verify `valid: false` and error code
- **Expected Result**: 400 Bad Request with valid=false and INVALID_JSON error

### TC-22-N04: Restore File with Checksum Mismatch
- **Priority**: High
- **Preconditions**: Valid backup file, manually tampered
- **Test Data**: Modify a value in the JSON backup file without updating the checksum
- **Steps**:
  1. Take a valid JSON backup
  2. Edit a value (e.g., change a username) without recalculating the checksum
  3. Send POST /api/backup/restore with the tampered file
  4. Verify response status is 400
  5. Verify error code is "CHECKSUM_MISMATCH"
- **Expected Result**: 400 Bad Request — CHECKSUM_MISMATCH, restore rejected to protect integrity

### TC-22-N05: Restore Without Reauth
- **Priority**: High
- **Preconditions**: RESTORE_BACKUP is configured as a reauth action
- **Test Data**: Valid backup file
- **Steps**:
  1. Send POST /api/backup/restore without providing reauth credentials
  2. Verify the API requests reauth (412 or similar)
  3. Verify restore does not proceed without reauth
- **Expected Result**: Restore blocked until re-authentication is completed

### TC-22-N06: Restore Without File
- **Priority**: Medium
- **Preconditions**: Logged in as ADMIN+
- **Test Data**: Empty multipart/form-data request
- **Steps**:
  1. Send POST /api/backup/restore without attaching a file
  2. Verify response status is 400
  3. Verify error is "NO_FILE"
- **Expected Result**: 400 Bad Request — "No backup file uploaded"

### TC-22-N07: Validate Without File
- **Priority**: Low
- **Preconditions**: Logged in as ADMIN+
- **Test Data**: Empty request
- **Steps**:
  1. Send POST /api/backup/validate without a file
  2. Verify response status is 400
  3. Verify error is "NO_FILE"
- **Expected Result**: 400 Bad Request — "No backup file uploaded"


---

## Phase 2 Notes

- Backup export includes all Phase 2 tables: CleaningProfile, FilterProfile, CleaningCycle, FilterEvent, PmSchedule, PmEntry, PmExecution, ChecklistProfile, EquipmentGroup, and related records.
- Backup/restore preserves cleaning cycle history, filter events, PM schedules, and checklist profiles.
- The backup checksum covers all Phase 2 data for integrity verification.

