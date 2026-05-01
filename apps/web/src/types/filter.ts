/**
 * Filter Management types — shared across filter-management frontend pages.
 */

export interface FilterInstance {
  id: string;
  name: string;
  description?: string | null;
  templateId: string;
  status: string;
  isActive: boolean;
  currentLifecycleState: string | null;
  currentCycleId: string | null;
  filterProfileId: string | null;
  filterSet: string | null;
  parentId?: string | null;
  attributes?: Record<string, any>;
  template?: { name: string };
}

export interface CleaningProfile {
  id: string;
  name: string;
  description?: string | null;
  flowMode: string;
  version: number;
  status: 'ACTIVE' | 'INACTIVE' | 'DRAFT' | 'ARCHIVED';
  stageCount: number;
  connectionCount: number;
  createdAt: string;
}

export interface PipelineStage {
  id: string;
  stateKey: string | null;
  nodeType: 'START' | 'END' | 'STAGE' | 'CHECKLIST';
  label?: string;
  configuration?: Record<string, any>;
  positionX?: number;
  positionY?: number;
  sortOrder?: number;
}

export interface PipelineConnection {
  id: string;
  fromStageId: string;
  toStageId: string;
  label?: string;
}

export interface FilterProfile {
  id: string;
  name: string;
  description?: string | null;
  cleaningProfileId: string;
  defaultPmScheduleId?: string | null;
  blockRestriction?: string;
  maxCleaningCycles?: number | null;
  isActive: boolean;
  cleaningProfileName?: string;
  activeFilterCount?: number;
}

export interface CleaningCycle {
  id: string;
  cycleCode: string;
  filterId: string;
  filterName?: string;
  filterSet?: string;
  profileId: string;
  profileVersion: number;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'TERMINATED';
  sequenceNumber: number;
  startedAt: string;
  completedAt?: string | null;
  cleaningReasonKey: string;
  cleaningReasonLabel: string;
  cleaningJustification?: string | null;
  events?: FilterEvent[];
}

export interface FilterEvent {
  id: string;
  filterId: string;
  cycleId?: string | null;
  eventType: string;
  fromState?: string | null;
  toState?: string | null;
  performedBy: string;
  performedByName?: string;
  performedAt: string;
  attributes?: Record<string, any>;
  remarks?: string | null;
  deviationDetails?: Record<string, any> | null;
  checksum?: string;
}

export interface PmSchedule {
  id: string;
  name: string;
  entityId?: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  entries: PmScheduleEntry[];
}

export interface PmScheduleEntry {
  id: string;
  scheduleId: string;
  month: number;
  year: number;
  dueDate: string;
  toleranceDays?: number;
}

export interface PmExecution {
  id: string;
  scheduleEntryId: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE' | 'MISSED';
  performedBy: string;
  completedAt?: string | null;
}

export interface ChecklistProfile {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  questions: ChecklistQuestion[];
}

export interface ChecklistQuestion {
  id: string;
  question: string;
  questionType: string;
  required: boolean;
  section?: string | null;
  description?: string | null;
  options?: any[];
  sortOrder?: number;
}

export interface EquipmentGroup {
  id: string;
  name: string;
  blockId: string;
  isActive: boolean;
  instruments: EquipmentGroupInstrument[];
}

export interface EquipmentGroupInstrument {
  id: string;
  description: string;
  stageKey: string;
  serialNumber: string;
  instrumentId: string;
  uom: string;
  instrumentMin: number;
  instrumentMax: number;
  operatingMin: number;
  operatingMax: number;
  leastCount: number;
  sortOrder: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
