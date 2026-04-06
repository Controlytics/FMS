# API Reference: Audit

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/audit | List audit entries (filter: action, user, entity, date range) |
| GET | /api/audit/:id | Get audit entry detail |
| POST | /api/export/audit | Export audit trail (CSV/JSON/PDF) |

## Audit Entry Fields
Timestamp, User, Role, Action, Target, Before/After Value, IP, User Agent, Session ID, Checksum (SHA-256 hash-chain)

## Audited Actions
Core operations (login, CRUD, config changes) plus Phase 2 filter operations (cycle start/advance/complete, bypass, checklist submission, PM execution, retirement/replacement).
