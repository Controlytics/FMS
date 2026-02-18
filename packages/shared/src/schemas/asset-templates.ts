import { z } from 'zod';

// Reusable numeric constraints schema (Section 1.11)
export const numericConstraintsSchema = z.object({
  enableConstraints: z.boolean().default(false),
  min: z.number().optional(),
  max: z.number().optional(),
  resolution: z.number().positive().optional(),
}).refine(data => {
  if (data.min !== undefined && data.max !== undefined) return data.max >= data.min;
  return true;
}, { message: 'Max must be >= Min' });

// Attribute data types
export const attributeDataTypeEnum = z.enum([
  'TEXT', 'INTEGER', 'FLOAT', 'DATE', 'DATETIME', 'BOOLEAN', 'DROPDOWN', 'URL', 'FILE',
]);

// Telemetry data types
export const telemetryDataTypeEnum = z.enum([
  'INTEGER', 'FLOAT', 'BOOLEAN', 'STRING', 'ENUM',
]);

// Checklist question types (Section 1.7.2)
export const questionTypeEnum = z.enum([
  'PASS_FAIL', 'MCQ', 'MULTI_SELECT', 'FILL_TEXT', 'FILL_NUMERIC',
  'DROPDOWN', 'NUMERIC_WITH_LIMITS', 'PHOTO_EVIDENCE', 'DATE_TIME',
  'SIGNATURE', 'YES_NO_WITH_COMMENT', 'CALCULATED_FIELD', 'CONDITIONAL_FIELD',
]);

// Attribute definition schema
export const attributeDefinitionSchema = z.object({
  fieldName: z.string().min(1).max(255),
  dataType: attributeDataTypeEnum,
  required: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  unit: z.string().max(50).optional(),
  dropdownOptions: z.array(z.string()).optional(),
  numericConstraints: numericConstraintsSchema.optional(),
});

// Telemetry point definition schema
export const telemetryDefinitionSchema = z.object({
  pointName: z.string().min(1).max(255),
  dataType: telemetryDataTypeEnum,
  unit: z.string().max(50).optional(),
  enumOptions: z.array(z.string()).optional(),
  dataSource: z.enum(['MANUAL', 'AUTOMATIC', 'BOTH']).default('MANUAL'),
  numericConstraints: numericConstraintsSchema.optional(),
  alarmLimits: z.object({
    high: z.number().optional(),
    low: z.number().optional(),
    highHigh: z.number().optional(),
    lowLow: z.number().optional(),
    rateOfChange: z.number().optional(),
    deadband: z.number().optional(),
  }).optional(),
});

// Checklist question definition schema
export const questionDefinitionSchema = z.object({
  questionId: z.string().min(1),
  questionText: z.string().min(1),
  questionType: questionTypeEnum,
  required: z.boolean().default(false),
  order: z.number().int().min(0),
  options: z.array(z.string()).optional(),
  dataType: z.enum(['INTEGER', 'FLOAT']).optional(),
  enableConstraints: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  resolution: z.number().positive().optional(),
  unit: z.string().max(50).optional(),
  formula: z.string().optional(),
  formulaDependencies: z.array(z.string()).optional(),
  condition: z.object({
    dependsOnQuestionId: z.string(),
    operator: z.enum(['EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'LESS_THAN', 'IN']),
    value: z.unknown(),
  }).optional(),
  commentRequired: z.enum(['ALWAYS', 'ON_FAIL', 'ON_NO', 'NEVER']).optional(),
  linkedTelemetryPoint: z.string().optional(),
  helpText: z.string().optional(),
});

// Checklist definition schema
export const checklistDefinitionSchema = z.object({
  checklistName: z.string().min(1).max(255),
  checklistType: z.enum(['CHECKLIST', 'RECORD_LIST']).default('CHECKLIST'),
  description: z.string().optional(),
  questions: z.array(questionDefinitionSchema),
  performedByRole: z.string().optional(),
  checkedByEnabled: z.boolean().default(false),
  checkedByRole: z.string().optional(),
  verifiedByEnabled: z.boolean().default(false),
  verifiedByRole: z.string().optional(),
  defaultSchedule: z.object({
    frequency: z.string(),
    toleranceMinutes: z.number().int().min(0).default(0),
  }).optional(),
});

// Expected relationship hint
export const expectedRelationshipSchema = z.object({
  relationshipType: z.enum(['CONTAINS', 'CONNECTED_TO', 'FEEDS', 'DEPENDS_ON', 'BACKS_UP', 'MONITORS', 'CUSTOM']),
  description: z.string().optional(),
});

// Expected identifier
export const expectedIdentifierSchema = z.object({
  identifierType: z.enum(['QR', 'BARCODE', 'RFID', 'NFC', 'MANUAL']),
  required: z.boolean().default(false),
});

// Status lifecycle entry
export const statusLifecycleSchema = z.object({
  status: z.string().min(1),
  color: z.string().optional(),
  allowedTransitions: z.array(z.string()).default([]),
});

// Alarm rule definition
export const alarmRuleDefinitionSchema = z.object({
  ruleName: z.string().min(1),
  ruleType: z.enum(['TELEMETRY_THRESHOLD', 'CHECKLIST_LOGIC', 'SCHEDULE_MISSED', 'CUSTOM_SCRIPT']),
  condition: z.record(z.unknown()),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  actions: z.array(z.object({
    actionType: z.enum(['NOTIFY', 'BLOCK_TRANSITION', 'FLAG_REVIEW', 'CREATE_DEVIATION']),
    notifyRoles: z.array(z.string()).optional(),
    notifyUsers: z.array(z.string()).optional(),
    blockTransitionTo: z.string().optional(),
    message: z.string().optional(),
  })),
  enabled: z.boolean().default(true),
});

// Create asset template schema
export const createAssetTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  icon: z.string().max(50).optional(),
  category: z.string().max(100).optional(),
  attributeSchema: z.array(attributeDefinitionSchema).default([]),
  telemetrySchema: z.array(telemetryDefinitionSchema).default([]),
  checklistSchema: z.array(checklistDefinitionSchema).default([]),
  recordListSchema: z.array(checklistDefinitionSchema).default([]),
  expectedRelationships: z.array(expectedRelationshipSchema).default([]),
  expectedIdentifiers: z.array(expectedIdentifierSchema).default([]),
  defaultAlarmRules: z.array(alarmRuleDefinitionSchema).default([]),
  statusLifecycle: z.array(statusLifecycleSchema).default([
    { status: 'Active', color: '#22c55e', allowedTransitions: ['Inactive', 'Under_Maintenance', 'Decommissioned'] },
    { status: 'Inactive', color: '#94a3b8', allowedTransitions: ['Active'] },
    { status: 'Under_Maintenance', color: '#f59e0b', allowedTransitions: ['Active', 'Decommissioned'] },
    { status: 'Commissioning', color: '#3b82f6', allowedTransitions: ['Active'] },
    { status: 'Decommissioned', color: '#ef4444', allowedTransitions: [] },
  ]),
});

// Update asset template schema
export const updateAssetTemplateSchema = createAssetTemplateSchema.partial().extend({
  reason: z.string().min(1, 'Change reason is required'),
});

// Export types
export type NumericConstraints = z.infer<typeof numericConstraintsSchema>;
export type AttributeDataType = z.infer<typeof attributeDataTypeEnum>;
export type TelemetryDataType = z.infer<typeof telemetryDataTypeEnum>;
export type QuestionType = z.infer<typeof questionTypeEnum>;
export type AttributeDefinition = z.infer<typeof attributeDefinitionSchema>;
export type TelemetryDefinition = z.infer<typeof telemetryDefinitionSchema>;
export type QuestionDefinition = z.infer<typeof questionDefinitionSchema>;
export type ChecklistDefinition = z.infer<typeof checklistDefinitionSchema>;
export type CreateAssetTemplateInput = z.infer<typeof createAssetTemplateSchema>;
export type UpdateAssetTemplateInput = z.infer<typeof updateAssetTemplateSchema>;
