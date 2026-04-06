# API Reference: Authentication

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/login | Login with username/password, returns JWT |
| POST | /api/auth/refresh | Refresh JWT token |
| POST | /api/auth/logout | Invalidate session |
| POST | /api/auth/reauth | Re-authenticate for sensitive operations |
| POST | /api/auth/change-password | Change password (force change on first login) |

## Authentication Methods
- **JWT Tokens** — 30-minute expiry with auto-refresh
- **Device Access Tokens** — Per-entity tokens for MQTT/HTTP data ingestion
- **Re-authentication** — Password re-entry for sensitive operations (configured via `action-reauth` config)

## Default Login
- **Username:** superadmin
- **Password:** Admin@123
