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
 * `messageType` is intentionally NOT a top-level field — it lives on `msg`
 * itself, so wrapping it again would just duplicate state that can drift.
 */
interface IngestionTaskPayload {
  msg: IngestionMessage;
}

/** Discriminate `unknown` payload as an IngestionTaskPayload. */
function isIngestionTaskPayload(p: unknown): p is IngestionTaskPayload {
  return (
    typeof p === 'object' &&
    p !== null &&
    'msg' in p &&
    typeof (p as { msg: unknown }).msg === 'object' &&
    (p as { msg: unknown }).msg !== null
  );
}

export const ingestionTask: Task = async (payload, helpers) => {
  // graphile-worker types `payload` as unknown — a malformed PG queue row
  // would otherwise NPE deep in processIngestionMessage. Throwing here lets
  // graphile-worker retry per maxAttempts, then dead-letter the row.
  if (!isIngestionTaskPayload(payload)) {
    helpers.logger.error('Malformed ingestion payload — discarding', {
      payload: payload as Record<string, unknown>,
    });
    throw new Error('INVALID_INGESTION_PAYLOAD');
  }

  const { msg } = payload;

  const result = await processIngestionMessage(msg);

  if (!result.success) {
    // The pipeline service routes the failure to the DLQ; log only.
    helpers.logger.warn(`Message ${msg.messageId} failed, routed to DLQ`);
  }
};

// Re-export legacy BullMQ start/stop functions so app.ts (and any other
// caller) doesn't break during the migration window. Removed in Task 2.10.
export { startIngestionWorker, stopIngestionWorker } from './ingestion.worker.bullmq.js';
