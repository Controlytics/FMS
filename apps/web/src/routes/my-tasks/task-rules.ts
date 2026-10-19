/**
 * My Tasks rules shared by the web page (routes/my-tasks/index.tsx) and the
 * tablet task list (routes/mobile/mobile-wrapper.tsx). One copy, so the two
 * clients cannot disagree about when Perform is offered or when it must ask
 * for a password first.
 */

export type TaskOverallStatus = 'pending' | 'in_progress' | 'complete' | 'overdue' | 'not_performed';

export interface TaskDeviationLike {
  deviationId: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'CLOSED' | string;
  acknowledged: boolean;
}

/**
 * OQ-13 (2026-10-19): a written-off visit (`not_performed`) is finished
 * business exactly like a completed one — it was recorded, with a reason, as
 * NOT done. Offering Perform on it invited a cleaning "for" a visit already
 * closed. Neither state gets a Perform button.
 */
export function isTaskTerminal(status: string | null | undefined): boolean {
  return status === 'complete' || status === 'not_performed';
}

/**
 * Overdue + a deviation that is neither closed nor acknowledged → the operator
 * confirms with their password before cleaning starts
 * (POST /api/pm-schedules/deviations/:id/acknowledge, ACKNOWLEDGE_PM_OVERDUE).
 */
export function needsOverdueAck(task: { overallStatus?: string; deviation?: TaskDeviationLike | null }): boolean {
  const dev = task.deviation;
  return task.overallStatus === 'overdue' && !!dev && dev.status !== 'CLOSED' && !dev.acknowledged;
}
