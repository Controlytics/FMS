import { z } from 'zod';

const attributeFieldSchema = z.object({
  name: z.string().min(1),
  dataType: z.enum(['text', 'number', 'date', 'boolean', 'dropdown']),
  unit: z.string().optional(),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  defaultValue: z.unknown().optional(),
});

const telemetryPointSchema = z.object({
  name: z.string().min(1),
  unit: z.string().optional(),
  dataType: z.enum(['number', 'boolean', 'text']),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  alertThreshold: z.number().optional(),
  actionThreshold: z.number().optional(),
});

const expectedIdentifierSchema = z.object({
  type: z.enum(['QR', 'BARCODE', 'RFID', 'NFC']),
  required: z.boolean().default(false),
});

const expectedRelationshipSchema = z.object({
  type: z.string().min(1),
  targetType: z.string().optional(),
  description: z.string().optional(),
});

const defaultScheduleSchema = z.object({
  checklistIndex: z.number().int().min(0),
  frequency: z.string().min(1),
  toleranceBefore: z.number().int().min(0).optional(),
  toleranceAfter: z.number().int().min(0).optional(),
});

export const createTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(255),
  nodeType: z.string().min(1, 'Node type is required').max(50),
  description: z.string().optional(),
  attributeSchema: z.array(attributeFieldSchema).default([]),
  telemetrySchema: z.array(telemetryPointSchema).default([]),
  checklistSchemas: z.array(z.unknown()).default([]),
  expectedIdentifiers: z.array(expectedIdentifierSchema).default([]),
  expectedRelationships: z.array(expectedRelationshipSchema).default([]),
  defaultSchedules: z.array(defaultScheduleSchema).default([]),
  statusLifecycle: z.array(z.string()).default(['active', 'maintenance', 'offline', 'decommissioned']),
  iconUrl: z.string().url().optional().or(z.literal('')),
});

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  attributeSchema: z.array(attributeFieldSchema).optional(),
  telemetrySchema: z.array(telemetryPointSchema).optional(),
  checklistSchemas: z.array(z.unknown()).optional(),
  expectedIdentifiers: z.array(expectedIdentifierSchema).optional(),
  expectedRelationships: z.array(expectedRelationshipSchema).optional(),
  defaultSchedules: z.array(defaultScheduleSchema).optional(),
  statusLifecycle: z.array(z.string()).optional(),
  iconUrl: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  reason: z.string().min(1, 'Reason for change is required'),
});

export type AttributeField = z.infer<typeof attributeFieldSchema>;
export type TelemetryPoint = z.infer<typeof telemetryPointSchema>;
export type ExpectedIdentifier = z.infer<typeof expectedIdentifierSchema>;
export type ExpectedRelationship = z.infer<typeof expectedRelationshipSchema>;
export type DefaultSchedule = z.infer<typeof defaultScheduleSchema>;
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
