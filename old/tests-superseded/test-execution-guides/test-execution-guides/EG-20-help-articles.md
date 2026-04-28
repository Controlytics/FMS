# EG-20: Help Articles — Execution Guide

## Prerequisites
- **Credentials**: SUPER_ADMIN (superadmin / Admin@123), secondary non-SUPER_ADMIN account
- **Tools**: curl, jq, browser
- **Setup**: Seed data includes 40+ help articles (28 Phase 1 + Phase 2 filter management)
- **Base URL**: http://localhost:3000

## Authentication Setup
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq -r '.token')

echo "Token: $TOKEN"
```

---

## Test Execution

### Test: TC-20-P01 — List All Help Articles

**Browser Steps:**
1. Navigate to http://34.232.224.0/config/help
2. Verify articles are displayed grouped by category
3. Verify articles appear sorted by category then sort order

**API (curl):**
```bash
curl -s -X GET http://localhost:3000/api/help \
  -H "Authorization: Bearer $TOKEN" | jq '.[0:5]'

# Count total articles
curl -s -X GET http://localhost:3000/api/help \
  -H "Authorization: Bearer $TOKEN" | jq 'length'
```

**Expected Result:**
- Array of articles with id, key, title, category, sortOrder, currentVersion, updatedAt
- Sorted by category ASC, sortOrder ASC

**Pass/Fail:**
- [ ] Response status is 200
- [ ] Response is an array
- [ ] Articles have all expected fields
- [ ] Sorted correctly

---

### Test: TC-20-P02 — Filter by Category

**API (curl):**
```bash
# List categories first
curl -s -X GET http://localhost:3000/api/help \
  -H "Authorization: Bearer $TOKEN" | jq '[.[].category] | unique'

# Filter by a specific category
curl -s -X GET "http://localhost:3000/api/help?category=Configuration" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Pass/Fail:**
- [ ] All returned articles have the specified category
- [ ] No articles from other categories included

---

### Test: TC-20-P03 — Search by Keyword

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/help?search=password" \
  -H "Authorization: Bearer $TOKEN" | jq '.[].title'
```

**Pass/Fail:**
- [ ] Results contain "password" in title or content (case-insensitive)

---

### Test: TC-20-P04 — Get Article by Key

**API (curl):**
```bash
# Get a known article key from the list
FIRST_KEY=$(curl -s -X GET http://localhost:3000/api/help \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].key')

echo "First key: $FIRST_KEY"

curl -s -X GET "http://localhost:3000/api/help/$FIRST_KEY" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- 200 OK with full article including content field

**Pass/Fail:**
- [ ] Response includes content field
- [ ] key matches URL parameter

---

### Test: TC-20-P05 — Create New Help Article

**API (curl):**
```bash
# Create article (may trigger reauth dialog in browser)
CREATED=$(curl -s -X POST http://localhost:3000/api/help \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "test-article-manual",
    "title": "Manual Test Article",
    "content": "This is a test article.\n\n## Section 1\nTest content.",
    "category": "Testing",
    "sortOrder": 10
  }')

echo "$CREATED" | jq .

# Save the article ID
ARTICLE_ID=$(echo "$CREATED" | jq -r '.id')
echo "Article ID: $ARTICLE_ID"
```

**Expected Result:**
- API: 201 Created
  ```json
  {
    "id": "<uuid>",
    "key": "test-article-manual",
    "title": "Manual Test Article",
    "content": "This is a test article...",
    "category": "Testing",
    "sortOrder": 10,
    "currentVersion": 1,
    "isActive": true,
    "createdAt": "...",
    "updatedAt": "..."
  }
  ```

**Pass/Fail:**
- [ ] Response status is 201
- [ ] currentVersion is 1
- [ ] isActive is true
- [ ] Article appears in GET /api/help list

---

### Test: TC-20-P06 — Update Help Article

**API (curl):**
```bash
curl -s -X PUT "http://localhost:3000/api/help/$ARTICLE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Manual Test Article (Updated)",
    "content": "Updated content.\n\n## Revised Section\nNew content here.",
    "changeNotes": "Updated for testing"
  }' | jq .
```

**Expected Result:**
- 200 OK with title updated, currentVersion=2

**Pass/Fail:**
- [ ] title is "Manual Test Article (Updated)"
- [ ] currentVersion is 2
- [ ] updatedAt changed

---

### Test: TC-20-P07 — Verify Version History

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/help/$ARTICLE_ID/versions" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- Array of 2 versions
  ```json
  [
    { "version": 2, "changedBy": "admin", "changeNotes": "Updated for testing", ... },
    { "version": 1, "changedBy": "admin", "changeNotes": "Initial version", ... }
  ]
  ```

**Pass/Fail:**
- [ ] 2 versions returned
- [ ] Ordered by version DESC
- [ ] Version 1 has changeNotes "Initial version"
- [ ] Version 2 has the update changeNotes

---

### Test: TC-20-P08 — Soft Delete Help Article

**API (curl):**
```bash
# Delete
curl -s -X DELETE "http://localhost:3000/api/help/$ARTICLE_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Verify not in list
curl -s -X GET http://localhost:3000/api/help \
  -H "Authorization: Bearer $TOKEN" | jq '[.[] | select(.key == "test-article-manual")]'

# Verify 404 by key
curl -s -o /dev/null -w "%{http_code}" \
  -X GET http://localhost:3000/api/help/test-article-manual \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Result:**
- Delete returns `{ "deleted": true }`
- Article no longer appears in list (isActive=false)
- GET by key returns 404

**Pass/Fail:**
- [ ] Delete returns deleted=true
- [ ] List no longer includes the article
- [ ] GET by key returns 404

---

### Test: TC-20-P09 — Update Category and Sort Order

**API (curl):**
```bash
# Create a fresh article for this test
ARTICLE2=$(curl -s -X POST http://localhost:3000/api/help \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"test-category-move","title":"Category Move Test","content":"Test","category":"General"}')
ARTICLE2_ID=$(echo "$ARTICLE2" | jq -r '.id')

# Update category
curl -s -X PUT "http://localhost:3000/api/help/$ARTICLE2_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"category":"Advanced Topics","sortOrder":99,"changeNotes":"Moved category"}' | jq '{category,sortOrder,currentVersion}'

# Verify in new category
curl -s -X GET "http://localhost:3000/api/help?category=Advanced%20Topics" \
  -H "Authorization: Bearer $TOKEN" | jq '[.[] | select(.key == "test-category-move")]'
```

**Pass/Fail:**
- [ ] Category updated to "Advanced Topics"
- [ ] sortOrder is 99
- [ ] currentVersion incremented

---

### Test: TC-20-P10 — Deactivate and Reactivate

**API (curl):**
```bash
# Deactivate
curl -s -X PUT "http://localhost:3000/api/help/$ARTICLE2_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"isActive":false,"changeNotes":"Disabled"}' | jq '{isActive,currentVersion}'

# Verify not in list
curl -s -X GET http://localhost:3000/api/help \
  -H "Authorization: Bearer $TOKEN" | jq '[.[] | select(.key == "test-category-move")] | length'

# Reactivate
curl -s -X PUT "http://localhost:3000/api/help/$ARTICLE2_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"isActive":true,"changeNotes":"Re-enabled"}' | jq '{isActive,currentVersion}'

# Verify back in list
curl -s -X GET http://localhost:3000/api/help \
  -H "Authorization: Bearer $TOKEN" | jq '[.[] | select(.key == "test-category-move")] | length'
```

**Pass/Fail:**
- [ ] After deactivation, not in list
- [ ] After reactivation, back in list
- [ ] Version incremented twice

---

### Test: TC-20-N01 — Create Duplicate Key

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/help \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"test-category-move","title":"Dup","content":"Dup","category":"Test"}' | jq .
```

**Expected Result:**
- 409 Conflict

**Pass/Fail:**
- [ ] Response status is 409
- [ ] Error mentions key already exists

---

### Test: TC-20-N02 — Create Without SUPER_ADMIN

**API (curl):**
```bash
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin_user","password":"Admin@123"}' | jq -r '.token')

curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:3000/api/help \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"test-no-perm","title":"T","content":"C","category":"X"}'
```

**Expected Result:**
- 403 Forbidden

**Pass/Fail:**
- [ ] Response status is 403

---

### Test: TC-20-N03 — Get Non-Existent Key

**API (curl):**
```bash
curl -s -X GET http://localhost:3000/api/help/non-existent-key-xyz \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- 404 Not Found

**Pass/Fail:**
- [ ] Response status is 404

---

### Test: TC-20-N04 — Update Non-Existent Article

**API (curl):**
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X PUT http://localhost:3000/api/help/00000000-0000-0000-0000-000000000000 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test"}'
```

**Expected Result:**
- 404 Not Found

**Pass/Fail:**
- [ ] Response status is 404

---

### Test: TC-20-N05 — Delete Non-Existent Article

**API (curl):**
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X DELETE http://localhost:3000/api/help/00000000-0000-0000-0000-000000000000 \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Result:**
- 404 Not Found

**Pass/Fail:**
- [ ] Response status is 404

---

### Test: TC-20-N06 — Create with Missing Required Fields

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/help \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key": "incomplete"}' | jq .
```

**Expected Result:**
- 400 Bad Request — missing title, content, category

**Pass/Fail:**
- [ ] Response status is 400
- [ ] Error lists missing fields

---

### Test: TC-20-N07 — Version History Without Admin Role

**API (curl):**
```bash
OP_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"operator_user","password":"Operator@123"}' | jq -r '.token')

curl -s -o /dev/null -w "%{http_code}" \
  -X GET "http://localhost:3000/api/help/$ARTICLE2_ID/versions" \
  -H "Authorization: Bearer $OP_TOKEN"
```

**Expected Result:**
- 403 Forbidden

**Pass/Fail:**
- [ ] Response status is 403

---

## Cleanup
```bash
# Delete test articles
curl -s -X DELETE "http://localhost:3000/api/help/$ARTICLE2_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```


> **Phase 2 (Digital FMS):** 40+ help articles (expanded from 28). New categories: Filter Management, Cleaning Operations, Preventive Maintenance. Same versioning system.


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
