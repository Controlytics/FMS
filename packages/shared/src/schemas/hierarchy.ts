import { z } from 'zod';

export const createNodeSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  name: z.string().min(1, 'Name is required').max(255),
  nodeType: z.string().min(1, 'Node type is required').max(50),
  templateId: z.string().uuid().optional(),
  attributes: z.record(z.unknown()).default({}),
  status: z.enum(['active', 'inactive', 'decommissioned']).default('active'),
});

export const updateNodeSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  attributes: z.record(z.unknown()).optional(),
  status: z.enum(['active', 'inactive', 'decommissioned']).optional(),
  reason: z.string().min(1, 'Reason for change is required'),
});

export const createLinkSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  linkType: z.string().min(1).max(50),
});

export const createIdentifierSchema = z.object({
  nodeId: z.string().uuid(),
  type: z.enum(['QR', 'BARCODE', 'RFID', 'NFC', 'MANUAL']),
  value: z.string().min(1).max(500),
});

export type CreateNodeInput = z.infer<typeof createNodeSchema>;
export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;
export type CreateLinkInput = z.infer<typeof createLinkSchema>;
export type CreateIdentifierInput = z.infer<typeof createIdentifierSchema>;
