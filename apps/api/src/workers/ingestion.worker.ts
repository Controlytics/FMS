/**
 * Ingestion Worker — Processes ingestion queue messages via pg-boss.
 * Runs in the same process as the API server.
 * Concurrency read from SystemConfig at startup.
 */

import { getBoss, QUEUES } from '@digilog/queue';
import type { IngestionMessage } from '../modules/data-ingestion/message-normalizer.js';
import { processIngestionMessage } from '../modules/data-ingestion/ingestion.service.js';
import { getConfigOrDefault } from '../modules/data-ingestion/ingestion-config.service.js';

let isRunning = false;

/**
 * Start the ingestion worker.
 * Reads concurrency from SystemConfig 'ingestion.worker_concurrency' (default 5).
 */
export async function startIngestionWorker(): Promise<void> {
  if (isRunning) return;

  const concurrency = await getConfigOrDefault<number>('ingestion.worker_concurrency', 5);
  const boss = await getBoss();

  await boss.work(
    QUEUES.INGESTION,
    { teamSize: concurrency, teamConcurrency: concurrency },
    async (job) => {
      const msg = job.data as IngestionMessage;

      const result = await processIngestionMessage(msg);

      if (!result.success) {
        // The message was routed to DLQ by the pipeline service
        // Don't throw — DLQ handles retries
        console.warn(`[IngestionWorker] Message ${msg.messageId} failed, routed to DLQ`);
      }

      return result;
    },
  );

  isRunning = true;
  console.info(`[IngestionWorker] Started (pgboss) with concurrency=${concurrency}`);
}

/**
 * Stop the ingestion worker gracefully.
 */
export async function stopIngestionWorker(): Promise<void> {
  if (isRunning) {
    const boss = await getBoss();
    await boss.offWork(QUEUES.INGESTION);
    isRunning = false;
    console.info('[IngestionWorker] Stopped');
  }
}
