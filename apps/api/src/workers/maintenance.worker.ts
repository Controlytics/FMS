/**
 * Maintenance Worker — Handles periodic maintenance tasks via BullMQ.
 * Tasks: DLQ processing, connectivity timeout checks, cleanup.
 * Uses repeatable jobs scheduled at startup.
 */

import { Worker, Queue, type Job } from 'bullmq';
import { getQueueConnection, getWorkerConnection, QUEUES } from '@digilog/queue';
import type { MaintenanceJob } from '@digilog/queue';
import { processDLQ } from '../modules/data-ingestion/dlq-manager.js';
import { checkInactivityTimeouts } from '../modules/data-ingestion/connectivity-tracker.js';
import { prisma } from '../lib/prisma.js';
import { getTsdbPool } from '@digilog/db';

let worker: Worker | null = null;
let maintenanceQueue: Queue | null = null;

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
 * Start the maintenance worker and schedule repeatable jobs.
 */
export async function startMaintenanceWorker(): Promise<void> {
  if (worker) return;

  // Create queue for scheduling (producer — shared connection)
  maintenanceQueue = new Queue(QUEUES.MAINTENANCE.name, {
    connection: getQueueConnection(),
    defaultJobOptions: QUEUES.MAINTENANCE.defaultJobOptions,
  });

  // Schedule repeatable jobs
  // DLQ check: every 60 seconds
  await maintenanceQueue.add('dlq_check', {
    task: 'dlq_check',
  } satisfies MaintenanceJob, {
    repeat: { every: 60_000 },
    jobId: 'maintenance-dlq-check',
    removeOnComplete: 5,
    removeOnFail: 10,
  });

  // Connectivity check: every 60 seconds
  await maintenanceQueue.add('connectivity_check', {
    task: 'connectivity_check',
  } satisfies MaintenanceJob, {
    repeat: { every: 60_000 },
    jobId: 'maintenance-connectivity-check',
    removeOnComplete: 5,
    removeOnFail: 10,
  });

  // Retention cleanup: every 24 hours (86400 seconds)
  await maintenanceQueue.add('retention_cleanup', {
    task: 'retention',
  } satisfies MaintenanceJob, {
    repeat: { every: 86_400_000 },
    jobId: 'maintenance-retention-cleanup',
    removeOnComplete: 5,
    removeOnFail: 10,
  });

  // Worker
  worker = new Worker(
    QUEUES.MAINTENANCE.name,
    async (job: Job) => {
      const data = job.data as MaintenanceJob;

      switch (data.task) {
        case 'dlq_check': {
          const result = await processDLQ();
          return { task: 'dlq_check', ...result };
        }
        case 'connectivity_check': {
          const offlineCount = await checkInactivityTimeouts();
          return { task: 'connectivity_check', offlineCount };
        }
        case 'retention': {
          const retentionResult = await runRetentionCleanup();
          return { task: 'retention', ...retentionResult };
        }
        default:
          console.warn(`[Maintenance] Unknown task: ${data.task}`);
          return { task: data.task, skipped: true };
      }
    },
    {
      connection: getWorkerConnection(),
      concurrency: 1, // Maintenance tasks run sequentially
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[Maintenance] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[Maintenance] Worker error:', err.message);
  });

  console.info('[Maintenance] Worker started with DLQ check (60s), connectivity check (60s), retention cleanup (24h)');
}

/**
 * Stop the maintenance worker gracefully.
 */
export async function stopMaintenanceWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (maintenanceQueue) {
    await maintenanceQueue.close();
    maintenanceQueue = null;
  }
  console.info('[Maintenance] Worker stopped');
}
