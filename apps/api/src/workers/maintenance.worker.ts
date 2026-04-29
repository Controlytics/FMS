/**
 * Maintenance tasks — graphile-worker entry points.
 *
 * Phase 2 of the windows-friendly rewrite (see docs/plans/2026-04-29-windows-friendly-rewrite.md
 * § Task 2.7) migrated the BullMQ maintenance Worker (3 cron-style repeatable
 * jobs: DLQ check / connectivity check / retention cleanup) onto graphile-worker.
 * Schedules live in `packages/queue/crontab.txt` and are loaded by the single
 * Runner registered in `app.ts` boot (Task 2.8).
 *
 * Task 2.10 dropped the legacy BullMQ Worker; the retention cleanup logic
 * remains in `./maintenance-retention.ts` (extracted during the migration so
 * both queue paths shared the same code).
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
