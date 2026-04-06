# Security

## Authentication
- JWT tokens with 30-minute auto-refresh
- Session management with idle timeout and warning
- Single-tab enforcement per user
- Re-authentication required for sensitive operations (managed via `action-reauth` config)
- Configurable login security (lockout after failed attempts, via `login-security` config)

## Input Sanitization
All text inputs are sanitized to strip HTML tags (XSS prevention) via lib/sanitize.ts.

## Device Security
- Unique access tokens per entity
- Optional IP allowlists
- Rate limiting (configurable per credential)
- MQTT TLS support (port 8883)

## Data Security
- PostgreSQL role-based access
- TimescaleDB compression for data at rest
- SHA-256 hash-chain audit trail
- Backup integrity verification
- Organization scoping ensures cross-tenant data isolation

## Password Policy
Configurable via `password-policy` config:
- Complexity requirements (min length, uppercase, lowercase, numbers, special chars)
- Password history (prevent reuse)
- Password expiration
- Account lockout after failed attempts

## Phase 2 Filter Security
- All filter state transitions require authenticated user context
- Bypass operations require FILTER_BYPASS privilege and deviation justification
- Checklist submissions within pipeline are bound by electronic signatures
- Organization-scoped data isolation for multi-tenant filter management
