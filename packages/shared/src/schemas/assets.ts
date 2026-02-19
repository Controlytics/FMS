import { z } from 'zod';

// =============================================
// Attribute Schema Definitions
// =============================================

export const ATTRIBUTE_DATA_TYPES = [
  'TEXT', 'INTEGER', 'FLOAT', 'DATE', 'DATETIME', 'BOOLEAN', 'DROPDOWN', 'URL', 'FILE',
] as const;

export const TELEMETRY_DATA_TYPES = [
  'INTEGER', 'FLOAT', 'BOOLEAN', 'STRING', 'ENUM',
] as const;

export const RELATIONSHIP_TYPES = [
  'CONTAINS', 'CONTAINED_IN', 'CONNECTED_TO',
  'FEEDS', 'FED_BY', 'DEPENDS_ON', 'DEPENDED_ON_BY',
  'BACKS_UP', 'BACKED_UP_BY', 'MONITORS', 'MONITORED_BY',
  'CUSTOM',
] as const;

export const IDENTIFIER_TYPES = [
  'QR', 'BARCODE', 'RFID', 'NFC', 'MANUAL',
] as const;

export const ASSET_STATUSES = [
  'Active', 'Inactive', 'Under Maintenance', 'Commissioning', 'Decommissioned',
] as const;

// Inverse relationship mapping
export const INVERSE_RELATIONSHIP_MAP: Record<string, string> = {
  CONTAINS: 'CONTAINED_IN',
  CONTAINED_IN: 'CONTAINS',
  CONNECTED_TO: 'CONNECTED_TO',
  FEEDS: 'FED_BY',
  FED_BY: 'FEEDS',
  DEPENDS_ON: 'DEPENDED_ON_BY',
  DEPENDED_ON_BY: 'DEPENDS_ON',
  BACKS_UP: 'BACKED_UP_BY',
  BACKED_UP_BY: 'BACKS_UP',
  MONITORS: 'MONITORED_BY',
  MONITORED_BY: 'MONITORS',
  CUSTOM: 'CUSTOM',
};

const numericConstraintsSchema = z.object({
  enabled: z.boolean().default(false),
  min: z.number().optional(),
  max: z.number().optional(),
  resolution: z.number().positive().optional(),
}).optional();

const attributeDefinitionSchema = z.object({
  fieldName: z.string().min(1).max(100),
  dataType: z.enum(ATTRIBUTE_DATA_TYPES),
  required: z.boolean().default(false),
  defaultValue: z.any().optional(),
  unit: z.string().max(20).optional(),
  dropdownOptions: z.array(z.string()).optional(),
  numericConstraints: numericConstraintsSchema,
});

const expectedIdentifierSchema = z.object({
  identifierType: z.enum(IDENTIFIER_TYPES),
  label: z.string().max(100).optional(),
  required: z.boolean().default(false),
});

const telemetryDefinitionSchema = z.object({
  fieldName: z.string().min(1).max(100),
  dataType: z.enum(TELEMETRY_DATA_TYPES),
  unit: z.string().max(20).optional(),
  description: z.string().max(255).optional(),
});

// Alarm rule types
export const ALARM_RULE_TYPES = [
  'HIGH', 'LOW', 'HIGH_HIGH', 'LOW_LOW',
  'RATE_OF_CHANGE', 'BOOLEAN_STATE', 'CUSTOM',
] as const;

export const ALARM_SEVERITIES = [
  'WARNING', 'ALARM', 'CRITICAL',
] as const;

const alarmRuleSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(ALARM_RULE_TYPES),
  severity: z.enum(ALARM_SEVERITIES).default('ALARM'),
  sourceField: z.string().max(100).optional(),          // telemetry or checklist field name
  condition: z.string().max(500).optional(),             // e.g., "> 85.0" or "= Off" or custom expression
  threshold: z.number().optional(),                       // numeric threshold value
  deadband: z.number().optional(),                        // hysteresis to prevent flapping
  message: z.string().max(500).optional(),                // alarm message template
  notifyRoles: z.array(z.string()).default([]),            // roles to notify
  enabled: z.boolean().default(true),
});

// =============================================
// Template Schemas
// =============================================

export const createAssetTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).default('box'),
  attributeSchema: z.array(attributeDefinitionSchema).default([]),
  telemetrySchema: z.array(telemetryDefinitionSchema).default([]),
  expectedIdentifiers: z.array(expectedIdentifierSchema).default([]),
  alarmRules: z.array(alarmRuleSchema).default([]),
});

export const updateAssetTemplateSchema = createAssetTemplateSchema.partial();

export type CreateAssetTemplateInput = z.infer<typeof createAssetTemplateSchema>;
export type UpdateAssetTemplateInput = z.infer<typeof updateAssetTemplateSchema>;

// =============================================
// Instance Schemas
// =============================================

export const createAssetInstanceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  templateId: z.string().uuid(),
  status: z.string().max(50).default('Active'),
  attributes: z.record(z.any()).default({}),
  telemetryConfig: z.record(z.any()).default({}),
  customAttributes: z.record(z.any()).default({}),
  parentId: z.string().uuid().nullable().optional(),
});

export const updateAssetInstanceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  status: z.string().max(50).optional(),
  attributes: z.record(z.any()).optional(),
  telemetryConfig: z.record(z.any()).optional(),
  customAttributes: z.record(z.any()).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

export type CreateAssetInstanceInput = z.infer<typeof createAssetInstanceSchema>;
export type UpdateAssetInstanceInput = z.infer<typeof updateAssetInstanceSchema>;

// =============================================
// Relationship Schemas
// =============================================

export const createAssetRelationshipSchema = z.object({
  sourceAssetId: z.string().uuid(),
  targetAssetId: z.string().uuid(),
  relationshipType: z.enum(RELATIONSHIP_TYPES),
  customLabel: z.string().max(100).optional(),
  notes: z.string().optional(),
});

export type CreateAssetRelationshipInput = z.infer<typeof createAssetRelationshipSchema>;

// =============================================
// Identifier Schemas
// =============================================

export const createAssetIdentifierSchema = z.object({
  assetId: z.string().uuid(),
  identifierType: z.enum(IDENTIFIER_TYPES),
  identifierValue: z.string().min(1).max(255),
  label: z.string().max(100).optional(),
  isPrimary: z.boolean().default(false),
});

export type CreateAssetIdentifierInput = z.infer<typeof createAssetIdentifierSchema>;

// =============================================
// Query Schemas
// =============================================

export const assetQuerySchema = z.object({
  search: z.string().optional(),
  templateId: z.string().uuid().optional(),
  status: z.string().optional(),
  parentId: z.string().uuid().nullable().optional(),
  isActive: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const templateQuerySchema = z.object({
  search: z.string().optional(),
  isActive: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type AssetQueryInput = z.infer<typeof assetQuerySchema>;
export type TemplateQueryInput = z.infer<typeof templateQuerySchema>;

// =============================================
// Template Linking Rule Schemas
// =============================================

export const LINKING_RULE_SCOPES = ['GLOBAL', 'ROLE', 'USER'] as const;

export const FORWARD_RELATIONSHIP_TYPES = [
  'CONTAINS', 'CONNECTED_TO', 'FEEDS', 'DEPENDS_ON', 'BACKS_UP', 'MONITORS', 'CUSTOM',
] as const;

export const createTemplateLinkingRuleSchema = z.object({
  sourceTemplateId: z.string().uuid(),
  targetTemplateId: z.string().uuid(),
  allowedRelationships: z.array(z.enum(FORWARD_RELATIONSHIP_TYPES)).min(1),
  scope: z.enum(LINKING_RULE_SCOPES).default('GLOBAL'),
  scopeValue: z.string().max(100).optional(),
});

export const updateTemplateLinkingRuleSchema = createTemplateLinkingRuleSchema.partial();

export type CreateTemplateLinkingRuleInput = z.infer<typeof createTemplateLinkingRuleSchema>;
export type UpdateTemplateLinkingRuleInput = z.infer<typeof updateTemplateLinkingRuleSchema>;
