# TC-20: Help Articles — Test Cases

## Overview
- **Module**: Help Article Management
- **API Endpoints**: 6 (GET /, GET /:key, POST /, PUT /:id, DELETE /:id, GET /:id/versions)
- **Frontend Pages**: /config/help
- **Permissions**: Any authenticated user (list, get by key), SUPER_ADMIN (create, update, delete), SUPER_ADMIN/ADMIN (versions)
- **Reauth Actions**: CREATE_HELP_ARTICLE, UPDATE_HELP_ARTICLE, DELETE_HELP_ARTICLE
- **Prefix**: /api/help

---

## Positive Test Cases

### TC-20-P01: List All Help Articles
- **Priority**: High
- **Preconditions**: Logged in (any role), seed data includes 40+ help articles (28 Phase 1 + Phase 2 filter management articles)
- **Test Data**: None
- **Steps**:
  1. Send GET /api/help
  2. Verify response status is 200
  3. Verify response is an array of articles
  4. Verify each article has id, key, title, category, sortOrder, currentVersion, updatedAt
  5. Verify articles are ordered by category ASC then sortOrder ASC
  6. Verify only active articles are returned (isActive=true)
- **Expected Result**: 200 OK with array of active help articles sorted by category and order

### TC-20-P02: Filter Articles by Category
- **Priority**: Medium
- **Preconditions**: Articles exist with various categories
- **Test Data**: `?category=Configuration`
- **Steps**:
  1. Send GET /api/help?category=Configuration
  2. Verify response status is 200
  3. Verify all returned articles have category "Configuration"
  4. Verify no articles from other categories are included
- **Expected Result**: 200 OK with only articles matching the specified category

### TC-20-P03: Search Articles by Keyword
- **Priority**: Medium
- **Preconditions**: Articles exist with various titles and content
- **Test Data**: `?search=password`
- **Steps**:
  1. Send GET /api/help?search=password
  2. Verify response status is 200
  3. Verify all returned articles contain "password" in either title or content (case-insensitive)
- **Expected Result**: 200 OK with articles matching the search term in title or content

### TC-20-P04: Get Article by Key
- **Priority**: High
- **Preconditions**: Article with key "getting-started" exists (or any known key from seed data)
- **Test Data**: Known article key
- **Steps**:
  1. Send GET /api/help/getting-started
  2. Verify response status is 200
  3. Verify response contains id, key, title, content, category, currentVersion, updatedAt
  4. Verify `content` field contains the article body (markdown/HTML)
  5. Verify `key` matches the URL parameter
- **Expected Result**: 200 OK with full article including content

### TC-20-P05: Create New Help Article
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**:
  ```json
  {
    "key": "test-article-manual",
    "title": "Manual Test Article",
    "content": "This is a test article created during manual testing.\n\n## Section 1\nContent here.",
    "category": "Testing",
    "sortOrder": 10
  }
  ```
- **Steps**:
  1. Send POST /api/help with the article body (reauth may be required)
  2. Verify response status is 201
  3. Verify response contains id, key, title, content, category, sortOrder, currentVersion=1, isActive=true
  4. Verify createdAt and updatedAt timestamps are present
  5. Verify the article appears in GET /api/help list
  6. Verify GET /api/help/test-article-manual returns the article
- **Expected Result**: 201 Created with new article, currentVersion=1, isActive=true

### TC-20-P06: Update Help Article
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN, article from TC-20-P05 exists
- **Test Data**:
  ```json
  {
    "title": "Manual Test Article (Updated)",
    "content": "Updated content for the manual test article.\n\n## Section 1 Revised\nNew content.",
    "changeNotes": "Updated title and content for testing"
  }
  ```
- **Steps**:
  1. Get the article id from TC-20-P05
  2. Send PUT /api/help/:id with updated fields (reauth may be required)
  3. Verify response status is 200
  4. Verify `title` is updated
  5. Verify `content` is updated
  6. Verify `currentVersion` incremented to 2
  7. Verify `updatedAt` changed
- **Expected Result**: 200 OK with updated article, version incremented to 2

### TC-20-P07: Verify Version History After Updates
- **Priority**: High
- **Preconditions**: Article updated at least once (TC-20-P06)
- **Test Data**: Article ID
- **Steps**:
  1. Send GET /api/help/:id/versions
  2. Verify response status is 200
  3. Verify response is an array with at least 2 versions
  4. Verify versions are ordered by version DESC
  5. Verify version 2 has `changedBy` = "admin" and `changeNotes` matching TC-20-P06
  6. Verify version 1 has `changeNotes` = "Initial version"
  7. Verify each version has id, helpArticleId, version, content, changedBy, changeNotes, createdAt
- **Expected Result**: 200 OK with version history showing all snapshots in descending order

### TC-20-P08: Soft Delete Help Article
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN, article from TC-20-P05 exists
- **Test Data**: Article ID
- **Steps**:
  1. Send DELETE /api/help/:id (reauth may be required)
  2. Verify response status is 200
  3. Verify response contains `deleted: true`
  4. Send GET /api/help to verify the article no longer appears in the list
  5. Send GET /api/help/test-article-manual to verify 404
  6. Verify article still exists in DB with isActive=false (soft delete)
- **Expected Result**: 200 OK, article soft-deleted (isActive=false), no longer appears in public queries

### TC-20-P09: Update Article Category and Sort Order
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN, article exists
- **Test Data**:
  ```json
  {
    "category": "Advanced Topics",
    "sortOrder": 99,
    "changeNotes": "Moved to Advanced Topics category"
  }
  ```
- **Steps**:
  1. Send PUT /api/help/:id with category and sortOrder changes
  2. Verify response contains updated category and sortOrder
  3. Verify version incremented
  4. Verify article now appears under the new category in GET /api/help?category=Advanced%20Topics
- **Expected Result**: 200 OK with updated category/sortOrder, version incremented

### TC-20-P10: Deactivate and Reactivate Article
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN, active article exists
- **Test Data**: `{ "isActive": false, "changeNotes": "Temporarily disabled" }`
- **Steps**:
  1. Send PUT /api/help/:id with isActive=false
  2. Verify article no longer appears in GET /api/help list
  3. Send PUT /api/help/:id with isActive=true
  4. Verify article reappears in GET /api/help list
  5. Verify version incremented twice (once per update)
- **Expected Result**: Article can be toggled active/inactive via PUT, each toggle increments version

---

## Negative Test Cases

### TC-20-N01: Create Article with Duplicate Key
- **Priority**: High
- **Preconditions**: Article with key "getting-started" exists
- **Test Data**:
  ```json
  {
    "key": "getting-started",
    "title": "Duplicate Key Test",
    "content": "This should fail.",
    "category": "Test"
  }
  ```
- **Steps**:
  1. Send POST /api/help with a key that already exists
  2. Verify response status is 409
  3. Verify error message indicates key already exists
- **Expected Result**: 409 Conflict — "Help article with key \"getting-started\" already exists"

### TC-20-N02: Create Article Without SUPER_ADMIN Role
- **Priority**: High
- **Preconditions**: Logged in as ADMIN or OPERATOR
- **Test Data**: Valid article body
- **Steps**:
  1. Send POST /api/help with non-SUPER_ADMIN token
  2. Verify response status is 403
- **Expected Result**: 403 Forbidden — only SUPER_ADMIN can create articles

### TC-20-N03: Get Non-Existent Article Key
- **Priority**: Medium
- **Preconditions**: Logged in (any role)
- **Test Data**: Key "non-existent-key-xyz"
- **Steps**:
  1. Send GET /api/help/non-existent-key-xyz
  2. Verify response status is 404
  3. Verify error indicates article not found
- **Expected Result**: 404 Not Found — "Help article not found"

### TC-20-N04: Update Non-Existent Article
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: Non-existent UUID
- **Steps**:
  1. Send PUT /api/help/00000000-0000-0000-0000-000000000000 with `{ "title": "Test" }`
  2. Verify response status is 404
- **Expected Result**: 404 Not Found — "Help article not found"

### TC-20-N05: Delete Non-Existent Article
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: Non-existent UUID
- **Steps**:
  1. Send DELETE /api/help/00000000-0000-0000-0000-000000000000
  2. Verify response status is 404
- **Expected Result**: 404 Not Found — "Help article not found"

### TC-20-N06: Create Article with Missing Required Fields
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: `{ "key": "incomplete" }` (missing title, content, category)
- **Steps**:
  1. Send POST /api/help with incomplete body
  2. Verify response status is 400
  3. Verify error lists missing required fields
- **Expected Result**: 400 Bad Request — schema validation fails for missing required properties

### TC-20-N07: Access Version History Without Admin Role
- **Priority**: Medium
- **Preconditions**: Logged in as OPERATOR
- **Test Data**: Valid article ID
- **Steps**:
  1. Send GET /api/help/:id/versions with OPERATOR token
  2. Verify response status is 403
- **Expected Result**: 403 Forbidden — version history requires SUPER_ADMIN or ADMIN role


---

## Phase 2 Notes

- Help articles expanded from 28 to 40+ with Phase 2 content covering cleaning profiles, filter operations, pipeline visual editor, PM schedules, checklist profiles, and equipment groups.
- New article categories include "Filter Management", "Cleaning Operations", and "Preventive Maintenance".
- All articles use the same versioning system with changeNotes tracking.


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
