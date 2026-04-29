/**
 * Retention cleanup logic — invoked from the graphile-worker
 * `retentionCleanupTask` in `maintenance.worker.ts`.
 *
 * Originally extracted so both the BullMQ Worker and the graphile-worker
 * task could run the same cleanup. Task 2.10 dropped the BullMQ Worker, so
 * this could fold back into `maintenance.worker.ts` — kept separate for now
 * because the body is meaty (~200 LOC) and the task module stays clean.
 */

import { prisma } from '../lib/prisma.js';
import { getTsdbPool } from '@digilog/db';

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
export async function runRetentionCleanup(): Promise<{
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
