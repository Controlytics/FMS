/**
 * Maintenance Worker — Handles periodic maintenance tasks via node-cron.
 * Tasks: DLQ processing, connectivity timeout checks, retention cleanup.
 * Replaces BullMQ repeatable jobs with lightweight cron schedules.
 */

import cron from 'node-cron';
import { processDLQ } from '../modules/data-ingestion/dlq-manager.js';
import { checkInactivityTimeouts } from '../modules/data-ingestion/connectivity-tracker.js';
import { prisma } from '../lib/prisma.js';
import { getTsdbPool } from '@digilog/db';

let dlqJob: cron.ScheduledTask | null = null;
let connectivityJob: cron.ScheduledTask | null = null;
let retentionJob: cron.ScheduledTask | null = null;

/** TSDB table mapping — mirrors retention.routes.ts */
const TSDB_TABLE_MAP: Record<string, string> = {
  telemetry: 'ts_telemetry',
  attributes: 'ts_attributes',
  events: 'ts_device_events',
  traces: 'ts_pipeline_traces',
  checklists: 'ts_checklist_responses',
};

/**
 * Run retention cleanup: read config, check autoEnabled, delete old data.
 */
async function runRetentionCleanup(): Promise<{
  enabled: boolean;
  results: Array<{ dataType: string; deleted: number; retentionDays: number }>;
}> {
  const configRow = await prisma.systemConfig.findUnique({
    where: { configKey: 'retention' },
  });

  const defaultConfig: Record<string, any> = {
    telemetry: { retentionDays: 365 },
    attributes: { retentionDays: 730 },
    events: { retentionDays: 365 },
    traces: { retentionHours: 48 },
    checklists: { retentionDays: 2555 },
    autoEnabled: false,
  };

  const config: Record<string, any> = configRow
    ? { ...defaultConfig, ...(configRow.configValue as Record<string, unknown>) }
    : defaultConfig;

  if (!config.autoEnabled) {
    console.info('[Maintenance] Retention auto-cleanup is disabled, skipping.');
    return { enabled: false, results: [] };
  }

  console.info('[Maintenance] Running retention cleanup...');
  const pool = getTsdbPool();
  const results: Array<{ dataType: string; deleted: number; retentionDays: number }> = [];

  for (const dataType of ['telemetry', 'attributes', 'events', 'traces', 'checklists']) {
    const table = TSDB_TABLE_MAP[dataType];
    if (!table) continue;

    const typeConfig = config[dataType];
    if (!typeConfig) continue;

    let retentionDays: number;
    if (dataType === 'traces') {
      const hours = typeConfig.retentionHours ?? 48;
      retentionDays = hours / 24;
    } else {
      retentionDays = typeConfig.retentionDays;
    }

    if (!retentionDays || retentionDays <= 0) continue;

    try {
      let result;
      if (dataType === 'traces') {
        const hours = typeConfig.retentionHours ?? 48;
        result = await pool.query(
          `DELETE FROM ${table} WHERE time < (NOW() - make_interval(hours => $1))`,
          [hours],
        );
      } else {
        result = await pool.query(
          `DELETE FROM ${table} WHERE time < (NOW() - make_interval(days => $1))`,
          [retentionDays],
        );
      }

      const deleted = result.rowCount ?? 0;
      results.push({ dataType, deleted, retentionDays });

      if (deleted > 0) {
        console.info(
          `[Maintenance] Retention: deleted ${deleted} rows from ${table} (older than ${retentionDays} days)`,
        );
      }
    } catch (err: any) {
      console.error(`[Maintenance] Retention: error cleaning ${table}:`, err.message);
    }
  }

  console.info('[Maintenance] Retention cleanup complete.', JSON.stringify(results));
  return { enabled: true, results };
}

/**
 * Start the maintenance worker — schedules periodic cron jobs.
 */
export function startMaintenanceWorker(): void {
  if (dlqJob) return; // Already started

  // Every 1 minute — DLQ check
  dlqJob = cron.schedule('*/1 * * * *', async () => {
    try {
      await processDLQ();
    } catch (e: any) {
      console.error('[Maintenance] DLQ check failed:', e.message);
    }
  });

  // Every 1 minute — connectivity check
  connectivityJob = cron.schedule('*/1 * * * *', async () => {
    try {
      await checkInactivityTimeouts();
    } catch (e: any) {
      console.error('[Maintenance] Connectivity check failed:', e.message);
    }
  });

  // Every day at midnight — retention cleanup
  retentionJob = cron.schedule('0 0 * * *', async () => {
    try {
      await runRetentionCleanup();
    } catch (e: any) {
      console.error('[Maintenance] Retention cleanup failed:', e.message);
    }
  });

  console.info('[Maintenance] Worker started (node-cron): DLQ check (60s), connectivity check (60s), retention cleanup (daily midnight)');
}

/**
 * Stop the maintenance worker gracefully.
 */
export function stopMaintenanceWorker(): void {
  dlqJob?.stop();
  connectivityJob?.stop();
  retentionJob?.stop();
  dlqJob = null;
  connectivityJob = null;
  retentionJob = null;
  console.info('[Maintenance] Worker stopped');
}
