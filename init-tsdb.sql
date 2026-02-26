-- ═══════════════════════════════════════════════════════════
-- DigiLog TimescaleDB Initialization Script
-- Runs automatically on first container start via
-- /docker-entrypoint-initdb.d/init-tsdb.sql
-- Database 'digilog_tsdb' created by Docker POSTGRES_DB env var
-- ═══════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ═══════════════════════════════════════════════════════════
-- 1. TELEMETRY (append-only sensor data)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE ts_telemetry (
    time        TIMESTAMPTZ      NOT NULL,
    entity_id   UUID             NOT NULL,
    key         TEXT             NOT NULL,
    value_num   DOUBLE PRECISION,
    value_str   TEXT,
    value_bool  BOOLEAN,
    value_json  JSONB,
    uns_path    TEXT             NOT NULL,
    source      TEXT             DEFAULT 'device',   -- device | manual | rule_engine | api
    source_ip   TEXT,
    trace_id    TEXT
);
SELECT create_hypertable('ts_telemetry', 'time');
CREATE INDEX idx_ts_telemetry_entity ON ts_telemetry (entity_id, time DESC);
CREATE INDEX idx_ts_telemetry_uns ON ts_telemetry (uns_path, time DESC);
CREATE INDEX idx_ts_telemetry_key ON ts_telemetry (entity_id, key, time DESC);

-- ═══════════════════════════════════════════════════════════
-- 2. ATTRIBUTES (append-only attribute change history)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE ts_attributes (
    time        TIMESTAMPTZ      NOT NULL,
    entity_id   UUID             NOT NULL,
    scope       TEXT             NOT NULL,    -- client | server | shared
    key         TEXT             NOT NULL,
    value_num   DOUBLE PRECISION,
    value_str   TEXT,
    value_bool  BOOLEAN,
    value_json  JSONB,
    updated_by  TEXT             NOT NULL,    -- userId or deviceCredentialId
    uns_path    TEXT             NOT NULL,
    source_ip   TEXT
);
SELECT create_hypertable('ts_attributes', 'time');

-- ═══════════════════════════════════════════════════════════
-- 3. CHECKLIST RESPONSES (immutable on submit, never modified)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE ts_checklist_responses (
    time          TIMESTAMPTZ    NOT NULL,
    entity_id     UUID           NOT NULL,
    template_id   UUID           NOT NULL,
    checklist_id  TEXT           NOT NULL,    -- UUID, links to ChecklistReview in PG
    submitted_by  TEXT           NOT NULL,    -- userId (NEVER device token)
    answers       JSONB          NOT NULL,
    answers_hash  TEXT           NOT NULL,    -- SHA-256 of answers JSON for signature binding
    uns_path      TEXT           NOT NULL,
    source_ip     TEXT
);
SELECT create_hypertable('ts_checklist_responses', 'time');

-- ═══════════════════════════════════════════════════════════
-- 4. DEVICE EVENTS (append-only connection history)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE ts_device_events (
    time          TIMESTAMPTZ    NOT NULL,
    entity_id     UUID           NOT NULL,
    event_type    TEXT           NOT NULL,    -- CONNECTED | DISCONNECTED | ACTIVITY | ERROR | INACTIVITY | IP_MISMATCH | RATE_LIMITED
    details       JSONB,
    source_ip     TEXT,
    uns_path      TEXT           NOT NULL
);
SELECT create_hypertable('ts_device_events', 'time');

-- ═══════════════════════════════════════════════════════════
-- 5. BINARY DATA REFERENCES (append-only file metadata)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE ts_binary_data (
    time          TIMESTAMPTZ    NOT NULL,
    entity_id     UUID           NOT NULL,
    data_type     TEXT           NOT NULL,    -- image | audio | vibration_raw | document
    file_path     TEXT           NOT NULL,
    file_hash     TEXT           NOT NULL,    -- SHA-256 of file content
    file_size     BIGINT,
    mime_type     TEXT,
    metadata      JSONB,
    uploaded_by   TEXT           NOT NULL,
    uns_path      TEXT           NOT NULL
);
SELECT create_hypertable('ts_binary_data', 'time');

-- ═══════════════════════════════════════════════════════════
-- 6. PIPELINE DEBUG TRACES (auto-purged, NOT compliance data)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE ts_pipeline_traces (
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    time            TIMESTAMPTZ NOT NULL,
    message_id      TEXT NOT NULL,
    entity_id       UUID,
    entity_name     TEXT,
    transport       TEXT NOT NULL,            -- MQTT | HTTP | WebSocket
    message_type    TEXT NOT NULL,            -- TELEMETRY | ATTRIBUTES | RPC | CHECKLIST | BINARY | EVENT
    payload_size    INTEGER,
    stages          JSONB NOT NULL,           -- Array of StageResult objects
    final_status    TEXT NOT NULL,            -- SUCCESS | SUCCESS_WITH_WARNINGS | FAILED | DLQ
    failed_stage    TEXT,
    error_code      TEXT,
    error_message   TEXT,
    warnings        JSONB,
    total_duration_ms INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SELECT create_hypertable('ts_pipeline_traces', 'time');
CREATE INDEX idx_pipeline_traces_entity ON ts_pipeline_traces (entity_id, time DESC);
CREATE INDEX idx_pipeline_traces_status ON ts_pipeline_traces (final_status, time DESC);

-- ═══════════════════════════════════════════════════════════
-- CONTINUOUS AGGREGATES
-- ═══════════════════════════════════════════════════════════

-- Hourly aggregate for telemetry
CREATE MATERIALIZED VIEW telemetry_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    entity_id,
    key,
    AVG(value_num) AS avg_val,
    MIN(value_num) AS min_val,
    MAX(value_num) AS max_val,
    COUNT(*) AS sample_count
FROM ts_telemetry
WHERE value_num IS NOT NULL
GROUP BY bucket, entity_id, key;

SELECT add_continuous_aggregate_policy('telemetry_hourly',
  start_offset => INTERVAL '2 hours',
  end_offset   => INTERVAL '30 minutes',
  schedule_interval => INTERVAL '30 minutes');

-- Daily aggregate for long-term trending
CREATE MATERIALIZED VIEW telemetry_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    entity_id,
    key,
    AVG(value_num) AS avg_val,
    MIN(value_num) AS min_val,
    MAX(value_num) AS max_val,
    COUNT(*) AS sample_count
FROM ts_telemetry
WHERE value_num IS NOT NULL
GROUP BY bucket, entity_id, key;

SELECT add_continuous_aggregate_policy('telemetry_daily',
  start_offset => INTERVAL '2 days',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

-- ═══════════════════════════════════════════════════════════
-- COMPRESSION (data stays, just compressed — NOT deleted)
-- ═══════════════════════════════════════════════════════════
SELECT add_compression_policy('ts_telemetry', INTERVAL '7 days');
SELECT add_compression_policy('ts_attributes', INTERVAL '30 days');
SELECT add_compression_policy('ts_device_events', INTERVAL '7 days');
SELECT add_compression_policy('ts_binary_data', INTERVAL '30 days');
SELECT add_compression_policy('ts_checklist_responses', INTERVAL '30 days');
SELECT add_compression_policy('ts_pipeline_traces', INTERVAL '1 day');

-- ═══════════════════════════════════════════════════════════
-- RETENTION: DISABLED BY DEFAULT (except debug traces)
-- Pipeline traces are debug data (NOT compliance) — auto-purged
-- ═══════════════════════════════════════════════════════════
SELECT add_retention_policy('ts_pipeline_traces', INTERVAL '48 hours');

-- ═══════════════════════════════════════════════════════════
-- SECURITY: REVOKE UPDATE/DELETE on compliance hypertables
-- ts_pipeline_traces is intentionally excluded (debug data)
-- ═══════════════════════════════════════════════════════════
REVOKE UPDATE, DELETE ON ts_telemetry FROM digilog_app;
REVOKE UPDATE, DELETE ON ts_attributes FROM digilog_app;
REVOKE UPDATE, DELETE ON ts_checklist_responses FROM digilog_app;
REVOKE UPDATE, DELETE ON ts_device_events FROM digilog_app;
REVOKE UPDATE, DELETE ON ts_binary_data FROM digilog_app;
