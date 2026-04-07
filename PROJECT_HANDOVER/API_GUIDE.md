# API Guide

## Base URL
```
Production: http://34.232.224.0/api
Local: http://localhost:3000/api
Swagger UI: http://localhost:3000/docs (Production: http://34.232.224.0/docs)
```

## Authentication
All endpoints (except login and public) require JWT token:
```
Authorization: Bearer <jwt_token>
```

## Standard Response Format
```json
// Success (list)
{ "data": [...], "total": 100, "page": 1, "limit": 10, "totalPages": 10 }

// Success (single)
{ "id": "uuid", "name": "...", ... }

// Success (action)
{ "success": true, "message": "..." }

// Error
{ "error": "ERROR_CODE", "message": "Human-readable message" }
```

## Error Codes
| Code | HTTP Status | Meaning |
|------|-------------|---------|
| INVALID_CREDENTIALS | 401 | Wrong username/password |
| TOKEN_EXPIRED | 401 | JWT expired |
| SESSION_INVALID | 401 | Session terminated |
| ACCOUNT_INACTIVE | 401 | User disabled |
| FORBIDDEN | 403 | Insufficient permissions |
| ORG_INACTIVE | 403 | Organization deactivated |
| FORCE_PASSWORD_CHANGE | 403 | Must change password first |
| REAUTH_REQUIRED | 403 | Re-authentication needed |
| VALIDATION_ERROR | 400 | Invalid input |
| CONFLICT | 409 | Duplicate resource |
| NOT_FOUND | 404 | Resource not found |

## Core Endpoints

### Auth
```
POST   /api/auth/login           # Login (username, password, force?)
POST   /api/auth/logout          # Logout (terminates session)
POST   /api/auth/refresh         # Refresh JWT token
GET    /api/auth/me              # Get current user profile
POST   /api/auth/change-password # Change password (currentPassword, newPassword)
POST   /api/auth/forgot-password # Request password reset
```

### Users
```
GET    /api/users                # List users (page, limit, search, role, status)
POST   /api/users               # Create user (requires USER_CREATE)
GET    /api/users/:id            # Get user details
PUT    /api/users/:id            # Update user
DELETE /api/users/:id            # Delete user
POST   /api/users/:id/enable     # Enable user
POST   /api/users/:id/disable    # Disable user
POST   /api/users/:id/unlock     # Unlock locked user (with temp password)
POST   /api/users/:id/reset-password # Reset password
GET    /api/users/stats          # User count by status
POST   /api/users/bulk-delete    # Bulk delete users
```

### Organizations
```
GET    /api/organizations                 # List all organizations
POST   /api/organizations                 # Create organization
GET    /api/organizations/:id             # Get organization details
PUT    /api/organizations/:id             # Update organization
DELETE /api/organizations/:id             # Delete (permanent=true for hard delete)
```

### Assets
```
GET    /api/assets/templates              # List templates
POST   /api/assets/templates              # Create template
GET    /api/assets/templates/:id          # Get template
PUT    /api/assets/templates/:id          # Update template
DELETE /api/assets/templates/:id          # Delete template
GET    /api/assets/instances              # List entity instances
POST   /api/assets/instances              # Create entity
GET    /api/assets/instances/:id          # Get entity details
PUT    /api/assets/instances/:id          # Update entity
DELETE /api/assets/instances/:id          # Delete entity
```

### Rule Chains
```
GET    /api/rule-chains                   # List rule chains
POST   /api/rule-chains                   # Create rule chain
GET    /api/rule-chains/:id               # Get rule chain with nodes
PUT    /api/rule-chains/:id               # Update (nodes, connections)
DELETE /api/rule-chains/:id               # Delete rule chain
POST   /api/rule-chains/:id/test          # Test rule chain with sample data
```

### Data Ingestion
```
POST   /api/data/telemetry               # Submit telemetry (device token auth)
POST   /api/data/attributes              # Submit attributes
POST   /api/data/event                   # Submit event
POST   /api/data/binary                  # Submit binary data
```

### LDAP
```
GET    /api/ldap/config                  # Get LDAP config (password masked)
PUT    /api/ldap/config                  # Save LDAP config
POST   /api/ldap/test-connection         # Test LDAP server connection
GET    /api/ldap/status                  # Quick enabled/disabled check
```

### Configuration
```
GET    /api/config/branding              # Public - organization branding
GET    /api/config/password-policy       # Password policy settings
GET    /api/config/{key}                 # Get any config by key
PUT    /api/config/{key}                 # Update config
```

### Notifications
```
GET    /api/notifications                # List notifications
GET    /api/notifications/unread-count   # Unread count
POST   /api/notifications/:id/read      # Mark as read
POST   /api/notifications/read-all      # Mark all as read
```

### Audit
```
GET    /api/audit                        # Query audit trail (date range, user, action)
GET    /api/audit/export                 # Export audit as CSV
```

### Roles
```
GET    /api/roles                        # List all roles
GET    /api/roles/:role/creatable        # Roles the given role can create
PUT    /api/roles/:id                    # Update role permissions
```

### Uploads
```
POST   /api/uploads                      # Upload file (max 5MB)
GET    /api/uploads/:id                  # Get uploaded file
```

### QR Codes
```
POST   /api/qr-codes                     # Generate QR code for entity
GET    /api/qr-codes/:id                 # Get QR code image
```

### System Health
```
GET    /api/system-health                # System metrics, uptime, request stats
```

### Deployment Check
```
GET    /api/deployment-check             # Verify deployment status
```

## Phase 2: Digital Filter Management System

### Cleaning Profiles
```
GET    /api/cleaning-profiles            # List all cleaning profiles
POST   /api/cleaning-profiles            # Create cleaning profile with pipeline stages
GET    /api/cleaning-profiles/:id        # Get profile with full pipeline definition
PUT    /api/cleaning-profiles/:id        # Update profile (stages, connections)
DELETE /api/cleaning-profiles/:id        # Delete cleaning profile
```

### Filter Profiles
```
GET    /api/filter-profiles              # List filter-to-cleaning-profile assignments
POST   /api/filter-profiles              # Assign cleaning profile to filter
GET    /api/filter-profiles/:id          # Get filter profile details
PUT    /api/filter-profiles/:id          # Update assignment
DELETE /api/filter-profiles/:id          # Remove assignment
```

### Filter Operations
```
POST   /api/filters/:id/start-cycle      # Start a new cleaning cycle
POST   /api/filters/:id/advance          # Advance to next pipeline stage
POST   /api/filters/:id/submit-checklist # Submit checklist answers for gate
POST   /api/filters/:id/bypass           # Bypass stage (creates deviation record)
GET    /api/filters/:id/current-state    # Get filter state + next available actions
GET    /api/filter/cycles                # List cleaning cycles (with filters)
GET    /api/filter/events                # List filter events (audit trail)
```

### PM Schedules
```
GET    /api/pm-schedules                 # List preventive maintenance schedules
POST   /api/pm-schedules                 # Create PM schedule
GET    /api/pm-schedules/:id             # Get PM schedule details
PUT    /api/pm-schedules/:id             # Update PM schedule
DELETE /api/pm-schedules/:id             # Delete PM schedule
```

### Checklist Profiles
```
GET    /api/checklist-profiles           # List checklist templates
POST   /api/checklist-profiles           # Create checklist profile with questions
GET    /api/checklist-profiles/:id       # Get checklist profile
PUT    /api/checklist-profiles/:id       # Update checklist profile
DELETE /api/checklist-profiles/:id       # Delete checklist profile
```

### Equipment Groups
```
GET    /api/equipment-groups             # List equipment groups (AHU groupings)
POST   /api/equipment-groups             # Create equipment group
GET    /api/equipment-groups/:id         # Get group with instruments
PUT    /api/equipment-groups/:id         # Update group
DELETE /api/equipment-groups/:id         # Delete group
```

### Pipeline Flow
The cleaning pipeline follows a directed graph:
- **STAGE nodes**: WASH_IN, WASH_OUT, DRY_IN, DRY_OUT, STORAGE_IN, STORAGE_OUT, START, END
- **CHECKLIST nodes**: Placed between stages as gates requiring operator input
- `advance()` is blocked if a pending checklist has not been completed
- Cycle auto-completes when last STAGE leads to END node
- Dual filter sets (SET_A/SET_B) supported per profile

## Example API Calls

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "superadmin", "password": "Admin@123"}'

# Response
{"success": true, "token": "eyJhbG...", "user": {"id": "...", "role": "SUPER_ADMIN"}}

# Use token for subsequent requests
curl http://localhost:3000/api/users \
  -H "Authorization: Bearer eyJhbG..."

# Start a filter cleaning cycle
curl -X POST http://localhost:3000/api/filters/<filter-id>/start-cycle \
  -H "Authorization: Bearer eyJhbG..." \
  -H "Content-Type: application/json" \
  -d '{"filterSet": "SET_A"}'

# Get filter current state
curl http://localhost:3000/api/filters/<filter-id>/current-state \
  -H "Authorization: Bearer eyJhbG..."

# List cleaning cycles
curl "http://localhost:3000/api/filter/cycles?page=1&limit=10" \
  -H "Authorization: Bearer eyJhbG..."
```

---

## Phase 3 Update (2026-04-07)

**RFID & Offline Operations:**
- RFID Scanner Android app (`rfid_scan_app/`) for KC-series UHF readers
- RFID keyboard guard prevents UKB tag input leaking into random fields
- Offline cleaning operations via IndexedDB queue + sync engine
- Cached identifier→filter map for offline RFID lookup
- "Data Synced" indicator in mobile header
- One identifier per entity (backend-enforced)
- Responsive layout with collapsible sidebar
- Error popups replace inline banners
- User creation auto-assigns org for admins
- `/api/roles/active` public endpoint for contact-admin page

See `CHANGELOG.md` for full details.
