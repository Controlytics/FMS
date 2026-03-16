# Security

## Authentication
- JWT tokens with 30-minute auto-refresh
- Session management with idle timeout and warning
- Single-tab enforcement per user
- Re-authentication required for sensitive operations

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
