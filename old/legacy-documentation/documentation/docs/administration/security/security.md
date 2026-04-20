# Security

## Authentication
- JWT tokens with configurable session duration (default: 8 hours)
- Session management with idle timeout and warning dialog
- Absolute 24-hour session timeout
- Single-tab enforcement per user (session conflict resolution)
- Re-authentication required for sensitive operations (42+ configurable actions, 13 categories)
- Forced password change on first login and temporary passwords

## Password Policy
- Configurable minimum/maximum length (default: 8-128)
- Complexity requirements: uppercase, lowercase, numbers, special characters
- Password expiry (default: 90 days)
- Password history prevention (default: 12 previous passwords)
- Account lockout after failed attempts (configurable: temporary or permanent)

## Input Sanitization
All text inputs are sanitized to strip HTML tags (XSS prevention) via `lib/sanitize.ts`. Applied to all API endpoints that accept text fields.

## Device Security
- Unique access tokens per entity
- Optional IP allowlists per credential
- Rate limiting (configurable per credential, default 600 messages/minute)
- MQTT TLS support (port 8883)

## Data Security
- PostgreSQL role-based access
- TimescaleDB compression for data at rest
- SHA-256 hash-chain audit trail (tamper-evident)
- Backup integrity verification with checksum validation
- Organization scoping for multi-tenant data isolation

## Rule Chain Security
- Sandboxed VM execution for custom JavaScript scripts
- 1-second timeout on script execution
- No access to `process`, `require`, `global`, or file system

## Session Security
- JWT + database session validation on every request
- Immediate session invalidation on password change, role change, or account disable
- IP address and user agent tracking in audit trail
- Single concurrent session per user

## Phase 2: Filter Operations Security
- All filter operations require authenticated JWT with appropriate permissions
- 17 granular permissions across 6 roles for filter management
- Bypass deviations require FILTER_BYPASS permission and justification
- Organization scoping prevents cross-tenant access to filter data
- Immutable filter event records (append-only, no delete endpoints)
- SHA-256 checksums on all filter events
