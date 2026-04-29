/**
 * In-Process BullMQ Worker — Processes ingestion queue messages.
 * Runs in the same process as the API server (Phase 1 architecture).
 * Concurrency and rate limits read from IngestionSystemConfig at startup.
 */

import { Worker, type Job } from 'bullmq';
import { getWorkerConnection, QUEUES } from '@digilog/queue';
import type { IngestionMessage } from '../modules/data-ingestion/message-normalizer.js';
import { processIngestionMessage } from '../modules/data-ingestion/ingestion.service.js';
import { getConfigOrDefault } from '../modules/data-ingestion/ingestion-config.service.js';

let worker: Worker | null = null;

/**
 * Start the ingestion worker.
 * Reads concurrency from SystemConfig 'ingestion.worker_concurrency' (default 5).
 */
export async function startIngestionWorker(): Promise<void> {
  if (worker) return;

  const concurrency = await getConfigOrDefault<number>('ingestion.worker_concurrency', 5);

  worker = new Worker(
    QUEUES.INGESTION.name,
    async (job: Job) => {
      const msg = job.data as IngestionMessage;

      const result = await processIngestionMessage(msg);

      if (!result.success) {
        // The message was routed to DLQ by the pipeline service
        // Don't throw — DLQ handles retries
        console.warn(`[IngestionWorker] Message ${msg.messageId} failed, routed to DLQ`);
      }

      return result;
    },
    {
      connection: getWorkerConnection(),
      concurrency,
      limiter: {
        max: 1000,
        duration: 1000, // 1000 jobs per second max
      },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1000 },
    },
  );

  worker.on('completed', (job) => {
    // Job completed — logged at debug level only
    if (process.env.NODE_ENV !== 'production') {
      console.info(`[IngestionWorker] Job ${job.id} completed`);
    }
  });

  worker.on('failed', (job, err) => {
    console.error(`[IngestionWorker] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[IngestionWorker] Worker error:', err.message);
  });

  console.info(`[IngestionWorker] Started with concurrency=${concurrency}`);
}

/**
 * Stop the ingestion worker gracefully.
 */
export async function stopIngestionWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    console.info('[IngestionWorker] Stopped');
  }
}
