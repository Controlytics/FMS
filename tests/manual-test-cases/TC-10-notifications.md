# TC-10: Notifications -- Test Cases

## Overview
- **Module**: Notifications
- **API Endpoints**: 9 (GET /, GET /unread-count, PUT /:id/read, PUT /:id/unread, PUT /mark-all-read, PUT /bulk-read, PUT /bulk-unread, DELETE /:id, POST /bulk-delete)
- **Frontend Pages**: /notifications
- **Permissions**: All authenticated users can access their notifications; bulk-delete requires NOTIFICATION_MANAGE permission
- **Key Facts**: SUPER_ADMIN sees all notifications, ADMIN sees non-SUPER_ADMIN notifications, others see only their own. Role-based filtering applied server-side.

---

## Positive Test Cases

### TC-10-P01: List Notifications with Default Pagination
- **Priority**: High
- **Preconditions**: User is authenticated. At least one notification exists for the user.
- **Test Data**: None.
- **Steps**:
  1. Send GET /api/notifications.
  2. Verify response status 200.
  3. Verify response body has `data` (array), `total`, `unreadCount`, `page` (1), `limit` (20), `totalPages`.
  4. Verify each notification has id, type, title, message, isRead, createdAt fields.
- **Expected Result**: Paginated notification list with metadata.

### TC-10-P02: List Notifications with Custom Pagination
- **Priority**: Medium
- **Preconditions**: More than 5 notifications exist.
- **Test Data**: `page=2&limit=5`
- **Steps**:
  1. Send GET /api/notifications?page=2&limit=5.
  2. Verify page 2 with up to 5 records.
- **Expected Result**: Correct pagination on page 2.

### TC-10-P03: Filter Notifications by Read Status
- **Priority**: Medium
- **Preconditions**: Both read and unread notifications exist.
- **Test Data**: `isRead=false`
- **Steps**:
  1. Send GET /api/notifications?isRead=false.
  2. Verify all returned notifications have `isRead: false`.
- **Expected Result**: Only unread notifications returned.

### TC-10-P04: Filter Notifications by Date Period
- **Priority**: Low
- **Preconditions**: Notifications from the past week exist.
- **Test Data**: `period=week`
- **Steps**:
  1. Send GET /api/notifications?period=week.
  2. Verify all returned notifications are from the past 7 days.
- **Expected Result**: Only recent notifications returned.

### TC-10-P05: Get Unread Notification Count
- **Priority**: High
- **Preconditions**: At least one unread notification exists.
- **Test Data**: None.
- **Steps**:
  1. Send GET /api/notifications/unread-count.
  2. Verify response: `{ count: N }` where N >= 0.
- **Expected Result**: Integer count of unread notifications.

### TC-10-P06: Mark Notification as Read
- **Priority**: High
- **Preconditions**: At least one unread notification exists.
- **Test Data**: Valid notification ID.
- **Steps**:
  1. Get unread notifications via GET /api/notifications?isRead=false.
  2. Pick the first notification ID.
  3. Send PUT /api/notifications/{id}/read.
  4. Verify response: `{ success: true }`.
  5. Send GET /api/notifications and verify the notification now has `isRead: true`.
- **Expected Result**: Notification marked as read.

### TC-10-P07: Mark Notification as Unread
- **Priority**: Medium
- **Preconditions**: At least one read notification exists.
- **Test Data**: Valid notification ID of a read notification.
- **Steps**:
  1. Get read notifications via GET /api/notifications?isRead=true.
  2. Pick a notification ID.
  3. Send PUT /api/notifications/{id}/unread.
  4. Verify response: `{ success: true }`.
  5. Verify the notification now has `isRead: false`.
- **Expected Result**: Notification marked as unread.

### TC-10-P08: Mark All Notifications as Read
- **Priority**: High
- **Preconditions**: Multiple unread notifications exist.
- **Test Data**: None.
- **Steps**:
  1. Verify unread-count > 0 via GET /api/notifications/unread-count.
  2. Send PUT /api/notifications/mark-all-read.
  3. Verify response: `{ success: true }`.
  4. Verify unread-count is now 0.
- **Expected Result**: All visible notifications marked as read.

### TC-10-P09: Bulk Mark Notifications as Read
- **Priority**: Medium
- **Preconditions**: At least 3 unread notifications exist.
- **Test Data**: Array of 3 notification IDs.
- **Steps**:
  1. Get 3 unread notification IDs.
  2. Send PUT /api/notifications/bulk-read with `{ "ids": ["id1", "id2", "id3"] }`.
  3. Verify response: `{ success: true, count: 3 }`.
- **Expected Result**: All 3 notifications marked as read.

### TC-10-P10: Bulk Mark Notifications as Unread
- **Priority**: Medium
- **Preconditions**: At least 2 read notifications exist.
- **Test Data**: Array of 2 notification IDs.
- **Steps**:
  1. Get 2 read notification IDs.
  2. Send PUT /api/notifications/bulk-unread with `{ "ids": ["id1", "id2"] }`.
  3. Verify response: `{ success: true, count: 2 }`.
- **Expected Result**: Both notifications marked as unread.

### TC-10-P11: Delete a Single Notification
- **Priority**: High
- **Preconditions**: At least one notification exists.
- **Test Data**: Valid notification ID.
- **Steps**:
  1. Get a notification ID from GET /api/notifications.
  2. Send DELETE /api/notifications/{id}.
  3. Verify response: `{ success: true }`.
  4. Verify the notification no longer appears in the list.
- **Expected Result**: Notification permanently deleted.

### TC-10-P12: Bulk Delete Notifications (NOTIFICATION_MANAGE)
- **Priority**: High
- **Preconditions**: Authenticated user with NOTIFICATION_MANAGE permission (SUPER_ADMIN). At least 3 notifications exist.
- **Test Data**: Array of 3 notification IDs.
- **Steps**:
  1. Get 3 notification IDs.
  2. Send POST /api/notifications/bulk-delete with `{ "ids": ["id1", "id2", "id3"] }`.
  3. Verify response: `{ success: true, count: 3 }`.
- **Expected Result**: All 3 notifications deleted.

### TC-10-P13: Role-Based Filtering -- SUPER_ADMIN Sees All
- **Priority**: High
- **Preconditions**: Notifications exist for multiple roles/users.
- **Test Data**: None.
- **Steps**:
  1. Login as SUPER_ADMIN.
  2. Send GET /api/notifications.
  3. Verify all notifications across all roles are visible.
- **Expected Result**: SUPER_ADMIN sees complete notification list.

### TC-10-P14: Filter Notifications by Custom Date Range
- **Priority**: Low
- **Preconditions**: Notifications exist across multiple days.
- **Test Data**: `startDate=2026-03-01T00:00:00Z&endDate=2026-03-05T23:59:59Z`
- **Steps**:
  1. Send GET /api/notifications?startDate=2026-03-01T00:00:00Z&endDate=2026-03-05T23:59:59Z.
  2. Verify all returned notifications are within the date range.
- **Expected Result**: Only notifications within range returned.

---

## Negative Test Cases

### TC-10-N01: Mark Non-Existent Notification as Read
- **Priority**: Medium
- **Preconditions**: Authenticated user.
- **Test Data**: Non-existent notification ID (e.g., "00000000-0000-0000-0000-000000000000").
- **Steps**:
  1. Send PUT /api/notifications/00000000-0000-0000-0000-000000000000/read.
  2. Verify response is 404 or error.
- **Expected Result**: Error response (notification not found).

### TC-10-N02: Mark Non-Existent Notification as Unread
- **Priority**: Medium
- **Preconditions**: Authenticated user.
- **Test Data**: Non-existent notification ID.
- **Steps**:
  1. Send PUT /api/notifications/00000000-0000-0000-0000-000000000000/unread.
  2. Verify error response.
- **Expected Result**: Error response.

### TC-10-N03: Bulk Delete Without NOTIFICATION_MANAGE Permission
- **Priority**: High
- **Preconditions**: Authenticated as OPERATOR (no NOTIFICATION_MANAGE permission).
- **Test Data**: `{ "ids": ["valid-id"] }`
- **Steps**:
  1. Send POST /api/notifications/bulk-delete as OPERATOR.
  2. Verify 403 Forbidden.
- **Expected Result**: 403 error.

### TC-10-N04: Delete Non-Existent Notification
- **Priority**: Medium
- **Preconditions**: Authenticated user.
- **Test Data**: Non-existent notification ID.
- **Steps**:
  1. Send DELETE /api/notifications/00000000-0000-0000-0000-000000000000.
  2. Verify error response.
- **Expected Result**: Error response (404 or similar).

### TC-10-N05: Access Notifications Without Authentication
- **Priority**: High
- **Preconditions**: No auth token.
- **Test Data**: None.
- **Steps**:
  1. Send GET /api/notifications without Authorization header.
  2. Verify 401.
- **Expected Result**: 401 Unauthorized.

### TC-10-N06: Bulk Read with Empty IDs Array
- **Priority**: Low
- **Preconditions**: Authenticated user.
- **Test Data**: `{ "ids": [] }`
- **Steps**:
  1. Send PUT /api/notifications/bulk-read with `{ "ids": [] }`.
  2. Verify 400 validation error (minItems: 1).
- **Expected Result**: 400 validation error.

### TC-10-N07: Bulk Unread with Empty IDs Array
- **Priority**: Low
- **Preconditions**: Authenticated user.
- **Test Data**: `{ "ids": [] }`
- **Steps**:
  1. Send PUT /api/notifications/bulk-unread with `{ "ids": [] }`.
  2. Verify 400 validation error (minItems: 1).
- **Expected Result**: 400 validation error.

---

## Email & SMS Delivery Test Cases

### TC-10-P15: Email Notification on User Login
- **Priority**: High
- **Preconditions**: Email configured (OAuth2), notification rule active with USER_LOGIN event type, email channel enabled.
- **Steps**:
  1. Login to application via browser.
  2. Check notification_logs table for EMAIL entry with status SENT.
  3. Verify email received at recipient inbox.
- **Expected Result**: Email sent with User Login details (username, role, IP, timestamp).

### TC-10-P16: SMS Notification on User Login
- **Priority**: High
- **Preconditions**: SMS configured (AWS SNS), notification rule active with USER_LOGIN, SMS enabled, recipient phone in system_config.
- **Steps**:
  1. Login to application.
  2. Check notification_logs for SMS entry with status SENT.
  3. Verify SMS received on phone.
- **Expected Result**: SMS with "DigiLog User Login: {username}" and details.

### TC-10-P17: Email Notification on Alarm Created
- **Priority**: High
- **Preconditions**: Email configured, notification rule with ALARM_CREATED.
- **Steps**:
  1. Trigger an alarm via telemetry ingestion or rule chain.
  2. Check notification_logs for EMAIL entry.
  3. Verify email with alarm details (type, severity, entity, trigger condition).
- **Expected Result**: Email sent with alarm-specific details table.

### TC-10-P18: SMS Notification on Alarm Created
- **Priority**: High
- **Preconditions**: SMS configured, notification rule with ALARM_CREATED, SMS enabled.
- **Steps**:
  1. Trigger an alarm.
  2. Check notification_logs for SMS entry.
- **Expected Result**: SMS with alarm details in plain text.

### TC-10-P19: Dynamic Template Adapts per Event Type
- **Priority**: High
- **Preconditions**: "All Events (Combined)" template assigned to rule.
- **Steps**:
  1. Trigger USER_LOGIN - verify email shows user fields only.
  2. Trigger ALARM_CREATED - verify email shows alarm fields only.
  3. Trigger DEVICE_OFFLINE - verify email shows device fields only.
- **Expected Result**: Same template, different details per event type.

### TC-10-P20: Test Email Button
- **Priority**: High
- **Steps**:
  1. Go to Notification Settings then Email.
  2. Enter recipient email and click Send Test.
  3. Verify email received.
- **Expected Result**: Test email arrives within seconds.

### TC-10-P21: Test SMS Button
- **Priority**: High
- **Steps**:
  1. Go to Notification Settings then SMS.
  2. Enter verified phone number and click Send Test.
  3. Verify SMS received.
- **Expected Result**: Test SMS arrives (number must be verified in sandbox).

### TC-10-N08: Email with Wrong Credentials
- **Priority**: Medium
- **Steps**:
  1. Set authType to basic with wrong password.
  2. Trigger notification.
  3. Check notification_logs.
- **Expected Result**: Status FAILED with "Authentication unsuccessful" error.

### TC-10-N09: SMS to Unverified Number (Sandbox)
- **Priority**: Medium
- **Steps**:
  1. Set recipient phone to unverified number.
  2. Trigger notification.
- **Expected Result**: Status SENT (AWS accepts) but SMS not delivered.


---

## Phase 2 Notes

- Notification delivery channels (in-app, email, SMS, Telegram, Slack) support Phase 2 filter events.
- Filter-related notification events: FILTER_CYCLE_STARTED, FILTER_CYCLE_COMPLETED, FILTER_STAGE_BYPASSED, PM_SCHEDULE_DUE.
- Notification rules can be configured to trigger on filter operation events.

