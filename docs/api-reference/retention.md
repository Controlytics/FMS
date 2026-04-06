# API Reference: Retention

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/retention/policies | List current retention settings per hypertable |
| PUT | /api/retention/policies | Update retention (SUPER_ADMIN, RETENTION_MANAGE permission) |

## Features
- Configurable retention per TimescaleDB hypertable
- Updates TimescaleDB retention policies via SQL
- Audit trail for all retention changes
- Default: 365 days for telemetry, 48 hours for pipeline traces
- Managed via `retention` config definition
