// ---------------------------------------------------------------------------
// Types for Entity Template Manager
// ---------------------------------------------------------------------------

export interface AttributeDef {
  fieldName: string;
  dataType: 'TEXT' | 'INTEGER' | 'FLOAT' | 'DATE' | 'DATETIME' | 'BOOLEAN' | 'DROPDOWN' | 'URL' | 'FILE';
  required: boolean;
  unit: string;
  defaultValue: string;
  options?: string; // comma-separated, for DROPDOWN
  enableConstraints?: boolean;
  min?: number | '';
  max?: number | '';
  resolution?: number | '';
}

export interface IdentifierDef {
  identifierType: 'QR' | 'BARCODE' | 'RFID' | 'NFC' | 'MANUAL';
  label: string;
  required: boolean;
}

export interface AlarmRuleDef {
  name: string;
  type: 'HIGH' | 'LOW' | 'HIGH_HIGH' | 'LOW_LOW' | 'RATE_OF_CHANGE' | 'BOOLEAN_STATE' | 'CUSTOM';
  severity: 'WARNING' | 'ALARM' | 'CRITICAL';
  sourceField: string;
  condition: string;
  threshold: number | '';
  deadband: number | '';
  message: string;
  notifyRoles: string; // comma-separated
  enabled: boolean;
}

export interface TelemetryDef {
  fieldName: string;
  dataType: string;
  unit: string;
  description: string;
}

export interface ChecklistItemDef {
  question: string;
  questionType: 'PASS_FAIL' | 'YES_NO' | 'YES_NO_NA' | 'MCQ' | 'MULTI_SELECT' | 'TEXT' | 'NUMERIC' | 'DROPDOWN' | 'PHOTO' | 'DATE_TIME' | 'SIGNATURE' | 'YES_NO_COMMENT' | 'CALCULATED' | 'CONDITIONAL';
  required: boolean;
  section: string;
  description: string;
  options: string; // comma-separated, for MCQ/MULTI_SELECT/DROPDOWN
  passCriteria: string; // for PASS_FAIL
  numericUnit: string; // for NUMERIC
  numericMin: number | '';
  numericMax: number | '';
  calculatedExpression: string; // for CALCULATED
  conditionalField: string; // for CONDITIONAL
  conditionalValue: string; // for CONDITIONAL
}

export interface TemplateData {
  id: string;
  name: string;
  description: string;
  icon: string;
  version: number;
  attributeSchema: AttributeDef[];
  telemetrySchema: TelemetryDef[];
  expectedIdentifiers: IdentifierDef[];
  alarmRules: AlarmRuleDef[];
  checklistSchema: ChecklistItemDef[];
  maxParentConnections: number;
  maxConnections: number;
  isActive: boolean;
  _count?: { instances: number };
}

export interface FormData {
  name: string;
  description: string;
  icon: string;
  maxParentConnections: number;
  maxConnections: number;
  attributeSchema: AttributeDef[];
  telemetrySchema: TelemetryDef[];
  expectedIdentifiers: IdentifierDef[];
  alarmRules: AlarmRuleDef[];
  checklistSchema: ChecklistItemDef[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ICONS = [
  { value: 'box', label: 'Box' },
  { value: 'server', label: 'Server' },
  { value: 'camera', label: 'Camera' },
  { value: 'thermometer', label: 'Thermometer' },
  { value: 'building', label: 'Building' },
  { value: 'door-open', label: 'Door' },
  { value: 'truck', label: 'Truck' },
  { value: 'wrench', label: 'Wrench' },
  { value: 'shield', label: 'Shield' },
  { value: 'monitor', label: 'Monitor' },
] as const;

export const ATTRIBUTE_DATA_TYPES = ['TEXT', 'INTEGER', 'FLOAT', 'DATE', 'DATETIME', 'BOOLEAN', 'DROPDOWN', 'URL', 'FILE'] as const;
export const IDENTIFIER_TYPES = ['QR', 'BARCODE', 'RFID', 'NFC', 'MANUAL'] as const;
export const TELEMETRY_DATA_TYPES = ['INTEGER', 'FLOAT', 'BOOLEAN', 'STRING', 'ENUM'] as const;
export const ALARM_RULE_TYPES = ['HIGH', 'LOW', 'HIGH_HIGH', 'LOW_LOW', 'RATE_OF_CHANGE', 'BOOLEAN_STATE', 'CUSTOM'] as const;
export const ALARM_SEVERITIES = ['WARNING', 'ALARM', 'CRITICAL'] as const;
export const CHECKLIST_QUESTION_TYPES = [
  'PASS_FAIL', 'YES_NO', 'YES_NO_NA', 'MCQ', 'MULTI_SELECT',
  'TEXT', 'NUMERIC', 'DROPDOWN', 'PHOTO', 'DATE_TIME',
  'SIGNATURE', 'YES_NO_COMMENT', 'CALCULATED', 'CONDITIONAL',
] as const;

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export function emptyAttribute(): AttributeDef {
  return { fieldName: '', dataType: 'TEXT', required: false, unit: '', defaultValue: '', options: '', enableConstraints: false, min: '', max: '', resolution: '' };
}

export function emptyIdentifier(): IdentifierDef {
  return { identifierType: 'QR', label: '', required: false };
}

export function emptyTelemetry(): TelemetryDef {
  return { fieldName: '', dataType: 'FLOAT', unit: '', description: '' };
}

export function emptyAlarmRule(): AlarmRuleDef {
  return { name: '', type: 'HIGH', severity: 'ALARM', sourceField: '', condition: '', threshold: '', deadband: '', message: '', notifyRoles: '', enabled: true };
}

export function emptyChecklistItem(): ChecklistItemDef {
  return { question: '', questionType: 'PASS_FAIL', required: false, section: '', description: '', options: '', passCriteria: '', numericUnit: '', numericMin: '', numericMax: '', calculatedExpression: '', conditionalField: '', conditionalValue: '' };
}

export function emptyForm(): FormData {
  return {
    name: '',
    description: '',
    icon: 'box',
    maxParentConnections: 1,
    maxConnections: 10,
    attributeSchema: [],
    telemetrySchema: [],
    expectedIdentifiers: [],
    alarmRules: [],
    checklistSchema: [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the numeric constraint preview string. */
export function constraintPreview(min: number | '' | undefined, max: number | '' | undefined, resolution: number | '' | undefined): string | null {
  const mn = typeof min === 'number' ? min : undefined;
  const mx = typeof max === 'number' ? max : undefined;
  const res = typeof resolution === 'number' && resolution > 0 ? resolution : undefined;
  if (mn === undefined || mx === undefined || res === undefined) return null;
  if (mx <= mn) return null;
  const count = Math.floor((mx - mn) / res) + 1;
  if (count <= 0) return null;
  const values: number[] = [];
  for (let i = 0; i < Math.min(3, count); i++) {
    values.push(mn + i * res);
  }
  const last3: number[] = [];
  for (let i = Math.max(0, count - 3); i < count; i++) {
    const v = mn + i * res;
    if (!values.includes(v)) last3.push(v);
  }
  const parts = values.map((v) => String(v));
  if (last3.length > 0) parts.push('...', ...last3.map((v) => String(v)));
  return `Valid values: ${parts.join(', ')}`;
}
