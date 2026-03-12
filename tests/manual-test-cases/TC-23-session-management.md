# TC-23: Session Management — Test Cases

## Overview
- **Module**: Session Management & Single-Tab Enforcement
- **API Endpoints**: Indirect (sessions managed through auth plugin, session config via /api/config/session)
- **Frontend Pages**: All protected pages (session hooks run globally)
- **Key Behaviors**:
  - Single active session per user (new login terminates previous)
  - Configurable session duration (default 8h)
  - Idle timeout (default 15min) with warning countdown
  - Absolute 24h timeout regardless of activity
  - Session sliding window (extends on each request)
  - terminateOtherSessions on password change
  - Single-tab enforcement via localStorage heartbeat

---

## Positive Test Cases

### TC-23-P01: Login Creates Session
- **Priority**: High
- **Preconditions**: User account exists and is enabled
- **Test Data**: admin / Admin@123
- **Steps**:
  1. Send POST /api/auth/login with valid credentials
  2. Verify response contains `token` and `expiresIn`
  3. Use the token to send GET /api/auth/me
  4. Verify 200 OK — session is active
  5. Check the database for an active Session record for this user
- **Expected Result**: Login creates a new active session, JWT token is valid for authenticated requests

### TC-23-P02: Session Extends on Activity (Sliding Window)
- **Priority**: High
- **Preconditions**: Active session exists
- **Test Data**: Valid JWT token
- **Steps**:
  1. Login and note the session expiresAt from the database
  2. Wait 30 seconds
  3. Send any authenticated request (e.g., GET /api/auth/me)
  4. Check the Session record in the database
  5. Verify `expiresAt` has been extended forward from the original value
  6. Verify `lastActiveAt` has been updated to the current time
- **Expected Result**: Each authenticated request extends the session expiresAt by the configured duration (default 8h from now)

### TC-23-P03: Idle Timeout Shows Warning Then Auto-Logout
- **Priority**: High
- **Preconditions**: Browser logged in, session config has autoLogoutEnabled=true, idleTimeoutMinutes set to a testable value (e.g., 2 minutes for testing), warningMinutes=1
- **Test Data**: Session config: `{ "autoLogoutEnabled": true, "idleTimeoutMinutes": 2, "warningMinutes": 1 }`
- **Steps**:
  1. Configure session settings: autoLogoutEnabled=true, idleTimeoutMinutes=2, warningMinutes=1
  2. Login in the browser
  3. Stay idle (no mouse, keyboard, scroll, touch activity) for 1 minute
  4. Verify warning dialog appears with countdown timer
  5. Verify countdown starts at 60 seconds
  6. Continue waiting without activity
  7. Verify auto-logout occurs when countdown reaches 0
  8. Verify redirect to login page
- **Expected Result**: After idle period, warning dialog shows countdown; when countdown expires, user is automatically logged out

### TC-23-P04: Continue Session from Warning Dialog
- **Priority**: High
- **Preconditions**: Idle timeout warning is showing (TC-23-P03 step 4)
- **Test Data**: None
- **Steps**:
  1. Trigger the idle timeout warning (idle until warning appears)
  2. Click "Continue Session" button in the warning dialog
  3. Verify warning dialog closes
  4. Verify session continues to work (send any authenticated request)
  5. Verify idle timer resets (no immediate re-warning)
- **Expected Result**: Clicking continue dismisses warning, resets idle timer, session remains active

### TC-23-P05: New Login Terminates Previous Session
- **Priority**: High
- **Preconditions**: User is logged in on one client (browser/curl)
- **Test Data**: Same user credentials from two clients
- **Steps**:
  1. Login as "admin" from Client A, save TOKEN_A
  2. Login as "admin" from Client B, save TOKEN_B
  3. Use TOKEN_B to send GET /api/auth/me — verify 200 OK
  4. Use TOKEN_A to send GET /api/auth/me
  5. Verify TOKEN_A returns 401 with error "SESSION_INVALID" (previous session terminated)
- **Expected Result**: Second login creates new session and terminates the first; only the latest session is valid

### TC-23-P06: Password Change Terminates Other Sessions
- **Priority**: High
- **Preconditions**: User logged in on two clients
- **Test Data**: Current password and new password
- **Steps**:
  1. Login as "admin" from Client A (TOKEN_A) and Client B (TOKEN_B) — note: Client A session already terminated by B login per TC-23-P05, so use a different user or test sequence
  2. From Client B, send POST /api/auth/change-password with current and new passwords
  3. Verify 200 OK (password changed)
  4. From Client A (if session still active), verify 401 — session terminated
  5. Login with the new password to confirm it works
- **Expected Result**: Password change invalidates all other sessions for the user

### TC-23-P07: Single-Tab Enforcement (Browser)
- **Priority**: High
- **Preconditions**: Logged in via browser
- **Test Data**: Same user in two browser tabs
- **Steps**:
  1. Login in Tab 1 — verify dashboard loads
  2. Open a new tab (Tab 2) to the same app URL
  3. Verify Tab 2 detects the existing session and shows "Duplicate Tab" warning
  4. Verify Tab 2 offers option to "Take Over" (claim active tab)
  5. Click "Take Over" in Tab 2
  6. Verify Tab 2 becomes the active tab
  7. Return to Tab 1 — verify it detects it is no longer the active tab
- **Expected Result**: Single-tab enforcement via localStorage heartbeat (1s interval, 3s timeout) prevents simultaneous usage

### TC-23-P08: Session Survives Page Refresh
- **Priority**: Medium
- **Preconditions**: Logged in via browser
- **Test Data**: None
- **Steps**:
  1. Login in browser
  2. Note the current page/route
  3. Press F5 or Ctrl+R to refresh the page
  4. Verify user remains logged in (not redirected to login)
  5. Verify same user data displayed
- **Expected Result**: Session persists across page refresh (JWT stored in sessionStorage survives same-tab refresh)

### TC-23-P09: Absolute 24h Timeout
- **Priority**: High
- **Preconditions**: Active session
- **Test Data**: Session created more than 24 hours ago (requires DB manipulation for testing)
- **Steps**:
  1. Login and get the session ID
  2. In the database, update the session's `createdAt` to 25 hours ago: `UPDATE "Session" SET "createdAt" = NOW() - INTERVAL '25 hours' WHERE id = '<session-id>'`
  3. Send GET /api/auth/me with the token
  4. Verify response status is 401
  5. Verify error is "SESSION_EXPIRED" with message about maximum duration
  6. Verify the session's `terminationReason` in the DB is "absolute_timeout"
- **Expected Result**: 401 Unauthorized — session exceeded maximum 24h duration regardless of activity

---

## Negative Test Cases

### TC-23-N01: Use Token After Session Expired
- **Priority**: High
- **Preconditions**: Session has been expired (manually or via timeout)
- **Test Data**: JWT from an expired session
- **Steps**:
  1. Get a valid token from login
  2. In the database, set the session's expiresAt to the past: `UPDATE "Session" SET "expiresAt" = NOW() - INTERVAL '1 hour' WHERE id = '<session-id>'`
  3. Send GET /api/auth/me with the token
  4. Verify response status is 401
  5. Verify error is "SESSION_EXPIRED"
- **Expected Result**: 401 Unauthorized — "Session expired"

### TC-23-N02: Use Token After Another Login Invalidated It
- **Priority**: High
- **Preconditions**: Two tokens for the same user
- **Test Data**: TOKEN_A from first login, TOKEN_B from second login
- **Steps**:
  1. Login as user X from Client A — get TOKEN_A
  2. Login as user X from Client B — get TOKEN_B (this terminates A's session)
  3. Use TOKEN_A for GET /api/auth/me
  4. Verify 401 with "SESSION_INVALID"
- **Expected Result**: 401 — first session was terminated by second login

### TC-23-N03: Use Token After Session Manually Terminated
- **Priority**: Medium
- **Preconditions**: Active session exists
- **Test Data**: Valid JWT token
- **Steps**:
  1. Login and get token
  2. Send POST /api/auth/logout to terminate the session
  3. Use the same token for GET /api/auth/me
  4. Verify 401 with "SESSION_INVALID"
- **Expected Result**: 401 — session terminated by logout, token no longer valid

### TC-23-N04: Use Token for Disabled Account
- **Priority**: High
- **Preconditions**: User exists but is disabled (status != ENABLED)
- **Test Data**: JWT for a disabled user
- **Steps**:
  1. Login as admin, disable a test user
  2. Attempt to use the disabled user's existing token for GET /api/auth/me
  3. Verify 401 with "ACCOUNT_INACTIVE"
- **Expected Result**: 401 — "Account is not active" even if session exists

### TC-23-N05: Manipulate localStorage to Bypass Single-Tab
- **Priority**: Medium
- **Preconditions**: Two browser tabs, single-tab enforcement active
- **Test Data**: None
- **Steps**:
  1. Login in Tab 1
  2. Open Tab 2 (shows duplicate tab warning)
  3. In Tab 2's console, clear the localStorage keys: `localStorage.removeItem('digilog_active_tab_id')`
  4. Verify Tab 1 stops receiving heartbeat updates within 3 seconds
  5. Verify Tab 2 claims the active tab after the heartbeat timeout
  6. Note: This "bypasses" the enforcement but Tab 1 loses its claim
- **Expected Result**: Clearing localStorage lets another tab claim ownership, but does not allow true simultaneous use since the heartbeat mechanism detects the takeover

### TC-23-N06: Concurrent API Calls After Session Termination
- **Priority**: Medium
- **Preconditions**: Active session
- **Test Data**: Multiple parallel requests with the same token
- **Steps**:
  1. Login and get token
  2. Logout the session
  3. Immediately send 5 parallel GET /api/auth/me requests with the old token
  4. Verify all 5 return 401
- **Expected Result**: All requests fail — session termination is immediate and consistent
