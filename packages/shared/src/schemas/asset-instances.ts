import { z } from 'zod';

export const createAssetInstanceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  templateId: z.string().uuid(),
  status: z.string().default('Active'),
  parentAssetId: z.string().uuid().optional(),
  attributes: z.record(z.unknown()).default({}),
  telemetryOverrides: z.record(z.unknown()).optional(),
  identifiers: z.array(z.object({
    type: z.enum(['QR', 'BARCODE', 'RFID', 'NFC', 'MANUAL']),
    value: z.string().min(1).max(500),
  })).optional(),
  scheduleOverrides: z.array(z.object({
    checklistIndex: z.number().int().min(0),
    frequency: z.string(),
    toleranceMinutes: z.number().int().min(0).default(0),
    lastPerformedAt: z.string().datetime().nullable().optional(),
    isOnboarding: z.boolean().default(false),
  })).optional(),
});

export const updateAssetInstanceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  status: z.string().optional(),
  reason: z.string().min(1, 'Change reason is required'),
});

export const addCustomAttributeSchema = z.object({
  name: z.string().min(1).max(255),
  dataType: z.enum(['TEXT', 'INTEGER', 'FLOAT', 'DATE', 'DATETIME', 'BOOLEAN', 'DROPDOWN', 'URL', 'FILE']),
  value: z.unknown().optional(),
  unit: z.string().max(50).optional(),
  isRequired: z.boolean().default(false),
  numericConstraints: z.object({
    enableConstraints: z.boolean().default(false),
    min: z.number().optional(),
    max: z.number().optional(),
    resolution: z.number().positive().optional(),
  }).optional(),
  dropdownOptions: z.array(z.string()).optional(),
});

export const updateAttributeSchema = z.object({
  value: z.unknown(),
  reason: z.string().min(1, 'Change reason is required'),
});

export const assetQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  templateId: z.string().uuid().optional(),
  status: z.string().optional(),
});

export type CreateAssetInstanceInput = z.infer<typeof createAssetInstanceSchema>;
export type UpdateAssetInstanceInput = z.infer<typeof updateAssetInstanceSchema>;
export type AddCustomAttributeInput = z.infer<typeof addCustomAttributeSchema>;
export type UpdateAttributeInput = z.infer<typeof updateAttributeSchema>;
export type AssetQueryInput = z.infer<typeof assetQuerySchema>;
