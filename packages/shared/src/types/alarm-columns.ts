export interface AlarmColumnDefinition {
  id: string;
  label: string;
  description: string;
}

export const ALARM_COLUMN_DEFINITIONS: AlarmColumnDefinition[] = [
  { id: 'severity', label: 'Severity', description: 'Alarm severity level (CRITICAL, MAJOR, MINOR, WARNING, INFO)' },
  { id: 'alarmType', label: 'Alarm Type', description: 'Type of alarm that was triggered' },
  { id: 'entity', label: 'Entity', description: 'Entity name or ID associated with the alarm' },
  { id: 'highLimit', label: 'High Limit', description: 'Upper threshold value that triggered the alarm' },
  { id: 'lowLimit', label: 'Low Limit', description: 'Lower threshold value that triggered the alarm' },
  { id: 'generatedValue', label: 'Generated Value', description: 'Value at the time the alarm was generated' },
  { id: 'clearedValue', label: 'Cleared Value', description: 'Value at the time the alarm was cleared' },
  { id: 'status', label: 'Status', description: 'Current alarm status (Active, Acknowledged, Cleared)' },
  { id: 'generatedAt', label: 'Generated At', description: 'Timestamp when the alarm was generated' },
  { id: 'clearedAt', label: 'Cleared At', description: 'Timestamp when the alarm was cleared' },
  { id: 'actions', label: 'Actions', description: 'Acknowledge and clear action buttons' },
];

export const ALL_ALARM_COLUMN_IDS = ALARM_COLUMN_DEFINITIONS.map(c => c.id);
