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

export const createTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(255),
  nodeType: z.string().min(1, 'Node type is required').max(50),
  description: z.string().optional(),
  attributeSchema: z.array(attributeFieldSchema).default([]),
  telemetrySchema: z.array(telemetryPointSchema).default([]),
});

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  attributeSchema: z.array(attributeFieldSchema).optional(),
  telemetrySchema: z.array(telemetryPointSchema).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  reason: z.string().min(1, 'Reason for change is required'),
});

export type AttributeField = z.infer<typeof attributeFieldSchema>;
export type TelemetryPoint = z.infer<typeof telemetryPointSchema>;
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
