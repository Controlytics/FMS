/**
 * SQLite schema for offline storage.
 * Keep in sync with sqlite-migrations.ts for version tracking.
 */

export const CURRENT_SCHEMA_VERSION = 1;

export const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS operations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    filter_id TEXT NOT NULL,
    filter_name TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    synced_at TEXT
  );`,

  `CREATE INDEX IF NOT EXISTS idx_ops_status_time
    ON operations(status, created_at);`,

  `CREATE INDEX IF NOT EXISTS idx_ops_filter
    ON operations(filter_id);`,

  `CREATE TABLE IF NOT EXISTS filter_state (
    filter_id TEXT NOT NULL,
    block_id TEXT NOT NULL DEFAULT '',
    current_state TEXT,
    current_cycle TEXT,
    pipeline_graph TEXT,
    pipeline_stages TEXT,
    next_allowed_stages TEXT,
    pending_checklist TEXT,
    answered_checklist_stages TEXT,
    equipment_group TEXT,
    block_change_status TEXT,
    home_block TEXT,
    is_pm_due INTEGER DEFAULT 0,
    pm_reason_key TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (filter_id, block_id)
  );`,

  `CREATE TABLE IF NOT EXISTS filters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    current_lifecycle_state TEXT,
    current_cycle_id TEXT,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,

  `CREATE INDEX IF NOT EXISTS idx_filters_state
    ON filters(current_lifecycle_state);`,

  `CREATE TABLE IF NOT EXISTS reference_cache (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT
  );`,
];
