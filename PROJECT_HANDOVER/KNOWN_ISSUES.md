# Known Issues & Limitations

## Known Bugs

### 1. TelemetryBatcher INSERT Error
- **Error:** `INSERT has more target columns than expressions`
- **Location:** `packages/db/src/telemetry-batcher.ts:146`
- **Impact:** Some telemetry data may be lost during batched inserts
- **Workaround:** Individual inserts still work; batch size can be reduced
- **Status:** Pending investigation

### 2. React Error #300 on Page Load
- **Error:** "Objects are not valid as a React child"
- **Trigger:** Occasionally on SUPER_ADMIN login when stale cache exists
- **Workaround:** Hard refresh (Ctrl+Shift+R) resolves it
- **Status:** Intermittent, likely stale SWR cache

## Limitations

### Performance
- Organization list loads ALL orgs (no pagination limit enforced)
- Rule chain editor can lag with >50 nodes (ReactFlow limitation)
- Audit trail queries on large datasets are slow without date range filter

### Security
- LDAP bind password stored in SystemConfig JSONB (not encrypted at rest, only masked in API)
- JWT secret in .env file (standard practice but consider vault for production)
- No HTTPS configured (relies on Nginx for TLS termination)

### Scalability
- Single PM2 process in cluster mode (single server deployment)
- TimescaleDB on same host as PostgreSQL
- No horizontal scaling configured (would need Redis-based session sharing)

### Multi-Tenancy
- SUPER_ADMIN sees all organizations across all tenants (by design)
- Tenant deletion not implemented (only deactivation)
- No tenant-level LDAP configuration (global LDAP config only)

## Workarounds

| Issue | Workaround |
|-------|-----------|
| User locked out | Admin can unlock via user edit page |
| LDAP server unreachable | SUPER_ADMIN can always login locally |
| Telemetry batch error | Restart PM2: `pm2 restart digilog-api` |
| Stale frontend | Hard refresh or clear sessionStorage |
| Org users can't login after org deactivated | Reactivate org or reassign users |

## Pending Fixes
- [ ] Fix telemetry batcher column mismatch
- [ ] Add tenant-level LDAP configuration
- [ ] Implement tenant hard-delete with cascade
- [ ] Add pagination to organization list endpoint
- [ ] Add rate limiting per tenant (not just global)
