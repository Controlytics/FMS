# EG-22: Backup & Restore — Execution Guide

## Prerequisites
- **Credentials**: SUPER_ADMIN (superadmin / Admin@123), VIEWER account for negative tests
- **Tools**: curl, jq, browser, gunzip (for BAK files), unzip (for CSV exports)
- **Setup**: Database has data (users, entities, configs) for meaningful backup
- **Base URL**: http://localhost:3000
- **Warning**: Restore operations overwrite database data. Test in a safe environment.

## Authentication Setup
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq -r '.token')

echo "Token: $TOKEN"
```

---

## Test Execution

### Test: TC-22-P01 — Export Full Backup as JSON

**Browser Steps:**
1. Navigate to http://34.232.224.0/config/backup
2. Select "JSON" format
3. Click "Export Backup" (reauth dialog may appear)
4. Complete reauth if prompted
5. Verify file downloads with .json extension
6. Open file and verify it contains valid JSON with metadata and table data

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/backup/export?format=json" \
  -H "Authorization: Bearer $TOKEN" \
  -o /tmp/digilog-backup.json \
  -D /tmp/backup-headers.txt

# Check headers
cat /tmp/backup-headers.txt | head -10

# Verify JSON structure
cat /tmp/digilog-backup.json | jq '.metadata'

# Check table data keys
cat /tmp/digilog-backup.json | jq 'keys'

# Verify checksum field
cat /tmp/digilog-backup.json | jq '.checksum'
```

**Expected Result:**
- File downloads with Content-Type: application/json
- JSON contains metadata (timestamp, version, exportedBy)
- Contains data sections for all tables
- Contains SHA-256 checksum

**Pass/Fail:**
- [ ] File downloads successfully
- [ ] Valid JSON structure
- [ ] metadata.timestamp present
- [ ] checksum present
- [ ] Table data sections present

---

### Test: TC-22-P02 — Export as BAK (Compressed)

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/backup/export?format=bak" \
  -H "Authorization: Bearer $TOKEN" \
  -o /tmp/digilog-backup.bak \
  -D /tmp/bak-headers.txt

cat /tmp/bak-headers.txt | head -5

# Compare sizes
JSON_SIZE=$(stat -c%s /tmp/digilog-backup.json 2>/dev/null || stat -f%z /tmp/digilog-backup.json)
BAK_SIZE=$(stat -c%s /tmp/digilog-backup.bak 2>/dev/null || stat -f%z /tmp/digilog-backup.bak)
echo "JSON: ${JSON_SIZE} bytes, BAK: ${BAK_SIZE} bytes"
```

**Pass/Fail:**
- [ ] Content-Type is application/octet-stream
- [ ] BAK file is significantly smaller than JSON
- [ ] File is binary (gzip format)

---

### Test: TC-22-P03 — Export as SQL

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/backup/export?format=sql" \
  -H "Authorization: Bearer $TOKEN" \
  -o /tmp/digilog-backup.sql \
  -D /tmp/sql-headers.txt

cat /tmp/sql-headers.txt | head -5

# Verify content
head -20 /tmp/digilog-backup.sql
```

**Pass/Fail:**
- [ ] Content-Type is application/sql
- [ ] File contains INSERT INTO statements

---

### Test: TC-22-P04 — Export as CSV (ZIP)

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/backup/export?format=csv" \
  -H "Authorization: Bearer $TOKEN" \
  -o /tmp/digilog-backup.zip \
  -D /tmp/csv-headers.txt

cat /tmp/csv-headers.txt | head -5

# List ZIP contents
unzip -l /tmp/digilog-backup.zip
```

**Pass/Fail:**
- [ ] Content-Type is application/zip
- [ ] ZIP contains individual CSV files per table

---

### Test: TC-22-P05 — Validate Backup File

**API (curl):**
```bash
# Validate JSON backup
curl -s -X POST http://localhost:3000/api/backup/validate \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/digilog-backup.json" | jq .

# Validate BAK backup
curl -s -X POST http://localhost:3000/api/backup/validate \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/digilog-backup.bak" | jq .
```

**Expected Result:**
- API: 200 OK
  ```json
  {
    "valid": true,
    "metadata": { "timestamp": "...", "version": "...", "exportedBy": "admin" },
    "tableSummary": { "User": 5, "Role": 6, "SystemConfig": 10, ... },
    "checksumValid": true,
    "totalRecords": 150
  }
  ```

**Pass/Fail:**
- [ ] valid is true
- [ ] checksumValid is true
- [ ] tableSummary has row counts
- [ ] totalRecords > 0

---

### Test: TC-22-P06 — Restore from JSON Backup

**API (curl):**
```bash
# WARNING: This overwrites database data!
curl -s -X POST http://localhost:3000/api/backup/restore \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/digilog-backup.json" | jq .
```

**Expected Result:**
- API: 200 OK
  ```json
  {
    "success": true,
    "message": "Database restored successfully",
    "backupTimestamp": "...",
    "backupVersion": "..."
  }
  ```

**Post-restore verification:**
```bash
# Re-login (session may have been invalidated)
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq -r '.token')

# Verify users
curl -s -X GET "http://localhost:3000/api/users?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.total'

# Verify configs
curl -s -X GET http://localhost:3000/api/config/session \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Pass/Fail:**
- [ ] success is true
- [ ] Can log in after restore
- [ ] User data intact
- [ ] Configs intact

---

### Test: TC-22-P07 — Restore from BAK Backup

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/backup/restore \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/digilog-backup.bak" | jq .
```

**Pass/Fail:**
- [ ] success is true
- [ ] Data restored from compressed backup

---

### Test: TC-22-P08 — Verify Data Integrity After Restore

**API (curl):**
```bash
# Re-login
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq -r '.token')

# Check users
curl -s -X GET http://localhost:3000/api/users \
  -H "Authorization: Bearer $TOKEN" | jq '.total'

# Check roles
curl -s -X GET http://localhost:3000/api/roles \
  -H "Authorization: Bearer $TOKEN" | jq 'length'

# Check templates
curl -s -X GET http://localhost:3000/api/assets/templates \
  -H "Authorization: Bearer $TOKEN" | jq '.total'

# Check instances
curl -s -X GET http://localhost:3000/api/assets/instances \
  -H "Authorization: Bearer $TOKEN" | jq '.total'

# Check audit trail
curl -s -X GET "http://localhost:3000/api/audit?limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq '.total'
```

**Pass/Fail:**
- [ ] User count matches pre-backup
- [ ] Role count matches
- [ ] Template count matches
- [ ] Instance count matches
- [ ] Audit records present

---

### Test: TC-22-N01 — Export Without Permission

**API (curl):**
```bash
VIEWER_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"viewer_user","password":"Viewer@123"}' | jq -r '.token')

curl -s -o /dev/null -w "%{http_code}" \
  -X GET http://localhost:3000/api/backup/export \
  -H "Authorization: Bearer $VIEWER_TOKEN"
```

**Expected Result:**
- 403 Forbidden

**Pass/Fail:**
- [ ] Response status is 403

---

### Test: TC-22-N02 — Restore Corrupted File

**API (curl):**
```bash
echo "not a valid backup file" > /tmp/invalid-backup.json

curl -s -X POST http://localhost:3000/api/backup/restore \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/invalid-backup.json" | jq .
```

**Expected Result:**
- 400 with INVALID_JSON or INVALID_BACKUP error

**Pass/Fail:**
- [ ] Response status is 400
- [ ] Error code indicates invalid format

---

### Test: TC-22-N03 — Validate Invalid JSON

**API (curl):**
```bash
echo "{invalid json content" > /tmp/malformed.json

curl -s -X POST http://localhost:3000/api/backup/validate \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/malformed.json" | jq .
```

**Expected Result:**
- 400 with valid=false

**Pass/Fail:**
- [ ] valid is false or status is 400

---

### Test: TC-22-N04 — Restore Tampered File (Checksum Mismatch)

**API (curl):**
```bash
# Tamper with the backup
cp /tmp/digilog-backup.json /tmp/tampered-backup.json
# Change a value without updating checksum
python3 -c "
import json
with open('/tmp/tampered-backup.json') as f:
    data = json.load(f)
# Tamper with metadata
data['metadata']['exportedBy'] = 'hacker'
with open('/tmp/tampered-backup.json', 'w') as f:
    json.dump(data, f)
"

curl -s -X POST http://localhost:3000/api/backup/restore \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/tampered-backup.json" | jq .
```

**Expected Result:**
- 400 with CHECKSUM_MISMATCH

**Pass/Fail:**
- [ ] Response status is 400
- [ ] Error code is CHECKSUM_MISMATCH

---

### Test: TC-22-N05 — Restore Without Reauth

**Browser Steps:**
1. Navigate to /config/backup
2. Upload a backup file
3. Click Restore
4. Reauth dialog should appear
5. Cancel the reauth dialog
6. Verify restore did NOT proceed

**Pass/Fail:**
- [ ] Reauth dialog appears
- [ ] Canceling prevents restore

---

### Test: TC-22-N06 — Restore Without File

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/backup/restore \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: multipart/form-data" | jq .
```

**Expected Result:**
- 400 with NO_FILE error

**Pass/Fail:**
- [ ] Response status is 400
- [ ] Error is "NO_FILE"

---

### Test: TC-22-N07 — Validate Without File

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/backup/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: multipart/form-data" | jq .
```

**Expected Result:**
- 400 with NO_FILE error

**Pass/Fail:**
- [ ] Response status is 400
- [ ] Error is "NO_FILE"

---

## Cleanup
```bash
rm -f /tmp/digilog-backup.json /tmp/digilog-backup.bak /tmp/digilog-backup.sql \
      /tmp/digilog-backup.zip /tmp/invalid-backup.json /tmp/malformed.json \
      /tmp/tampered-backup.json /tmp/backup-headers.txt /tmp/bak-headers.txt \
      /tmp/sql-headers.txt /tmp/csv-headers.txt
```


> **Phase 2 (Digital FMS):** Backup includes all Phase 2 tables: CleaningProfile, FilterProfile, CleaningCycle, FilterEvent, PmSchedule, PmEntry, PmExecution, ChecklistProfile, EquipmentGroup.

