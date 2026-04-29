/**
 * Maintenance tasks — graphile-worker entry points.
 *
 * Phase 2 of the windows-friendly rewrite (see docs/plans/2026-04-29-windows-friendly-rewrite.md
 * § Task 2.7) migrates the BullMQ maintenance Worker (3 cron-style repeatable
 * jobs: DLQ check / connectivity check / retention cleanup) onto graphile-worker.
 *
 * Schedules live in `packages/queue/crontab.txt` and are loaded by the Runner
 * in Task 2.8. The actual cleanup logic for retention is shared with the
 * legacy BullMQ Worker (`maintenance.worker.bullmq.ts`) via
 * `./maintenance-retention.ts` so both queue paths run the same code.
 *
 * The legacy `start/stopMaintenanceWorker` exports are re-exported from the
 * BullMQ sibling so the existing app.ts boot path keeps compiling during the
 * migration window. Both are removed entirely in Task 2.10.
 */

import type { Task } from 'graphile-worker';
import { processDLQ } from '../modules/data-ingestion/dlq-manager.js';
import { checkInactivityTimeouts } from '../modules/data-ingestion/connectivity-tracker.js';
import { runRetentionCleanup } from './maintenance-retention.js';

export const dlqCheckTask: Task = async (_payload, helpers) => {
  const result = await processDLQ();
  helpers.logger.info(`[Maintenance] DLQ check: ${JSON.stringify(result)}`);
};

export const connectivityCheckTask: Task = async (_payload, helpers) => {
  const offlineCount = await checkInactivityTimeouts();
  helpers.logger.info(`[Maintenance] Connectivity check: ${offlineCount} offline`);
};

export const retentionCleanupTask: Task = async (_payload, helpers) => {
  const result = await runRetentionCleanup();
  helpers.logger.info(`[Maintenance] Retention: ${JSON.stringify(result)}`);
};

// Re-export legacy BullMQ start/stop functions so app.ts (and any other
// caller) doesn't break during the migration window. Removed in Task 2.10.
export { startMaintenanceWorker, stopMaintenanceWorker } from './maintenance.worker.bullmq.js';
