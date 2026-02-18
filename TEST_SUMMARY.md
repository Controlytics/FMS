# DigiLog Test Summary

**Date:** 2026-02-17
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
- Create / Edit / Delete nodes: **PASS**
- Template CRUD + versioning: **PASS**
- Physical identifiers: **PASS**

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

## Part B: Issues Found and Fixed

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Hardcoded `z.enum()` rejected custom roles (e.g., "QA") | HIGH | FIXED — Changed to `z.string()` |
| 2 | Backend `CREATABLE_ROLES` hardcoded, blocked custom role assignment | HIGH | FIXED — Dynamic DB lookup |
| 3 | SWR cache not invalidated for `/api/roles/active` when roles created | MEDIUM | FIXED — Global mutate with filter |
| 4 | Role privileges page used hardcoded `ROLES` constant | MEDIUM | FIXED — Dynamic API fetch |
| 5 | Role privileges page served stale cache (revalidateOnFocus: false) | MEDIUM | FIXED — `revalidateOnMount: true`, `dedupingInterval: 0` |
| 6 | Missing Action Re-authentication config page | FEATURE | FIXED — Full implementation |
| 7 | Missing Audit Text Templates config page | FEATURE | FIXED — Full implementation |
| 8 | Missing Pagination Settings config page | FEATURE | FIXED — Full implementation |

---

## Summary

All core features are functional and tested. The application is deployed and running on EC2. Dynamic role management is fully supported end-to-end (creation, assignment, privileges, dropdowns). Three new configuration features (Action Re-authentication, Audit Text Templates, Pagination Settings) have been added to match the user management application's feature set.
