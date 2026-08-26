/**
 * PM Schedules — shared types used by the My Tasks page and the service
 * layer. Lifted out of `pm-schedule.service.ts` during the module split so
 * each helper file can import them without pulling in the whole service.
 */

export type DueFilterStatus = 'pending' | 'cleaned_in_window' | 'in_progress';
// 'skipped' is NOT derived from cleaning cycles like the others - no cleaning
// happened. It is an operator assertion, persisted on the entry with who/when/
// why, that a missed PM will not be performed. Deliberately distinct from
// 'complete': recording a skip as a completion would put a false statement in
// the audit trail (21 CFR Part 11).
export type DueOverallStatus = 'pending' | 'in_progress' | 'complete' | 'overdue' | 'skipped';

export interface DueFilterRow {
  filterId: string;
  filterName: string;
  status: DueFilterStatus;
  /** Current cleaning lifecycle stage (WASH_IN / WASH_OUT / … ) or null when idle. */
  currentStage: string | null;
  lastCycleCompletedAt: Date | null;
}

export interface DueDeviationContext {
  deviationId: string;
  deviationNumber: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'CLOSED';
  overdueDays: number;
  acknowledged: boolean;
  acknowledgedByName: string | null;
}

export interface DueTaskRow {
  entryId: string;
  ahuId: string;
  ahuName: string;
  // Hierarchy context (AHU → Area → Block) for the My Tasks block/area filters.
  areaId: string | null;
  areaName: string | null;
  blockId: string | null;
  blockName: string | null;
  plannedDate: Date;
  toleranceDays: number;
  windowStart: Date;
  windowEnd: Date;
  totalFilters: number;
  cleanedCount: number;
  overallStatus: DueOverallStatus;
  /** Set when overallStatus is 'skipped' - the operator's recorded reason. */
  skipReason?: string | null;
  skippedByName?: string | null;
  skippedAt?: Date | null;
  /** Set when this task was performed late with a recorded justification. */
  lateReason?: string | null;
  filters: DueFilterRow[];
  // Read-only deviation context (null unless an overdue deviation exists).
  deviation?: DueDeviationContext | null;
}
