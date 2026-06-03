/**
 * PM overdue deviation sweep — graphile-worker daily cron entry point.
 *
 * Schedule lives in packages/queue/crontab.txt (`0 3 * * * pm_overdue_check`)
 * and is loaded by the single Runner in app.ts. Opens deviations for newly
 * overdue PM tasks and closes those whose filters have since been cleaned —
 * idempotent, so the daily cadence never produces duplicates. PM-disabled is a
 * benign skip, not a runner failure.
 *
 * NOTE: the cron only fires when the job runner is started (USE_PG_QUEUE). In
 * local dev that's usually off, so the manual `POST /api/pm-schedules/deviations/sweep`
 * endpoint is the dev/test trigger.
 */
import type { Task } from 'graphile-worker';
import { sweepOverdueDeviations } from '../modules/pm-schedules/pm-deviations.js';

export const pmOverdueCheckTask: Task = async (_payload, helpers) => {
  try {
    const r = await sweepOverdueDeviations();
    helpers.logger.info(`[PM Overdue] swept: opened=${r.opened} closed=${r.closed}`);
  } catch (e: any) {
    helpers.logger.warn(`[PM Overdue] sweep skipped: ${e?.message ?? String(e)}`);
  }
};
