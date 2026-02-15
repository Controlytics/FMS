import { z } from 'zod';

export const RELATIONSHIP_TYPES = {
  CONTAINS: { forward: 'CONTAINS', inverse: 'CONTAINED_IN', description: 'Physical containment (e.g., Building contains Room)' },
  CONTAINED_IN: { forward: 'CONTAINED_IN', inverse: 'CONTAINS', description: 'Reverse of Contains' },
  CONNECTED_TO: { forward: 'CONNECTED_TO', inverse: 'CONNECTED_FROM', description: 'Physical or logical connection' },
  CONNECTED_FROM: { forward: 'CONNECTED_FROM', inverse: 'CONNECTED_TO', description: 'Reverse of Connected To' },
  FEEDS: { forward: 'FEEDS', inverse: 'FED_BY', description: 'Material/data flow (e.g., Pump feeds Reactor)' },
  FED_BY: { forward: 'FED_BY', inverse: 'FEEDS', description: 'Reverse of Feeds' },
  DEPENDS_ON: { forward: 'DEPENDS_ON', inverse: 'DEPENDED_ON_BY', description: 'Operational dependency' },
  DEPENDED_ON_BY: { forward: 'DEPENDED_ON_BY', inverse: 'DEPENDS_ON', description: 'Reverse of Depends On' },
  BACKS_UP: { forward: 'BACKS_UP', inverse: 'BACKED_UP_BY', description: 'Redundancy/backup relationship' },
  BACKED_UP_BY: { forward: 'BACKED_UP_BY', inverse: 'BACKS_UP', description: 'Reverse of Backs Up' },
  MONITORS: { forward: 'MONITORS', inverse: 'MONITORED_BY', description: 'Monitoring relationship (e.g., Sensor monitors Reactor)' },
  MONITORED_BY: { forward: 'MONITORED_BY', inverse: 'MONITORS', description: 'Reverse of Monitors' },
  CUSTOM: { forward: 'CUSTOM', inverse: 'CUSTOM_INVERSE', description: 'User-defined relationship' },
  CUSTOM_INVERSE: { forward: 'CUSTOM_INVERSE', inverse: 'CUSTOM', description: 'Reverse of Custom' },
} as const;

export type RelationshipType = keyof typeof RELATIONSHIP_TYPES;

export function getInverseType(type: string): string {
  const entry = RELATIONSHIP_TYPES[type as RelationshipType];
  return entry ? entry.inverse : type;
}

export const FORWARD_RELATIONSHIP_TYPES = [
  'CONTAINS', 'CONNECTED_TO', 'FEEDS', 'DEPENDS_ON', 'BACKS_UP', 'MONITORS', 'CUSTOM',
] as const;

export const createRelationshipSchema = z.object({
  sourceId: z.string().uuid('Source asset ID is required'),
  targetId: z.string().uuid('Target asset ID is required'),
  type: z.string().min(1, 'Relationship type is required').max(50),
  customLabel: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});

export type CreateRelationshipInput = z.infer<typeof createRelationshipSchema>;
