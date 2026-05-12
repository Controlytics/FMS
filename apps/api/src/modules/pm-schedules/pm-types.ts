/**
 * PM Schedules — shared types used by the My Tasks page and the service
 * layer. Lifted out of `pm-schedule.service.ts` during the module split so
 * each helper file can import them without pulling in the whole service.
 */

export type DueFilterStatus = 'pending' | 'cleaned_in_window' | 'in_progress';
export type DueOverallStatus = 'pending' | 'in_progress' | 'complete' | 'overdue';

export interface DueFilterRow {
  filterId: string;
  filterName: string;
  status: DueFilterStatus;
  lastCycleCompletedAt: Date | null;
}

export interface DueTaskRow {
  entryId: string;
  ahuId: string;
  ahuName: string;
  plannedDate: Date;
  toleranceDays: number;
  windowStart: Date;
  windowEnd: Date;
  totalFilters: number;
  cleanedCount: number;
  overallStatus: DueOverallStatus;
  filters: DueFilterRow[];
}

export interface DueTasksResponse {
  tasks: DueTaskRow[];
  overdue: DueTaskRow[];
  settings: { showOverdueSeparately: boolean };
}
