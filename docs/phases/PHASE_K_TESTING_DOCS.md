# Phase K: Testing & Documentation (3-4 days)

> **STATUS: COMPLETE** -- Deployed to production on 2026-03-07. Phase 2 Digital FMS completed 2026-03-27.
> 1,344 tests (0 failures), comprehensive API documentation, architecture docs, deployment guide, and 21 CFR Part 11 compliance documentation all complete. Phase 2 added filter operation testing, 3 full audits (security, logic, UI), and unified light theme across all pages.

## Prompt for Claude Code

```
You are implementing Phase K (Testing & Documentation) of DigiLog's Data Ingestion & Integration Layer.

Phases A-J are complete — the entire system is built. Now you write comprehensive tests and update governance documents. This is a 21 CFR Part 11 regulated system — testing is not optional, it's a compliance requirement.

NOTE: This phase is COMPLETE. Final test count: 1,344 tests with 0 failures (exceeding the original ~250 target).

IMPORTANT RULES:
- Master spec: DATA_INGESTION_REQUIREMENTS_v3.md
- Use Vitest for unit tests, Supertest for API/E2E tests
- Compliance tests are the MOST critical — they prove the system meets FDA regulations
- Test TimescaleDB immutability by attempting UPDATE/DELETE and verifying they fail
- Test electronic signatures for §11.50 field completeness and §11.70 cryptographic binding
- Test audit trail completeness — every auditable action must produce an entry
- Test reauth enforcement — every reauth action must reject without valid reauth

WHAT TO BUILD:

1. UNIT TESTS (~120 tests):

   Rule Node Types (~45 tests):
   - Test each of the 30+ node types with valid input → expected output
   - Test error cases: invalid config, missing fields, null message
   - Test script nodes: timeout, memory exceeded, syntax error
   - Test filter nodes: True output when condition met, False when not
   - Test action nodes: save-timeseries returns correct format, create-alarm builds alarm object

   Script Sandbox (~15 tests):
   - Script executes within timeout → returns result
   - Script exceeds timeout → killed, returns ERR_SCRIPT_TIMEOUT
   - Script exceeds memory → killed, returns ERR_SCRIPT_MEMORY
   - Script tries require() → throws, no access to Node.js APIs
   - Script tries process.exit() → no effect
   - msg/metadata/msgType available in sandbox context
   - log() function captures output (max 1000 chars)
   - Compiled scripts are cached (same hash = no recompile)

   Message Normalizer (~15 tests):
   - MQTT message → IngestionMessage envelope
   - HTTP POST → IngestionMessage envelope
   - Simple payload: {"temp": 72} → normalized
   - Timestamped payload: {"ts": ..., "values": {...}} → normalized with client timestamp
   - Batch payload: [{...}, {...}] → split into individual messages
   - Invalid JSON → ERR_PAYLOAD_PARSE_FAILED
   - Missing required fields → appropriate error code
   - Large payload (>max size) → ERR_PAYLOAD_TOO_LARGE

   UNS Path Builder (~15 tests):
   - Entity at all 6 levels → correct path
   - Entity with gaps (no Area, no Cell) → valid path
   - Name sanitization: spaces → hyphens, special chars removed, lowercase
   - Path uniqueness: two entities with same name under different parents → different paths
   - Wildcard matching: + matches single level, # matches multi-level

   Data Validators (~15 tests):
   - Integer field with float value → validation error
   - Float field with correct resolution → passes
   - Float field with too many decimals → validation error
   - Value below min → validation error
   - Value above max → validation error
   - String value for numeric field → validation error
   - Timestamp within drift tolerance → accepted
   - Timestamp beyond drift → corrected with warning

   Pipeline Stages (~15 tests):
   - Stage 3 IP allowlist: matching IP → pass, non-matching → ERR_DEVICE_IP_MISMATCH
   - Stage 3 rate limit: under limit → pass, over → ERR_DEVICE_RATE_LIMITED
   - Stage 6 schema validation: valid payload → pass, invalid → ERR_VALIDATION_FAILED
   - Stage 9 telemetry persistence: verify ts_telemetry INSERT + LatestTelemetry UPSERT
   - Stage 10 audit: attribute change → audit trail entry created
   - Stage 11 emit failure → SUCCESS_WITH_WARNINGS (not FAILED)

2. E2E / API TESTS (~80 tests):

   HTTP Data Endpoints (~20 tests):
   - POST /api/data/telemetry with valid token → 200, data in TSDB
   - POST /api/data/telemetry with invalid token → 401
   - POST /api/data/telemetry with revoked token → 401
   - POST /api/data/attributes → 200, data in TSDB + audit trail
   - POST /api/data/checklist → 200, ChecklistReview created + e-sig
   - POST /api/data/binary → 200, file stored + ts_binary_data entry
   - Rate limited device → 429
   - IP mismatch → 403
   - Invalid payload (wrong types) → 422

   Rule Chain CRUD (~12 tests):
   - Create rule chain → 201 + version 1 created
   - Update rule chain → 200 + new version created
   - Update without reauth → 403
   - Get rule chain → includes nodes and connections
   - Delete rule chain referenced by template → 409 (conflict)
   - Test message → returns execution trace
   - Export/import round trip → identical graph
   - Version restore → creates new version with old data

   Telemetry Queries (~12 tests):
   - GET latest → returns from LatestTelemetry
   - GET timeseries raw → returns from ts_telemetry
   - GET timeseries interval=1h → uses continuous aggregate
   - GET timeseries with aggregation=avg → correct average
   - Date range exceeding max → 422
   - Filter by keys → only requested keys returned

   Checklist Workflow (~10 tests):
   - Submit checklist → PERFORMED status
   - Review + approve → CHECKED status + e-sig
   - Verify + approve → COMPLETE status + e-sig
   - Reject at review → back to PERFORMED + reason saved
   - Submit without required fields → 422
   - Approve without reauth → 403

   Alarm Lifecycle (~10 tests):
   - Rule chain creates alarm → ACTIVE + audit trail
   - Acknowledge → ACKNOWLEDGED + e-sig + audit trail
   - Clear → CLEARED + e-sig + audit trail
   - Acknowledge without reauth → 403
   - Duplicate alarm (same entity + type while ACTIVE) → updates existing

   Connectivity (~8 tests):
   - Generate token → ACTIVE credential created
   - Regenerate → old revoked, new created + audit trail
   - MQTT auth callback → valid token → 200
   - MQTT auth callback → invalid token → 401
   - Test connection → test telemetry persisted
   - Device goes offline → ConnectivityStatus updated

   QR Code (~4 tests):
   - Generate QR → QrCode record + PNG retrievable
   - Get SVG → valid SVG content
   - QR URL format matches expected pattern

   UNS Mapping (~8 tests):
   - Entity create → UnsMapping auto-created
   - Entity move → cascade updates all descendants
   - Impact report → shows all affected paths
   - Wildcard search → returns matching entities
   - Entity delete → UnsMapping removed

3. COMPLIANCE TESTS (~50 tests):

   TimescaleDB Immutability (~8 tests):
   - Attempt UPDATE on ts_telemetry → SQL error (permission denied)
   - Attempt DELETE on ts_telemetry → SQL error (permission denied)
   - Same for ts_attributes, ts_checklist_responses, ts_device_events, ts_binary_data
   - Verify ts_pipeline_traces CAN be deleted (exempt, has retention policy)
   - Verify INSERT works on all hypertables

   Audit Trail Completeness (~12 tests):
   - For every action in audit actions list (Section 12.5):
     Trigger the action → verify audit entry exists with correct:
     action type, userId, tenantId, timestamp, metadata (old/new values)
   - Attributes update → DATA_ATTRIBUTES_UPDATED
   - Alarm acknowledge → ALARM_ACKNOWLEDGED
   - Rule chain update → RULE_CHAIN_UPDATED
   - Config change → SYSTEM_CONFIG_UPDATED with oldValue/newValue
   - Token regeneration → DEVICE_TOKEN_REGENERATED

   Electronic Signatures (~10 tests):
   - §11.50 field completeness: every ElectronicSignature has
     userId, fullName, meaning, timestamp, signatureImage, contentHash
   - §11.70 cryptographic binding: changing the signed record →
     contentHash no longer matches → signature is invalidated
   - Signature bound to correct parent record (alarm, checklist, etc.)
   - Signature meaning matches action context
   - Signature timestamp is within acceptable window of action timestamp

   Checklist Sequencing (~8 tests):
   - Steps enforced in order (cannot skip to step 3 without completing 1, 2)
   - Rejection resets to correct step (configurable)
   - Each approval step requires its own signature
   - Performed → Checked → Verified order enforced (cannot verify before checking)

   Reauth Enforcement (~12 tests):
   - For every reauth action in the list (Section 12.4):
     Attempt action without reauth header → 403
     Attempt action with valid reauth → succeeds
   - Acknowledge alarm → requires reauth
   - Clear alarm → requires reauth
   - Submit checklist with signature → requires reauth
   - Create/update rule chain → requires reauth
   - Regenerate device token → requires reauth
   - Update system config → requires reauth (for restricted settings)

4. INTEGRATION TESTS (~5 flows):
   Each test runs the complete end-to-end flow:

   Test 1: MQTT → Pipeline → TimescaleDB
   Publish via EMQX → auth callback → normalize → rule chain → stored in ts_telemetry

   Test 2: HTTP → Rule Chain → Alarm → Audit
   POST telemetry → threshold breach → alarm created → audit entry logged

   Test 3: QR → Checklist → Approval → Signatures
   Scan QR URL → login → fill checklist → submit → review → approve → 3 e-sig records valid

   Test 4: Entity Create → UNS → MQTT Subscribe
   Create entity → auto-provision credential → UNS path created → EMQX subscription active

   Test 5: Entity Move → Cascade → Impact Report
   Move parent entity → calculate impact → confirm → cascade all descendants → verify before/after

5. DOCUMENTATION:
   Update/create these documents:

   A. API Documentation:
   - All endpoints with request/response examples
   - Authentication methods (JWT, Device Token)
   - Error codes and meanings
   - Rate limits and quotas

   B. Architecture Decision Records:
   - Appendix D decisions (trace storage, warnings, priorities, cold settings)
   - Why separate TimescaleDB
   - Why BullMQ over direct processing
   - Why isolated-vm over Node.js vm

   C. Deployment Guide:
   - Docker Compose setup
   - Environment variables
   - EMQX configuration
   - TimescaleDB tuning
   - Redis configuration
   - Backup procedures

   D. Compliance Documentation:
   - 21 CFR Part 11 compliance matrix
   - Audit trail coverage
   - Electronic signature implementation
   - Data integrity (ALCOA+) mapping
```

## Relevant Spec Sections

- **Section 16.1**: Unit test suites (~120 tests, exact counts per suite)
- **Section 16.2**: E2E test suites (~80 tests, exact counts per suite)
- **Section 16.3**: Compliance test suites (~50 tests, exact counts per suite)
- **Section 16.4**: Integration test flows (5 end-to-end scenarios)
- **Section 12.3**: Permissions list (for reauth enforcement tests)
- **Section 12.4**: Reauth actions list (must test each one)
- **Section 12.5**: Audit actions list (must test each one)
- **Section 3.2**: REVOKE rules (immutability verification)
- **Section 3.3**: Electronic signature schema (§11.50 fields to verify)
- **Appendix D**: Design decisions (for architecture documentation)


> **Update (2026-03-27):** Phase 2 Digital FMS completed. 3 full audits performed (security, logic, UI) with 35 fixes applied. Total system: 34 API modules, 57 Prisma models, 17 enums, 77 rule chain node types, 23 config definitions, 52+ privileges, 4 notification channels. Unified light theme (bg-white, text-slate-800) enforced across all pages.

