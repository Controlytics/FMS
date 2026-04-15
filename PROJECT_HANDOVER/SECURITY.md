# Security & Access Control

## Authentication Flow

```
Client -> POST /api/auth/login (username, password)
  -> Server: Find user by username
  -> If authSource=ldap: LDAP bind verification
  -> If authSource=local: BCrypt password comparison
  -> Check account status, lockout, password expiry
  -> Create Session record in DB
  -> Generate JWT (HS256, 8h expiry)
  -> Return token + user info
  -> Client stores token in sessionStorage
  -> All subsequent requests: Authorization: Bearer <token>
  -> Server validates JWT + active session on each request
  -> Session auto-extended on activity (sliding window)
  -> Absolute max session: 24 hours
```

## Authorization (RBAC)

### Role Hierarchy (highest to lowest)
1. **SUPER_ADMIN** (Level 7, GLOBAL scope) - bypasses all permission checks, manages all organizations
2. **ADMIN** (Level 6, GLOBAL scope) - manages assigned organizations and their users
3. **ORG_ADMIN** (Level 5, ORGANIZATION scope) - manages org resources
4. **SUPERVISOR** (Level 4, ORGANIZATION scope) - monitoring, alarm acknowledgment, filter cycle oversight
5. **MAINTENANCE** (Level 3, ORGANIZATION scope) - checklists, maintenance tasks, filter cleaning operations
6. **OPERATOR** (Level 2, ORGANIZATION scope) - operations, monitoring, filter cycle advancement
7. **VIEWER** (Level 1, ORGANIZATION scope) - read-only access

### Permission Enforcement
- Route-level: `app.requirePermission('USER_CREATE')` pre-handler
- SUPER_ADMIN bypasses all checks
- Permissions stored as JSONB array in `roles.permissions`
- `_MANAGE` parent permission grants child permissions
- 52+ privileges covering all modules including Phase 2 filter management

### Re-Authentication
Sensitive actions (user delete, config change) require password re-entry:
- Configured per-role in `action-reauth` system config
- 5-minute verification token after re-auth
- Sent via `x-reauth-password` header

## Data Isolation
- Every DB query includes `WHERE organizationId = ?`
- JWT contains `organizationId`
- SUPER_ADMIN can query across all organizations
- ADMIN can query across assigned organizations
- Entity assignments provide fine-grained permissions (view/control/configure)
- Phase 2 tables (cleaning profiles, filter profiles, PM schedules, equipment groups) all scoped by organizationId

## API Security
- **Rate Limiting:** 500 requests/minute (global)
- **CORS:** Whitelist-based origin checking
- **Helmet:** Security headers (HSTS, X-Frame-Options, etc.)
- **Input Sanitization:** XSS prevention via `sanitizeStrings()` -- strips HTML from all text fields
- **Body Size Limit:** 10MB max request body
- **File Upload:** 5MB max per file
- **Password Hashing:** BCrypt with 12 salt rounds
- **JWT Signing:** HS256 with 256-bit secret

## 21 CFR Part 11 Compliance
- **Audit Trail:** Immutable logs with checksums for all mutations (including filter operations)
- **Electronic Signatures:** SHA-256 hashed, re-auth verified
- **Session Control:** Single-tab enforcement, absolute timeout
- **Password Policy:** Configurable complexity, expiry, history (12 passwords)
- **Account Lockout:** After N failed attempts (configurable)
- **Filter Event Traceability:** Complete audit trail for all cleaning cycle operations

## Phase 2 Security Measures
- All filter operation endpoints require authentication and RBAC permission checks
- Filter bypass operations record deviation events with operator identification
- Cleaning cycle events record userId, timestamp, and IP for each action
- Checklist submissions are immutable once recorded
- PM execution records cannot be modified after completion
- Equipment group modifications are audit-logged
- Input sanitization applied to all Phase 2 text fields (profile names, descriptions, checklist answers)
- Quality audit identified and fixed 35 security/compliance/logic issues

## Known Security Considerations
- LDAP bind password stored in DB (masked in API, not encrypted at rest)
- No HTTPS configured at application level (relies on Nginx TLS termination)
- JWT secret in .env file (consider HashiCorp Vault for production)
- OAuth2 callback logging was removed (previously logged secrets)
- Single-server deployment (no secrets rotation automation)
- Filter bypass does not require electronic signature (deviation is logged but not signed)
- EC2 IP (34.232.224.0) may change on restart -- consider Elastic IP

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

## Phase 4 Update (2026-04-14)

**Permissions & Access Control Enhancements:**
- **SUPER_ADMIN frontend bypass**: All frontend permission guards use `isSuperAdmin || perms.includes(...)` pattern -- SUPER_ADMIN sees all features regardless of privilege configuration
- **Reauth actions**: 69 total across 16 categories (removed 8 dead actions, added 6 missing); configured per-role in `action-reauth` system config
- **FEATURE_TO_PERMISSION_MAP**: Now includes both frontend visibility flags and backend route permission strings (in `packages/shared/src/types/permissions.ts`)
- **api-client.ts .status**: Thrown errors now include `.status` property so SWR error handlers can suppress 403 toasts for expected permission denials (e.g., non-admin loading password-policy)
- **Public config endpoints**: `/api/config/password-policy/current` and `/api/config/report-settings/current` require no auth -- prevents 403 errors for non-privileged users on login and report pages
- **Permission scale**: 95 total permissions, 82 feature privileges, 24 config definitions

See `CHANGELOG.md` for full details.
