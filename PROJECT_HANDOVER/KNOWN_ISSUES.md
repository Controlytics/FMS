# Known Issues & Limitations

## Known Bugs

### 1. TelemetryBatcher INSERT Error — FIXED
- **Error:** `INSERT has more target columns than expressions`
- **Location:** `packages/db/src/telemetry-batcher.ts:146`
- **Impact:** Some telemetry data may be lost during batched inserts
- **Status:** FIXED — Column mismatch resolved; batch inserts now match the schema correctly.

### 2. React Error #300 on Page Load
- **Error:** "Objects are not valid as a React child"
- **Trigger:** Occasionally on SUPER_ADMIN login when stale cache exists
- **Workaround:** Hard refresh (Ctrl+Shift+R) resolves it
- **Status:** Intermittent, likely stale SWR cache

## Limitations

### Performance
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

## Workarounds

| Issue | Workaround |
|-------|-----------|
| User locked out | Admin can unlock via user edit page |
| LDAP server unreachable | SUPER_ADMIN can always login locally |
| Stale frontend | Hard refresh or clear sessionStorage |
| Org users can't login after org deactivated | Reactivate org or reassign users |

## Pending Fixes
- [x] Fix telemetry batcher column mismatch — FIXED (column alignment corrected)
- [x] Add pagination to organization list endpoint — FIXED (skip/take with page & limit query params enforced in tenant-admin routes)
- [ ] Add per-organization LDAP configuration — Feature request: allow each organization to configure its own LDAP server/base DN instead of sharing the global LDAP config. Not a bug; tracked as a future enhancement.
- [ ] Add per-organization rate limiting (aggregate across all devices in an org) — Per-device rate limiting is implemented using `maxDataRatePerMin` on each device credential. Org-level aggregate rate limiting (sum of all device traffic per org) is not yet implemented.


## Phase 2: Digital Filter Management System (2026-03-27)

### Overview
Complete digital filter cleaning lifecycle management for pharmaceutical cleanrooms. Supports configurable cleaning pipelines with checklist gates, 8 cleaning stages, dual filter sets, PM scheduling, and full traceability.

### Key Components
- **5 backend modules**: cleaning-profiles, filter-profiles, filter-operations, pm-schedules, checklist-profiles
- **12+ frontend pages**: operations, profiles, cycles, checklists, PM, AHU dashboard, traceability, config
- **9 database tables**: filter_cleaning_profiles, filter_pipeline_stages, filter_pipeline_connections, filter_profiles, cleaning_cycles, filter_events, pm_schedules, pm_schedule_entries, pm_executions
- **Quality audit**: 43 issues found and 35 fixed (security, compliance, logic, UI)

