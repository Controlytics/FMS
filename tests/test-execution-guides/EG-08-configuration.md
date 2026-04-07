# EG-08: Configuration — Execution Guide

## Prerequisites
- **API Base**: `http://localhost:3000/api`
- **Credentials**: superadmin / Admin@123 (SUPER_ADMIN)
- **Tools**: curl, jq
- **Note**: Some config changes (password policy, session) can affect active sessions. Document original values before changing.

## Setup
```bash
API="http://localhost:3000/api"

TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123","force":true}' | jq -r '.token')

get_vtoken() {
  curl -s -X POST "$API/auth/verify" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"password":"Admin@123"}' | jq -r '.verificationToken'
}
```

---

## Test Execution

### Test: TC-08-P01 — Get Password Policy

**API (curl):**
```bash
curl -s -X GET "$API/config/password-policy" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Browser Steps:**
1. Navigate to http://34.232.224.0/config/security
2. View Password Policy section

**Expected Result:**
- Config object with password complexity settings

**Pass/Fail:**
- [ ] Response status 200
- [ ] Contains minLength, requireUppercase, requireLowercase, etc.

---

### Test: TC-08-P02 — Update Password Policy

**API (curl):**
```bash
# Save original
ORIG_POLICY=$(curl -s -X GET "$API/config/password-policy" \
  -H "Authorization: Bearer $TOKEN")
echo "Original: $ORIG_POLICY"

# Update
curl -s -X PUT "$API/config/password-policy" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"minLength":10,"requireUppercase":true,"requireNumbers":true,"requireSpecial":true,"_currentPassword":"Admin@123"}' | jq .

# Verify
curl -s -X GET "$API/config/password-policy" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Restore original (replace values as needed)
curl -s -X PUT "$API/config/password-policy" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"minLength":8,"requireUppercase":true,"requireNumbers":true,"requireSpecial":true,"_currentPassword":"Admin@123"}' | jq .
```

**Pass/Fail:**
- [ ] Update returns success
- [ ] GET confirms updated values
- [ ] Original restored

---

### Test: TC-08-P03 — Get/Update Login Security

**API (curl):**
```bash
curl -s -X GET "$API/config/login-security" \
  -H "Authorization: Bearer $TOKEN" | jq .

curl -s -X PUT "$API/config/login-security" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"maxFailedAttempts":5,"lockoutDuration":15,"_currentPassword":"Admin@123"}' | jq .
```

**Pass/Fail:**
- [ ] GET returns login security config
- [ ] PUT updates successfully

---

### Test: TC-08-P04 — Get/Update Session Config

**API (curl):**
```bash
curl -s -X GET "$API/config/session" \
  -H "Authorization: Bearer $TOKEN" | jq .

curl -s -X PUT "$API/config/session" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessionDuration":480,"idleTimeout":15,"absoluteTimeout":1440,"_currentPassword":"Admin@123"}' | jq .
```

**Pass/Fail:**
- [ ] GET returns session config
- [ ] PUT updates successfully

---

### Test: TC-08-P05 — Get/Update DateTime Format

**API (curl):**
```bash
curl -s -X GET "$API/config/datetime" \
  -H "Authorization: Bearer $TOKEN" | jq .

curl -s -X PUT "$API/config/datetime" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dateFormat":"DD/MM/YYYY","timeFormat":"HH:mm:ss","timezone":"Asia/Kolkata"}' | jq .
```

**Pass/Fail:**
- [ ] Format updated
- [ ] GET confirms changes

---

### Test: TC-08-P06 — Get DateTime Current (Public)

**API (curl):**
```bash
curl -s -X GET "$API/config/datetime/current" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Pass/Fail:**
- [ ] Response status 200
- [ ] Same data as admin endpoint

---

### Test: TC-08-P07 — Get/Update Pagination

**API (curl):**
```bash
curl -s -X GET "$API/config/pagination" \
  -H "Authorization: Bearer $TOKEN" | jq .

curl -s -X PUT "$API/config/pagination" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"defaultPageSize":25,"pageSizeOptions":[10,25,50,100]}' | jq .

# Public endpoint
curl -s -X GET "$API/config/pagination/current" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Pass/Fail:**
- [ ] Pagination config updated
- [ ] /current returns same data

---

### Test: TC-08-P08 — User ID Configuration

**API (curl):**
```bash
curl -s -X GET "$API/config/user-id" \
  -H "Authorization: Bearer $TOKEN" | jq .

VTOKEN=$(get_vtoken)
curl -s -X PUT "$API/config/user-id" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"autoGenerate":true,"prefix":"EMP","startFrom":1,"padLength":4}' | jq .

# Get next ID
curl -s -X GET "$API/config/user-id/next" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Validate an ID
curl -s -X POST "$API/config/user-id/validate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"EMP0001"}' | jq .
```

**Pass/Fail:**
- [ ] User ID config updated
- [ ] Next ID generated correctly
- [ ] Validation works

---

### Test: TC-08-P09 — Get Branding (Public)

**API (curl):**
```bash
# No auth required
curl -s -X GET "$API/config/branding" | jq .
```

**Pass/Fail:**
- [ ] Response status 200 (no auth needed)
- [ ] Contains company name, colors

---

### Test: TC-08-P10 — Update Branding

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -X PUT "$API/config/branding" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"companyName":"DigiLog Pharma Inc.","primaryColor":"#1E40AF"}' | jq .
```

**Pass/Fail:**
- [ ] Response status 200
- [ ] Branding updated

---

### Test: TC-08-P11 — Role Configuration

**API (curl):**
```bash
# List all role configs
curl -s -X GET "$API/config/roles" \
  -H "Authorization: Bearer $TOKEN" | jq '.[].role'

# Get specific role config
curl -s -X GET "$API/config/roles/OPERATOR" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Update
VTOKEN=$(get_vtoken)
curl -s -X PUT "$API/config/roles/OPERATOR" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sidebarItems":["dashboard","assets","audit"],"homeWidgets":["stats"]}' | jq .
```

**Pass/Fail:**
- [ ] List returns role configs
- [ ] Single role config returned
- [ ] Update succeeds

---

### Test: TC-08-P12 — My Config (Effective)

**API (curl):**
```bash
curl -s -X GET "$API/config/my-config" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Pass/Fail:**
- [ ] Response status 200
- [ ] Contains sidebarItems, homeWidgets, permissions

---

### Test: TC-08-P13 — Field ID Labels

**API (curl):**
```bash
curl -s -X GET "$API/config/field-ids" \
  -H "Authorization: Bearer $TOKEN" | jq .

curl -s -X PUT "$API/config/field-ids/username" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Employee Number"}' | jq .
```

**Pass/Fail:**
- [ ] Field IDs listed
- [ ] Label updated

---

### Test: TC-08-P14 — Action Reauth Configuration

**API (curl):**
```bash
# Get full config
curl -s -X GET "$API/config/action-reauth" \
  -H "Authorization: Bearer $TOKEN" | jq . | head -20

# Check specific action
curl -s -X GET "$API/config/action-reauth/check?action=DELETE_USER" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Get my actions
curl -s -X GET "$API/config/action-reauth/my-actions" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Pass/Fail:**
- [ ] Full config returned
- [ ] Per-action check works
- [ ] My-actions returns action list

---

### Test: TC-08-P15 — Audit Templates

**API (curl):**
```bash
curl -s -X GET "$API/config/audit-templates" \
  -H "Authorization: Bearer $TOKEN" | jq . | head -20

curl -s -X GET "$API/config/audit-templates/current" \
  -H "Authorization: Bearer $TOKEN" | jq . | head -20
```

**Pass/Fail:**
- [ ] Templates returned
- [ ] /current accessible

---

### Test: TC-08-P16 — Alarm Columns

**API (curl):**
```bash
curl -s -X GET "$API/config/alarm-columns" \
  -H "Authorization: Bearer $TOKEN" | jq .

curl -s -X GET "$API/config/alarm-columns/current" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Pass/Fail:**
- [ ] Full config returned
- [ ] Current user columns returned

---

### Test: TC-08-N01 — Update as Non-Admin

**API (curl):**
```bash
# Login as operator/viewer
OP_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"operatortest","password":"Operator@123"}' | jq -r '.token // empty')

if [ -n "$OP_TOKEN" ]; then
  curl -s -w "\nHTTP_CODE:%{http_code}\n" -X PUT "$API/config/password-policy" \
    -H "Authorization: Bearer $OP_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"minLength":12,"_currentPassword":"Operator@123"}'
fi
```

**Expected Result:**
- HTTP 403

**Pass/Fail:**
- [ ] Response status 403

---

### Test: TC-08-N02 — Update Without Reauth

**API (curl):**
```bash
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X PUT "$API/config/password-policy" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"minLength":12}'
```

**Expected Result:**
- HTTP 401 REAUTH_REQUIRED

**Pass/Fail:**
- [ ] Response status 401
- [ ] Error mentions reauth/password required

---

### Test: TC-08-N03 — Update with Wrong Password

**API (curl):**
```bash
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X PUT "$API/config/password-policy" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"minLength":12,"_currentPassword":"WrongPassword"}'
```

**Expected Result:**
- HTTP 401 REAUTH_FAILED

**Pass/Fail:**
- [ ] Response status 401
- [ ] Error: REAUTH_FAILED

---

### Test: TC-08-N08 — Access Without Auth

**API (curl):**
```bash
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X GET "$API/config/password-policy"
```

**Expected Result:**
- HTTP 401

**Pass/Fail:**
- [ ] Response status 401

---

## Cleanup
```bash
echo "Restore any config values changed during testing"
echo "Key configs to check: password-policy, login-security, session, branding, field-ids"
```


> **Phase 2 (Digital FMS):** 23 config definitions with auto-discovery. 78+ field IDs including filter-specific fields. Filter reauth actions (BYPASS_FILTER_STAGE, CREATE/UPDATE/DELETE_CLEANING_PROFILE) in action-reauth config. Test per TC-08-P19 through TC-08-P22.


---

## Phase 3 Update (2026-04-07)

**RFID & Offline Operations:**
- RFID Scanner Android app (`rfid_scan_app/`) for KC-series UHF readers
- RFID keyboard guard prevents UKB tag input leaking into random fields
- Offline cleaning operations via IndexedDB queue + sync engine
- Cached identifier→filter map for offline RFID lookup
- "Data Synced" indicator in mobile header
- One identifier per entity (backend-enforced)
- Responsive layout with collapsible sidebar
- Error popups replace inline banners
- User creation auto-assigns org for admins
- `/api/roles/active` public endpoint for contact-admin page

See `CHANGELOG.md` for full details.
