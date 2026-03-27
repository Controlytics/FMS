# Phase C: Data Ingestion Pipeline (2-3 days)

> **STATUS: COMPLETE** -- Deployed to production on 2026-03-07.
> BullMQ ingestion worker, pipeline stages 1-11, telemetry batcher, DLQ, pipeline tracer, connectivity tracker, and ConfigService all operational.

## Prompt for Claude Code

```
You are implementing Phase C (Pipeline) of DigiLog's Data Ingestion & Integration Layer.

Phase A (infrastructure) and Phase B (transport) are complete. Messages arrive via MQTT/HTTP/WebSocket, get normalized to IngestionMessage, and enqueued to BullMQ "ingestion" queue. Now you build the pipeline that PROCESSES those queued messages.

This phase implements pipeline Stages 1-6 and 9-11 (Stages 7-8 are the rule chain, built in Phase D). For now, messages that reach Stage 7 skip directly to Stage 9 (default save behavior).

IMPORTANT RULES:
- Master spec: DATA_INGESTION_REQUIREMENTS_v3.md
- 21 CFR Part 11 compliance: audit trail on compliance-critical actions, electronic signatures, immutable TSDB records
- TimescaleDB: NEVER UPDATE or DELETE compliance hypertables
- Telemetry write batching: flush BEFORE BullMQ job acknowledgment (prevent data loss on crash)
- Pipeline trace: only record when trace is enabled for entity/template/globally
- Error codes use ERR_ prefix (fatal) and WARN_ prefix (non-fatal, data still saved)
- Read operational limits from ConfigService (SystemConfig table), NOT env vars

WHAT TO BUILD:

1. IN-PROCESS BULLMQ WORKER (apps/api/src/workers/ingestion.worker.ts):
   - BullMQ Worker listening on "ingestion" queue
   - Runs in same process as API (Phase 1 architecture)
   - Concurrency: read from SystemConfig `ingestion.worker_concurrency` at startup
   - Rate limit: read from SystemConfig `ingestion.worker_rate_limit` at startup
   - For each job: run through pipeline stages, catch errors, route to DLQ on permanent failure

2. PIPELINE STAGES (apps/api/src/modules/data-ingestion/ingestion.service.ts):

   Stage 3: Device Validation
   - IP allowlist check (if device.ip_validation_enabled in SystemConfig)
   - Rate limiting (if device.rate_limit_enabled, check against DeviceCredential.maxDataRatePerMin)
   - Log IP_MISMATCH, RATE_LIMITED events to ts_device_events
   - Update ConnectivityStatus (lastActivityAt, protocol, sourceIp)

   Stage 6: Message Normalization & Validation
   - Validate payload keys against template's telemetrySchema/attributeSchema
   - Validate data types (numeric for numeric keys, etc.)
   - Validate numeric ranges (min/max from schema)
   - Validate float resolution constraints
   - Client timestamp validation: if ts field present, check ±drift tolerance
     (read pipeline.timestamp_max_drift_hours from SystemConfig)
     Out-of-range → replace with server time, add WARN_TIMESTAMP_CORRECTED to trace warnings
     (this is a WARNING, not a failure — processing continues)

   Stage 9: Data Persistence (apps/api/src/modules/data-ingestion/ingestion.repository.ts)
   - Save Telemetry → ts_telemetry (TSDB) + conditional UPSERT LatestTelemetry (PG)
     (only if incoming timestamp > existing lastUpdated — prevents stale overwrites)
   - Save Attributes → ts_attributes (TSDB) + update entity attributes (PG)
   - Save Checklist → ts_checklist_responses (TSDB) + INSERT ChecklistReview (PG)
   - Create Alarm → INSERT Alarm (PG)
   - Save Binary → file store + ts_binary_data (TSDB)
   - Auto-register DataStream for new telemetry keys

   Stage 10: Audit Trail (compliance-critical only)
   - Attributes updated → DATA_ATTRIBUTES_UPDATED
   - Alarm created → ALARM_CREATED
   - Checklist submitted → DATA_CHECKLIST_SUBMITTED
   - Telemetry → NOT audited (immutable in TSDB)
   - If audit write fails: ENTIRE job fails → DLQ (compliance data without audit = non-compliant)

   Stage 11: Event Emission
   - Publish to Redis pub/sub `ws:events` channel (API picks up for WebSocket broadcast)
   - MQTT retained message for latest values
   - Enqueue notifications to BullMQ "notification" queue if alarm created
   - Emit failures are WARNINGS (WARN_EMIT_WS_FAILED, WARN_EMIT_MQTT_FAILED), NOT failures
     Data is already persisted — trace shows SUCCESS_WITH_WARNINGS

3. TELEMETRY WRITE BATCHER (packages/db/src/telemetry-batcher.ts):
   - Buffer telemetry INSERTs, flush every batch_flush_ms or batch_size messages (from SystemConfig)
   - Multi-row INSERT (10-50x faster than individual INSERTs)
   - CRITICAL: flush() is called inside the job processor BEFORE the job completes
     (prevents data loss if process crashes between job ack and timer flush)
   - Batching scope: ts_telemetry YES, ts_device_events YES, everything else NO
   - ts_attributes, ts_checklist_responses → immediate INSERT (compliance consistency)

4. PIPELINE ERROR HANDLING:
   Per-stage error routing (see spec Section 6.2):
   - Auth/validation errors: reject with HTTP status, log to ts_device_events
   - Rule chain errors: route to Failure output (Phase D), if no handler: save raw data
   - Persistence errors: retry 3x with exponential backoff (100ms, 500ms, 2s), then DLQ
   - Audit errors: CRITICAL — fail the entire job, goes to DLQ
   - Emit errors: log warning, do NOT fail the job

5. DEAD LETTER QUEUE (PostgreSQL table: dead_letter_queue):
   - Store failed messages with: message_id, entity_id, message_type, payload, error_message,
     error_stage, retry_count, max_retries (3), status (PENDING|RETRYING|RESOLVED|DEAD)
   - DLQ processor: BullMQ repeatable job in "maintenance" queue, runs every 60s
   - Re-enqueue PENDING items older than 5 min
   - After max retries → mark as DEAD, create CRITICAL alarm if DLQ depth > threshold

6. PIPELINE DEBUG TRACE (apps/api/src/modules/data-ingestion/pipeline-tracer.ts):
   - Check if trace enabled: global (SystemConfig), per-entity, or per-template
   - If enabled: create PipelineTrace record with stages JSONB array
   - Each stage writes to the array: {stage, name, status, durationMs, errorCode?, warnings?, details?}
   - Final status logic:
     All SUCCESS + no warnings → SUCCESS
     All SUCCESS + any warnings → SUCCESS_WITH_WARNINGS
     Any FAILED → FAILED (remaining stages = SKIPPED)
     FAILED + routed to DLQ → DLQ
   - Write to ts_pipeline_traces (TSDB) after pipeline completes
   - Publish trace to Redis `ws:trace:{entityId}` for real-time UI streaming

7. CONNECTIVITY TRACKER:
   - On telemetry/attribute received: update ConnectivityStatus to ONLINE, update lastActivityAt
   - On LWT (Phase B already handles): update to OFFLINE
   - Maintenance job: every 60s, check entities where lastActivityAt < now - inactivityTimeout
     → update to OFFLINE, create INACTIVITY device event

8. CONFIG SERVICE (apps/api/src/modules/config/config.service.ts):
   - Read SystemConfig values with 10-second in-memory cache TTL
   - get<T>(key) → throws if key not found
   - set(key, value, userId) → reads old value first, validates min/max, updates, invalidates cache, audit trail
   - Used throughout pipeline for all operational limits

VERIFICATION:
- POST /api/data/telemetry with valid device token → data in ts_telemetry + LatestTelemetry
- POST /api/data/attributes → data in ts_attributes + audit trail entry
- POST /api/data/checklist → data in ts_checklist_responses + ChecklistReview + audit
- Bad payload (wrong data type) → 422, device event logged, NOT in DLQ
- TSDB write failure (simulate) → 3 retries → DLQ entry
- Trace enabled for entity → ts_pipeline_traces populated with stages array
- Timestamp 48 hours in future → corrected to server time, trace shows SUCCESS_WITH_WARNINGS
```

## Relevant Spec Sections

- **Section 6.1**: Pipeline stages 1-11 (complete flow)
- **Section 6.2**: Pipeline error handling (per-stage routing, DLQ)
- **Section 6.3**: Pipeline debug trace (schema, error codes, warnings, UI, retention)
- **Section 6.5**: Data types supported
- **Section 6.6**: Telemetry payload formats
- **Section 3.2**: TimescaleDB immutability rules
- **Section 3.4**: Data routing rules (which data goes where)
- **Section 3.5**: Audit scope (what IS and IS NOT audited)
- **Section 20.2**: ConfigService implementation (cache, get, set, audit)
- **Section 20.3**: All configurable limits (script timeout, rate limits, batch size, drift tolerance, etc.)
- **Section 21.2**: Worker architecture (in-process BullMQ, job priorities, batch flush before ack)


> **Update (2026-03-27):** Phase 2 Digital Filter Management System has been completed. See CHANGELOG.md for full details.

