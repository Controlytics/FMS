-- TimescaleDB Hypertable Migration
-- DigiLog Platform - 2026-03-01
-- Converts 5 regular PostgreSQL tables to TimescaleDB hypertables
-- Pre-migration row counts: ts_telemetry=42, ts_attributes=6, ts_device_events=43,
--   ts_checklist_responses=8, ts_pipeline_traces=0

BEGIN;

-- ============================================================
-- 1. ts_telemetry — High-frequency sensor data (7-day chunks)
-- ============================================================
SELECT create_hypertable('ts_telemetry', 'time',
  chunk_time_interval => INTERVAL '7 days',
  migrate_data => TRUE,
  if_not_exists => TRUE
);

-- ============================================================
-- 2. ts_attributes — Low-frequency attribute changes (30-day chunks)
-- ============================================================
SELECT create_hypertable('ts_attributes', 'time',
  chunk_time_interval => INTERVAL '30 days',
  migrate_data => TRUE,
  if_not_exists => TRUE
);

-- ============================================================
-- 3. ts_device_events — Connect/disconnect events (7-day chunks)
-- ============================================================
SELECT create_hypertable('ts_device_events', 'time',
  chunk_time_interval => INTERVAL '7 days',
  migrate_data => TRUE,
  if_not_exists => TRUE
);

-- ============================================================
-- 4. ts_checklist_responses — 21 CFR Part 11 compliance (90-day chunks)
-- ============================================================
SELECT create_hypertable('ts_checklist_responses', 'time',
  chunk_time_interval => INTERVAL '90 days',
  migrate_data => TRUE,
  if_not_exists => TRUE
);

-- ============================================================
-- 5. ts_pipeline_traces — Debug traces (1-day chunks)
--    Must drop PK first: hypertables require time in unique constraints
-- ============================================================
ALTER TABLE ts_pipeline_traces DROP CONSTRAINT ts_pipeline_traces_pkey;

SELECT create_hypertable('ts_pipeline_traces', 'time',
  chunk_time_interval => INTERVAL '1 day',
  migrate_data => TRUE,
  if_not_exists => TRUE
);

-- Re-create as composite unique index including time
CREATE UNIQUE INDEX ts_pipeline_traces_pkey ON ts_pipeline_traces (id, "time");

-- ============================================================
-- Additional composite indexes for common query patterns
-- ============================================================

-- ts_attributes: lookup by entity + key + time (most common query)
CREATE INDEX IF NOT EXISTS idx_ts_attributes_key
  ON ts_attributes (entity_id, key, "time" DESC);

-- ts_device_events: lookup by entity + event type
CREATE INDEX IF NOT EXISTS idx_ts_device_events_type
  ON ts_device_events (entity_id, event_type, "time" DESC);

-- ts_pipeline_traces: composite entity + time (replace simple entity index)
DROP INDEX IF EXISTS idx_pipeline_traces_entity;
CREATE INDEX idx_pipeline_traces_entity_time
  ON ts_pipeline_traces (entity_id, "time" DESC);

-- ============================================================
-- 21 CFR Part 11 compliance: Protect checklist responses
-- Revoke UPDATE and DELETE to prevent tampering with submitted records
-- ============================================================
REVOKE UPDATE, DELETE ON ts_checklist_responses FROM digilog;
GRANT INSERT, SELECT ON ts_checklist_responses TO digilog;

COMMIT;
