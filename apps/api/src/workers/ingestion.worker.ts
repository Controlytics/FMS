/**
 * Ingestion task — graphile-worker entry point.
 *
 * Phase 2 of the windows-friendly rewrite (see docs/plans/2026-04-29-windows-friendly-rewrite.md
 * § Task 2.3) migrates the ingestion queue from BullMQ to graphile-worker.
 * The actual business logic still lives in `processIngestionMessage` and is shared
 * with the BullMQ Worker in `ingestion.worker.bullmq.ts`.
 *
 * Wiring into the runner happens in Task 2.8 (job-runner.ts). The legacy BullMQ
 * `start/stopIngestionWorker` functions are re-exported below so the existing
 * `app.ts` boot path keeps compiling during the migration window. Both are
 * removed entirely in Task 2.10.
 */

import type { Task } from 'graphile-worker';
import type { IngestionMessage } from '../modules/data-ingestion/message-normalizer.js';
import { processIngestionMessage } from '../modules/data-ingestion/ingestion.service.js';

/**
 * Payload shape produced by `enqueueIngestionJob` in ingestion.service.ts.
 * `messageType` is also available on `msg.messageType` but we keep the wrapper
 * so the queue payload mirrors BullMQ's job-name-as-routing-tag semantics
 * (graphile-worker has a single task name `'ingestion'` for all message types).
 */
interface IngestionTaskPayload {
  messageType: string;
  msg: IngestionMessage;
}

export const ingestionTask: Task = async (payload, helpers) => {
  const { msg } = payload as IngestionTaskPayload;

  const result = await processIngestionMessage(msg);

  if (!result.success) {
    // The pipeline service routes the failure to the DLQ; log only.
    helpers.logger.warn(`Message ${msg.messageId} failed, routed to DLQ`);
  }
};

// Re-export legacy BullMQ start/stop functions so app.ts (and any other
// caller) doesn't break during the migration window. Removed in Task 2.10.
export { startIngestionWorker, stopIngestionWorker } from './ingestion.worker.bullmq.js';
