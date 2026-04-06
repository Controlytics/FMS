# API Reference: Templates

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/assets/templates | List templates |
| POST | /api/assets/templates | Create template |
| GET | /api/assets/templates/:id | Get template detail |
| PUT | /api/assets/templates/:id | Update template (creates new version) |
| DELETE | /api/assets/templates/:id | Soft delete template |

## Template Fields
- Name, Category, Description, Icon
- Attribute Schema (14 data types)
- Telemetry Schema (expected data points with types and units)
- Alarm Rules (threshold, rate-of-change, absence)
- Checklist Schema (14 question types)
- Connectivity Settings (transport type, credential type, auto-provision, rate limits)
- Relationship Constraints (max connections, max parents)

## Versioning
Every edit creates a new version. Instances track which version they were created from.

## Default Rule Chain
Templates with alarm rules auto-generate a default rule chain for threshold evaluation.
