# Security & Access Control

## Authentication Flow

```
Client → POST /api/auth/login (username, password)
  → Server: Find user by username
  → If authSource=ldap: LDAP bind verification
  → If authSource=local: BCrypt password comparison
  → Check account status, lockout, password expiry
  → Create Session record in DB
  → Generate JWT (HS256, 8h expiry)
  → Return token + user info
  → Client stores token in sessionStorage
  → All subsequent requests: Authorization: Bearer <token>
  → Server validates JWT + active session on each request
  → Session auto-extended on activity (sliding window)
  → Absolute max session: 24 hours
```

## Authorization (RBAC)

### Role Hierarchy (highest to lowest)
1. **SUPER_ADMIN** (Level 6, GLOBAL scope) - bypasses all permission checks
2. **TENANT_ADMIN** (Level 5, TENANT scope) - manages tenant users/orgs
3. **SUPERVISOR** (Level 4, TENANT scope) - monitoring, alarm acknowledgment
4. **ORG_ADMIN** (Level 4, ORGANIZATION scope) - manages org resources
5. **MAINTENANCE** (Level 3, TENANT scope) - checklists, maintenance tasks
6. **OPERATOR** (Level 2, TENANT scope) - operations, monitoring
7. **VIEWER** (Level 1, TENANT scope) - read-only access

### Permission Enforcement
- Route-level: `app.requirePermission('USER_CREATE')` pre-handler
- SUPER_ADMIN bypasses all checks
- Permissions stored as JSONB array in `roles.permissions`
- `_MANAGE` parent permission grants child permissions

### Re-Authentication
Sensitive actions (user delete, config change) require password re-entry:
- Configured per-role in `action-reauth` system config
- 5-minute verification token after re-auth
- Sent via `x-reauth-password` header

## Tenant Isolation
- Every DB query includes `WHERE tenantId = ?`
- JWT contains `tenantId` and `organizationId`
- SUPER_ADMIN can impersonate tenants via `X-Tenant-Id` header
- Organization-level isolation further restricts entity access
- Entity assignments provide fine-grained permissions (view/control/configure)

## API Security
- **Rate Limiting:** 500 requests/minute (global)
- **CORS:** Whitelist-based origin checking
- **Helmet:** Security headers (HSTS, X-Frame-Options, etc.)
- **Input Sanitization:** XSS prevention via `sanitizeStrings()`
- **Body Size Limit:** 10MB max request body
- **File Upload:** 5MB max per file
- **Password Hashing:** BCrypt with 12 salt rounds
- **JWT Signing:** HS256 with 256-bit secret

## 21 CFR Part 11 Compliance
- **Audit Trail:** Immutable logs with checksums for all mutations
- **Electronic Signatures:** SHA-256 hashed, re-auth verified
- **Session Control:** Single-tab enforcement, absolute timeout
- **Password Policy:** Configurable complexity, expiry, history (12 passwords)
- **Account Lockout:** After N failed attempts (configurable)

## Known Security Considerations
- LDAP bind password stored in DB (masked in API, not encrypted at rest)
- No HTTPS configured at application level (relies on Nginx TLS termination)
- JWT secret in .env file (consider HashiCorp Vault for production)
- OAuth2 callback logging was removed (previously logged secrets)
- Single-server deployment (no secrets rotation automation)
