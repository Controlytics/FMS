# DigiLog API Guide

## Base URL
```
http://3.108.185.106/api
```

## Authentication

### Login
```bash
POST /api/auth/login
Content-Type: application/json

{"username": "superadmin", "password": "Admin@123", "force": true}
```

Response includes a JWT token. Use it in subsequent requests:
```
Authorization: Bearer <token>
```

### Interactive Docs
Swagger UI: `http://3.108.185.106/docs`

## API Modules

### Auth (`/api/auth`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/login` | Authenticate and get JWT |
| POST | `/logout` | End session |
| GET | `/me` | Get current user profile |
| PUT | `/profile` | Update own profile |
| POST | `/change-password` | Change password |
| POST | `/refresh` | Refresh JWT token |
| POST | `/verify-password` | Re-authenticate for sensitive ops |
| POST | `/forgot-password` | Request password reset |

### Users (`/api/users`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List users (paginated, filterable) |
| POST | `/` | Create user |
| GET | `/:id` | Get user details |
| PUT | `/:id` | Update user |
| DELETE | `/:id` | Delete user |
| POST | `/:id/enable` | Enable user |
| POST | `/:id/disable` | Disable user |
| POST | `/:id/unlock` | Unlock locked account |
| GET | `/stats` | User statistics |
| POST | `/bulk-delete` | Bulk delete users |

### Roles (`/api/roles`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List all roles |
| POST | `/` | Create custom role |
| PUT | `/:id` | Update role |
| DELETE | `/:id` | Delete role |

### Entity Templates (`/api/templates`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List templates |
| POST | `/` | Create template |
| GET | `/:id` | Get template with schema |
| PUT | `/:id` | Update template |
| DELETE | `/:id` | Soft-delete template |
| GET | `/:id/versions` | Version history |

### Entity Instances (`/api/instances`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List instances (paginated) |
| GET | `/tree` | Full hierarchy tree |
| POST | `/` | Create instance |
| GET | `/:id` | Get instance details |
| PUT | `/:id` | Update instance |
| DELETE | `/:id` | Cascade delete |
| GET | `/:id/children` | Direct children |

### Relationships (`/api/relationships`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List relationships |
| POST | `/` | Create bidirectional pair |
| DELETE | `/:id` | Delete pair |

### Identifiers (`/api/identifiers`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List identifiers |
| POST | `/` | Create identifier |
| DELETE | `/:id` | Delete identifier |
| POST | `/lookup` | Lookup entity by identifier value |

### Data Ingestion (`/api/v1`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/:token/telemetry` | Send telemetry data |
| POST | `/:token/attributes` | Update device attributes |
| GET | `/:token/attributes` | Get shared attributes |
| POST | `/:token/event` | Send device event |
| POST | `/:token/binary` | Upload binary data |

### Rule Chains (`/api/rule-chains`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List rule chains |
| POST | `/` | Create chain |
| GET | `/:id` | Get chain with nodes |
| PUT | `/:id` | Update chain |
| DELETE | `/:id` | Delete chain |
| POST | `/:id/save` | Atomic save (nodes + connections) |
| GET | `/node-types` | List 77 available node types |
| GET | `/:id/debug` | Get debug buffer |

### Telemetry Queries (`/api/queries/telemetry`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/:entityId` | Latest telemetry values |
| GET | `/:entityId/history` | Historical data with aggregation |
| GET | `/:entityId/keys` | Available telemetry keys |

### Alarms (`/api/alarms`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List alarms (filterable) |
| GET | `/summary` | Active/acknowledged/cleared counts |
| POST | `/:id/acknowledge` | Acknowledge with e-signature |
| POST | `/:id/clear` | Clear with e-signature |

### UNS (`/api/uns`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tree` | Browse UNS hierarchy |
| GET | `/entity/:entityId` | Get entity UNS path |
| PUT | `/entity/:entityId` | Override UNS path |

### Notifications (`/api/notifications`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List notifications |
| GET | `/unread-count` | Unread badge count |
| POST | `/:id/read` | Mark as read |
| POST | `/read-all` | Mark all as read |

### Configuration (`/api/config`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/registry/manifest` | All config modules |
| GET | `/dynamic/:moduleKey` | Get module config |
| PUT | `/dynamic/:moduleKey` | Update module config |

### Audit Trail (`/api/audit`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Search audit entries |
| GET | `/:id` | Get entry with integrity check |
| DELETE | `/:id` | Delete entry (SUPER_ADMIN) |

### Help Articles (`/api/help`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List articles |
| GET | `/:key` | Get article by key |
| POST | `/` | Create article |
| PUT | `/:id` | Update article |
| DELETE | `/:id` | Soft-delete article |
| GET | `/:id/versions` | Version history |

### Retention (`/api/retention`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/config/retention` | Get retention policies |
| PUT | `/config/retention` | Update retention policies |
| POST | `/retention/execute` | Delete old data |
| POST | `/retention/execute-range` | Delete by time range |
| POST | `/retention/delete-keys` | Delete specific keys |
| POST | `/retention/delete-records` | Delete specific records |

### Backup (`/api/backup`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/export` | Export database (JSON/SQL/CSV) |
| POST | `/validate` | Validate backup file |
| POST | `/restore` | Restore from backup |

### Connectivity (`/api/connectivity`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/:entityId` | Get connectivity status |
| POST | `/:entityId/token` | Provision access token |
| DELETE | `/:entityId/token` | Revoke token |
| POST | `/:entityId/test` | Test connectivity |
| GET | `/:entityId/snippets` | Generate code snippets |

## Error Responses

All errors follow this format:
```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description",
  "details": {}
}
```

Common codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `SESSION_CONFLICT`, `RATE_LIMITED`
