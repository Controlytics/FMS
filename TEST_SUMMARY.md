# DigiLog Test Summary

**Date:** 2026-02-19
**Application:** DigiLog — 21 CFR Part 11 Compliant Digital Logbook
**Deployment:** EC2 at 43.205.32.23 (port 3000 API, nginx frontend)

---

## Part A: Feature Test Results

### User Management
- Login / Logout / Session management: **PASS**
- Create / Edit / Delete users: **PASS**
- Enable / Disable / Unlock accounts: **PASS**
- Password change (forced + voluntary): **PASS**
- Password reset requests: **PASS**
- Dynamic role assignment (custom roles): **PASS**
- User ID format validation: **PASS**

### Asset Management
- Hierarchy tree navigation: **PASS**
- Create / Edit / Delete assets: **PASS**
- Template CRUD + versioning: **PASS**
- Template telemetry schema (create/edit/persist): **PASS**
- Asset telemetry config storage: **PASS**
- Asset detail Telemetry tab: **PASS**
- Physical identifiers: **PASS**
- Multi-select target in Link Assets dialog: **PASS**
- Bulk relationship creation (1 source -> N targets): **PASS**
- Bidirectional relationship auto-creation: **PASS**
- Tree auto-expand after linking: **PASS**
- Hierarchical tree diagram (nodes + arrows): **PASS**
- Auto-navigate to relationships tab after linking: **PASS**
- Link Assets dialog scroll/overflow fix: **PASS**

### Asset Template Editor
- Basic Info section: **PASS**
- Attribute Schema section (9 data types + numeric constraints): **PASS**
- Telemetry Schema section (5 data types + unit + description): **PASS**
- Expected Identifiers section: **PASS**
- Alarm Rules section (7 types + 3 severities): **PASS**
- Template versioning on update: **PASS**

### Configuration
- Password policy settings: **PASS**
- Login security (lockout): **PASS**
- Session timeout settings: **PASS**
- Datetime format settings: **PASS**
- User ID format config: **PASS**
- Branding config: **PASS**
- Role management (create/edit/delete): **PASS**
- Role privileges (per-role permissions): **PASS**
- Field ID names: **PASS**
- Sidebar configuration: **PASS**
- Action re-authentication: **PASS**
- Audit text templates: **PASS**
- Pagination settings: **PASS**
- Backup & restore: **PASS**

### Audit Trail
- Paginated listing with filters: **PASS**
- Detail dialog: **PASS**
- SHA-256 checksum integrity: **PASS**

### Notifications
- List / mark read / unread: **PASS**
- Unread count badge: **PASS**

---

## Part B: Issues Found and Fixed (Session 2026-02-19)

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Instruments feature not working correctly | HIGH | FIXED — Removed entirely per user request |
| 2 | Telemetry section missing from Asset Templates UI | FEATURE | FIXED — Added collapsible Telemetry Schema section |
| 3 | Telemetry tab missing from Asset Explorer detail panel | FEATURE | FIXED — Added Telemetry tab with template schema + instance config |
| 4 | `telemetrySchema` not in Zod schema or API create/update | BUG | FIXED — Added to schemas and API routes |
| 5 | API instance detail missing `telemetrySchema` in template select | BUG | FIXED — Added to Prisma select |
| 6 | Link Assets target was single-select only | FEATURE | FIXED — Multi-select with search, chips, bulk create |
| 7 | Link Assets source/target dropdowns empty | BUG | FIXED — API `parentId` serialized as `""` instead of `null`; frontend `flatAssetList` only matched `null` |

## Part C: Known Issues

| # | Issue | Severity | Notes |
|---|-------|----------|-------|
| — | No known issues | — | All reported issues have been resolved |

---

## Summary

All core features are functional and tested. Asset template telemetry schemas are fully supported end-to-end (create, edit, version, display). Link Assets dialog upgraded to multi-select targets with search and bulk creation. Link Assets dropdown bug fixed — root cause was Fastify JSON schema coercing `null` parentId to empty string, causing frontend tree walk to find no root nodes. Instruments feature was added then removed per user request.
