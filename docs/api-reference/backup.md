# API Reference: Backup

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/backup/create | Create backup (SUPER_ADMIN) |
| GET | /api/backup/list | List available backups |
| POST | /api/backup/restore | Restore from backup (SUPER_ADMIN, requires reauth) |
| GET | /api/backup/status | Check backup/restore job status |

## Features
- SHA-256 integrity verification on backup files
- Configurable backup settings via `backup` config definition
- Audit trail entry for all backup/restore operations
- Includes both PostgreSQL (57 Prisma models) and TimescaleDB data
