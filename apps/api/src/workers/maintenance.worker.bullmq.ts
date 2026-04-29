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
import { runRetentionCleanup } from './maintenance-retention.js';

let worker: Worker | null = null;
let maintenanceQueue: Queue | null = null;

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
