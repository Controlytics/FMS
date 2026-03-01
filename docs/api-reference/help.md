# Help Articles API

The Help Articles API provides endpoints for managing context-sensitive help content. Articles support versioning and are organized by category.

---

## Read Articles

### GET /api/help

List all active help articles, optionally filtered by category or search term.

```bash
GET /api/help?category=Getting+Started&search=template
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `category` | string | Filter by category |
| `search` | string | Search in title and content |

**Response (200):**
```json
[
  {
    "id": "article-uuid",
    "key": "entity-templates",
    "title": "Working with Entity Templates",
    "category": "Getting Started",
    "sortOrder": 2,
    "currentVersion": 3,
    "updatedAt": "2026-03-01T10:00:00Z"
  }
]
```

**Available to all authenticated users.**

---

### GET /api/help/:key

Get a single article by its unique context key.

```bash
GET /api/help/entity-templates
```

**Response (200):**
```json
{
  "id": "article-uuid",
  "key": "entity-templates",
  "title": "Working with Entity Templates",
  "content": "## Overview\n\nEntity templates define...",
  "category": "Getting Started",
  "currentVersion": 3,
  "updatedAt": "2026-03-01T10:00:00Z"
}
```

---

## Manage Articles

### POST /api/help

Create a new help article with an initial version snapshot.

```bash
curl -X POST "http://your-server/api/help" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "data-ingestion",
    "title": "Data Ingestion Guide",
    "content": "## Sending Telemetry\n\nUse the device access token...",
    "category": "User Guide",
    "sortOrder": 5
  }'
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | Yes | Unique context key (max 100 chars) |
| `title` | string | Yes | Article title (max 200 chars) |
| `content` | string | Yes | Article content (markdown/HTML) |
| `category` | string | Yes | Category name (max 50 chars) |
| `sortOrder` | integer | No | Sort order within category (default: 0) |

**Role Required:** `SUPER_ADMIN`

---

### PUT /api/help/:id

Update a help article. Creates a new version snapshot.

```bash
curl -X PUT "http://your-server/api/help/ARTICLE_UUID" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "## Updated Content\n\nNew information...",
    "changeNotes": "Added MQTT examples"
  }'
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `title` | string | Updated title |
| `content` | string | Updated content |
| `category` | string | Updated category |
| `sortOrder` | integer | Updated sort order |
| `isActive` | boolean | Enable/disable the article |
| `changeNotes` | string | Description of the change (max 200 chars) |

**Role Required:** `SUPER_ADMIN`

---

### DELETE /api/help/:id

Soft-delete a help article (sets `isActive=false`).

**Role Required:** `SUPER_ADMIN`

---

## Version History

### GET /api/help/:id/versions

Get all version snapshots for an article, ordered by version descending.

```bash
GET /api/help/ARTICLE_UUID/versions
```

**Response (200):**
```json
[
  {
    "id": "version-uuid",
    "helpArticleId": "article-uuid",
    "version": 3,
    "content": "## Updated Content...",
    "changedBy": "admin",
    "changeNotes": "Added MQTT examples",
    "createdAt": "2026-03-01T10:00:00Z"
  },
  {
    "id": "version-uuid-2",
    "version": 2,
    "content": "## Previous Content...",
    "changedBy": "admin",
    "changeNotes": "Fixed typo",
    "createdAt": "2026-02-15T14:00:00Z"
  }
]
```

**Role Required:** `SUPER_ADMIN` or `ADMIN`

---

## Next Steps

- [System Configuration](configuration.md) — System settings
- [User Management](users.md) — User operations
