import { z } from 'zod';

export const relationshipTypeEnum = z.enum([
  'CONTAINS', 'CONNECTED_TO', 'FEEDS', 'DEPENDS_ON', 'BACKS_UP', 'MONITORS', 'CUSTOM',
]);

export const createRelationshipSchema = z.object({
  sourceAssetId: z.string().uuid(),
  targetAssetId: z.string().uuid(),
  relationshipType: relationshipTypeEnum,
  customLabel: z.string().max(100).optional(),
  customInverseLabel: z.string().max(100).optional(),
  isPrimary: z.boolean().default(false),
  notes: z.string().optional(),
}).refine(data => data.sourceAssetId !== data.targetAssetId, {
  message: 'An asset cannot have a relationship with itself',
});

export type RelationshipType = z.infer<typeof relationshipTypeEnum>;
export type CreateRelationshipInput = z.infer<typeof createRelationshipSchema>;
