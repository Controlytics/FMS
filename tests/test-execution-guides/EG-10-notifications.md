# EG-10: Notifications -- Execution Guide

## Prerequisites
- **App URL**: http://34.232.224.0
- **API Base**: http://localhost:3000/api
- **SUPER_ADMIN Credentials**: superadmin / Admin@123
- **Additional User**: An OPERATOR or ADMIN user for role-filtering tests
- **Browser**: Chrome or Firefox with DevTools open

## Setup: Obtain Auth Token

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq -r '.token')
```

---

## Test Execution

### Test: TC-10-P01 -- List Notifications with Default Pagination

**API (curl):**
```bash
curl -s -X GET http://localhost:3000/api/notifications \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
```json
{
  "data": [
    {
      "id": "uuid-here",
      "type": "ALARM",
      "title": "High Temperature Alert",
      "message": "Temperature exceeded threshold on Reactor-01",
      "isRead": false,
      "readAt": null,
      "createdAt": "2026-03-05T10:00:00.000Z"
    }
  ],
  "total": 15,
  "unreadCount": 8,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

**Browser Steps:**
1. Navigate to http://34.232.224.0/notifications.
2. Verify notification list displays with items.
3. Check badge count in sidebar matches `unreadCount`.

**Pass/Fail:**
- [ ] Response status 200
- [ ] `data` is array with notification objects
- [ ] Each has id, type, title, message, isRead, createdAt
- [ ] `unreadCount` matches number of unread items

---

### Test: TC-10-P05 -- Get Unread Notification Count

**API (curl):**
```bash
curl -s -X GET http://localhost:3000/api/notifications/unread-count \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
```json
{
  "count": 8
}
```

**Pass/Fail:**
- [ ] Response has `count` as integer >= 0

---

### Test: TC-10-P06 -- Mark Notification as Read

**API (curl):**
```bash
# Get an unread notification ID
NOTIF_ID=$(curl -s -X GET "http://localhost:3000/api/notifications?isRead=false&limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')

echo "Marking as read: $NOTIF_ID"

# Mark as read
curl -s -X PUT "http://localhost:3000/api/notifications/$NOTIF_ID/read" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Verify
curl -s -X GET http://localhost:3000/api/notifications \
  -H "Authorization: Bearer $TOKEN" | jq ".data[] | select(.id == \"$NOTIF_ID\") | .isRead"
```

**Expected Result:**
- Mark returns `{ "success": true }`
- Subsequent query shows `isRead: true`

**Pass/Fail:**
- [ ] Mark read returns success: true
- [ ] Notification now shows isRead: true

---

### Test: TC-10-P07 -- Mark Notification as Unread

**API (curl):**
```bash
# Use the same NOTIF_ID from P06 (now read)
curl -s -X PUT "http://localhost:3000/api/notifications/$NOTIF_ID/unread" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- Returns `{ "success": true }`
- Notification reverts to `isRead: false`

**Pass/Fail:**
- [ ] Mark unread returns success: true
- [ ] unread-count incremented

---

### Test: TC-10-P08 -- Mark All Notifications as Read

**API (curl):**
```bash
# Check unread count before
curl -s -X GET http://localhost:3000/api/notifications/unread-count \
  -H "Authorization: Bearer $TOKEN" | jq .

# Mark all read
curl -s -X PUT http://localhost:3000/api/notifications/mark-all-read \
  -H "Authorization: Bearer $TOKEN" | jq .

# Check unread count after
curl -s -X GET http://localhost:3000/api/notifications/unread-count \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- Mark all returns `{ "success": true }`
- Unread count drops to 0

**Pass/Fail:**
- [ ] mark-all-read returns success: true
- [ ] Unread count becomes 0

---

### Test: TC-10-P09 -- Bulk Mark Notifications as Read

**API (curl):**
```bash
# Get 3 notification IDs
IDS=$(curl -s -X GET "http://localhost:3000/api/notifications?limit=3" \
  -H "Authorization: Bearer $TOKEN" | jq '[.data[].id]')

echo "Bulk read IDs: $IDS"

curl -s -X PUT http://localhost:3000/api/notifications/bulk-read \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"ids\": $IDS}" | jq .
```

**Expected Result:**
```json
{
  "success": true,
  "count": 3
}
```

**Pass/Fail:**
- [ ] success: true
- [ ] count matches number of IDs

---

### Test: TC-10-P10 -- Bulk Mark Notifications as Unread

**API (curl):**
```bash
curl -s -X PUT http://localhost:3000/api/notifications/bulk-unread \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"ids\": $IDS}" | jq .
```

**Expected Result:**
```json
{
  "success": true,
  "count": 3
}
```

**Pass/Fail:**
- [ ] success: true
- [ ] count matches number of IDs

---

### Test: TC-10-P11 -- Delete a Single Notification

**API (curl):**
```bash
NOTIF_ID=$(curl -s -X GET "http://localhost:3000/api/notifications?limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')

curl -s -X DELETE "http://localhost:3000/api/notifications/$NOTIF_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
```json
{
  "success": true
}
```

**Pass/Fail:**
- [ ] success: true
- [ ] Notification no longer in list

---

### Test: TC-10-P12 -- Bulk Delete Notifications

**API (curl):**
```bash
IDS=$(curl -s -X GET "http://localhost:3000/api/notifications?limit=3" \
  -H "Authorization: Bearer $TOKEN" | jq '[.data[].id]')

curl -s -X POST http://localhost:3000/api/notifications/bulk-delete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"ids\": $IDS}" | jq .
```

**Expected Result:**
```json
{
  "success": true,
  "count": 3
}
```

**Pass/Fail:**
- [ ] success: true
- [ ] count matches IDs count

---

### Test: TC-10-N01 -- Mark Non-Existent Notification as Read

**API (curl):**
```bash
curl -s -X PUT "http://localhost:3000/api/notifications/00000000-0000-0000-0000-000000000000/read" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- 404 or error response

**Pass/Fail:**
- [ ] Response indicates notification not found

---

### Test: TC-10-N03 -- Bulk Delete Without NOTIFICATION_MANAGE Permission

**API (curl):**
```bash
OP_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"operator1","password":"YourPassword123"}' | jq -r '.token')

curl -s -X POST http://localhost:3000/api/notifications/bulk-delete \
  -H "Authorization: Bearer $OP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ids": ["some-id"]}' | jq .
```

**Expected Result:**
- 403 Forbidden

**Pass/Fail:**
- [ ] Response status 403

---

### Test: TC-10-N05 -- Access Notifications Without Authentication

**API (curl):**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/notifications
```

**Expected Result:**
- 401

**Pass/Fail:**
- [ ] Response status 401

---

### Test: TC-10-N06 -- Bulk Read with Empty IDs Array

**API (curl):**
```bash
curl -s -X PUT http://localhost:3000/api/notifications/bulk-read \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ids": []}' | jq .
```

**Expected Result:**
- 400 validation error

**Pass/Fail:**
- [ ] Response status 400
- [ ] Error indicates minItems violation

---

## Email & SMS Delivery Tests

### Test: TC-10-P15 -- Email on User Login

```bash
# Login and check logs
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123","force":true}' > /dev/null

sleep 5

PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db \
  -c "SELECT status, channel, recipient, created_at FROM notification_logs ORDER BY created_at DESC LIMIT 5"
```

**Pass/Fail:**
- [ ] EMAIL entry with status SENT
- [ ] Email received in inbox

### Test: TC-10-P20 -- Test Email Button

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123","force":true}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s -X POST http://localhost:3000/api/notification-settings/email/test \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"recipient":"your-email@example.com"}'
```

### Test: TC-10-P21 -- Test SMS Button

```bash
curl -s -X POST http://localhost:3000/api/notification-settings/sms/test \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"recipient":"+917288820570"}'
```

### Checking Notification Delivery Logs

```bash
PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db \
  -c "SELECT id, channel, status, recipient, error_message, retry_count, created_at
      FROM notification_logs ORDER BY created_at DESC LIMIT 20"
```


> **Phase 2 (Digital FMS):** Notification rules can trigger on filter events: FILTER_CYCLE_STARTED, FILTER_CYCLE_COMPLETED, FILTER_STAGE_BYPASSED, PM_SCHEDULE_DUE. All delivery channels supported.

