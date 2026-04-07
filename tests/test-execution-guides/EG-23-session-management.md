# EG-23: Session Management — Execution Guide

## Prerequisites
- **Credentials**: SUPER_ADMIN (superadmin / Admin@123), secondary test user account
- **Tools**: curl, jq, two browser tabs/windows, database access (psql)
- **Setup**: Default session config (8h duration, 15min idle timeout)
- **Base URL**: http://localhost:3000
- **DB Connection**: `psql -d digilog_db -U postgres`

## Authentication Setup
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq -r '.token')

echo "Token: $TOKEN"
```

---

## Test Execution

### Test: TC-23-P01 — Login Creates Session

**API (curl):**
```bash
# Login
RESPONSE=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}')

echo "$RESPONSE" | jq '{token: .token[0:20], expiresIn: .expiresIn}'

TOKEN=$(echo "$RESPONSE" | jq -r '.token')

# Verify session works
curl -s -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq '{id: .id, username: .username, role: .role}'
```

**DB Verification:**
```sql
-- Check active sessions for admin
SELECT id, "userId", "createdAt", "expiresAt", "isActive", "lastActiveAt"
FROM "Session"
WHERE "userId" = (SELECT id FROM "User" WHERE username = 'admin')
  AND "isActive" = true
ORDER BY "createdAt" DESC
LIMIT 1;
```

**Pass/Fail:**
- [ ] Login returns token and expiresIn
- [ ] GET /me returns 200 with user info
- [ ] Active session exists in DB

---

### Test: TC-23-P02 — Session Sliding Window

**API (curl):**
```bash
# Get session ID from JWT payload (base64 decode middle part)
SESSION_ID=$(echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq -r '.sessionId')
echo "Session ID: $SESSION_ID"

# Check current expiresAt
psql -d digilog_db -U postgres -t -c \
  "SELECT \"expiresAt\" FROM \"Session\" WHERE id = '$SESSION_ID'"

# Wait a moment
sleep 5

# Make an authenticated request (triggers sliding window)
curl -s -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN" > /dev/null

# Check expiresAt again - should have moved forward
psql -d digilog_db -U postgres -t -c \
  "SELECT \"expiresAt\", \"lastActiveAt\" FROM \"Session\" WHERE id = '$SESSION_ID'"
```

**Expected Result:**
- expiresAt moved forward after the request
- lastActiveAt updated to current time

**Pass/Fail:**
- [ ] expiresAt extended after authenticated request
- [ ] lastActiveAt updated

---

### Test: TC-23-P03 — Idle Timeout Warning and Auto-Logout

**Setup (reduce timeout for testing):**
```bash
# Set short idle timeout for testing (2 min idle, 1 min warning)
curl -s -X PUT http://localhost:3000/api/config/session \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionDurationHours": 8,
    "autoLogoutEnabled": true,
    "idleTimeoutMinutes": 2,
    "warningMinutes": 1
  }' | jq .
```

**Browser Steps:**
1. Navigate to http://34.232.224.0 and login
2. Do NOT move the mouse, press keys, or scroll
3. After ~1 minute (idleTimeout - warningMinutes), warning dialog should appear
4. Verify countdown timer is visible (starts at 60 seconds)
5. Continue waiting without activity
6. After countdown reaches 0, verify automatic logout
7. Verify redirect to /login page

**Pass/Fail:**
- [ ] Warning appears after idle period (idle - warning time)
- [ ] Countdown timer counts down
- [ ] Auto-logout occurs at countdown=0
- [ ] Redirected to login page

---

### Test: TC-23-P04 — Continue Session from Warning

**Browser Steps:**
1. Trigger idle timeout warning (wait without activity)
2. When warning dialog appears with countdown, click "Continue Session"
3. Verify warning dialog closes
4. Verify app is still functional
5. Verify no immediate re-warning (timer reset)

**Pass/Fail:**
- [ ] Warning dismissed on click
- [ ] Session continues working
- [ ] Timer resets (no immediate re-warning)

---

### Test: TC-23-P05 — New Login Terminates Previous Session

**API (curl):**
```bash
# Login from "Client A"
TOKEN_A=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq -r '.token')

echo "Token A: ${TOKEN_A:0:20}..."

# Login from "Client B" (same user)
TOKEN_B=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq -r '.token')

echo "Token B: ${TOKEN_B:0:20}..."

# Verify Token B works
curl -s -o /dev/null -w "%{http_code}" \
  -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN_B"
# Expected: 200

# Verify Token A is invalidated
curl -s -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN_A" | jq .
# Expected: 401 SESSION_INVALID
```

**Expected Result:**
- Token B: 200 OK
- Token A: 401 with SESSION_INVALID

**Pass/Fail:**
- [ ] Second login returns valid token
- [ ] First token returns 401
- [ ] Error is SESSION_INVALID

---

### Test: TC-23-P06 — Password Change Terminates Other Sessions

**API (curl):**
```bash
# Login to get active session
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq -r '.token')

# Change password (terminates other sessions)
curl -s -X POST http://localhost:3000/api/auth/change-password \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "currentPassword": "Admin@123",
    "newPassword": "NewAdmin@123",
    "confirmPassword": "NewAdmin@123"
  }' | jq .

# Current session should still work
curl -s -o /dev/null -w "Current session: %{http_code}\n" \
  -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN"

# Login with new password
NEW_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"NewAdmin@123"}' | jq -r '.token')

# Restore original password
curl -s -X POST http://localhost:3000/api/auth/change-password \
  -H "Authorization: Bearer $NEW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "currentPassword": "NewAdmin@123",
    "newPassword": "Admin@123",
    "confirmPassword": "Admin@123"
  }' | jq .
```

**Pass/Fail:**
- [ ] Password change returns 200
- [ ] Login with new password works
- [ ] Other sessions terminated

---

### Test: TC-23-P07 — Single-Tab Enforcement (Browser)

**Browser Steps:**
1. Open Tab 1: http://34.232.224.0 and login
2. Verify dashboard loads normally
3. Open Tab 2: http://34.232.224.0
4. Verify Tab 2 shows "Duplicate Tab" or similar warning
5. In Tab 2, click "Take Over" or "Continue Here"
6. Return to Tab 1
7. Verify Tab 1 shows it is no longer the active tab

**Verification via DevTools (Tab 1):**
```javascript
// In browser console
console.log('Tab ID:', sessionStorage.getItem('digilog_tab_id'));
console.log('Active Tab:', localStorage.getItem('digilog_active_tab_id'));
console.log('Heartbeat:', localStorage.getItem('digilog_tab_heartbeat'));
console.log('User:', localStorage.getItem('digilog_active_user_id'));
```

**Pass/Fail:**
- [ ] Tab 2 detects existing session
- [ ] Duplicate tab warning shown
- [ ] Take-over transfers active tab
- [ ] Tab 1 detects it lost ownership

---

### Test: TC-23-P08 — Session Survives Page Refresh

**Browser Steps:**
1. Login at http://34.232.224.0
2. Navigate to /users or any protected page
3. Press F5 to refresh
4. Verify user remains logged in (not redirected to login)
5. Verify correct page reloads

**Pass/Fail:**
- [ ] User stays logged in after refresh
- [ ] Same page reloads correctly

---

### Test: TC-23-P09 — Absolute 24h Timeout

**DB Setup:**
```sql
-- Get session ID for the current admin session
-- First login to get a fresh session
-- Then manipulate createdAt to simulate 25h ago

UPDATE "Session"
SET "createdAt" = NOW() - INTERVAL '25 hours'
WHERE id = '<SESSION_ID_FROM_JWT>'
  AND "isActive" = true;
```

**API (curl):**
```bash
# Try using the token after manipulating createdAt
curl -s -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- 401 with "Session exceeded maximum duration. Please log in again."

**DB Verification:**
```sql
SELECT "terminationReason" FROM "Session" WHERE id = '<SESSION_ID>';
-- Expected: absolute_timeout
```

**Pass/Fail:**
- [ ] 401 returned after 24h
- [ ] Error mentions maximum duration
- [ ] terminationReason is "absolute_timeout"

---

### Test: TC-23-N01 — Use Token After Session Expired

**Setup:**
```sql
-- Expire the session
UPDATE "Session"
SET "expiresAt" = NOW() - INTERVAL '1 hour'
WHERE id = '<SESSION_ID>'
  AND "isActive" = true;
```

**API (curl):**
```bash
curl -s -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- 401 with SESSION_EXPIRED

**Pass/Fail:**
- [ ] Response status is 401
- [ ] Error is SESSION_EXPIRED

---

### Test: TC-23-N02 — Use Token After Another Login

(Same as TC-23-P05 - see above)

**Pass/Fail:**
- [ ] Old token returns 401 SESSION_INVALID

---

### Test: TC-23-N03 — Use Token After Logout

**API (curl):**
```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq -r '.token')

# Logout
curl -s -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer $TOKEN" | jq .

# Try using the token
curl -s -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- 401 SESSION_INVALID after logout

**Pass/Fail:**
- [ ] Token invalid after logout

---

### Test: TC-23-N04 — Use Token for Disabled Account

**API (curl):**
```bash
# Create a test user, login, then disable the account
# Requires separate test user

# Use the test user's token after disabling their account
curl -s -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $DISABLED_USER_TOKEN" | jq .
```

**Expected Result:**
- 401 with ACCOUNT_INACTIVE

**Pass/Fail:**
- [ ] 401 returned
- [ ] Error is ACCOUNT_INACTIVE

---

### Test: TC-23-N05 — Manipulate localStorage

**Browser Steps (DevTools Console in Tab 2):**
```javascript
// Clear the active tab claim
localStorage.removeItem('digilog_active_tab_id');
localStorage.removeItem('digilog_tab_heartbeat');

// Wait 3 seconds for the heartbeat timeout
// Tab 2 should now be able to claim active status
```

**Pass/Fail:**
- [ ] Clearing localStorage lets another tab claim ownership
- [ ] But does NOT allow truly simultaneous usage

---

### Test: TC-23-N06 — Concurrent API Calls After Termination

**API (curl):**
```bash
# Login and immediately logout
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq -r '.token')

curl -s -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer $TOKEN" > /dev/null

# Send 5 parallel requests
for i in {1..5}; do
  curl -s -o /dev/null -w "Request $i: %{http_code}\n" \
    -X GET http://localhost:3000/api/auth/me \
    -H "Authorization: Bearer $TOKEN" &
done
wait
```

**Expected Result:**
- All 5 requests return 401

**Pass/Fail:**
- [ ] All concurrent requests return 401

---

## Cleanup
```bash
# Restore default session config
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq -r '.token')

curl -s -X PUT http://localhost:3000/api/config/session \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionDurationHours": 8,
    "autoLogoutEnabled": true,
    "idleTimeoutMinutes": 15,
    "warningMinutes": 2
  }' | jq .
```


> **Phase 2 (Digital FMS):** Session management unchanged. All filter endpoints use same JWT/session auth. Default login: `superadmin` / `Admin@123`.


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
