import { prisma } from '../../../lib/prisma.js';
import type { ResolutionContext, ResolvedValue } from './timestamp-source.js';

export async function resolveIdentifier(slotRef: string, identType: string, ctx: ResolutionContext): Promise<ResolvedValue> {
  const slotName = slotRef.startsWith('$') ? slotRef.slice(1) : slotRef;
  const entityId = ctx.entitySlots[slotName];
  if (!entityId) {
    return { value: '', error: `Entity slot "${slotName}" not found` };
  }

  const identifiers = await prisma.assetIdentifier.findMany({
    where: { assetId: entityId },
  });

  if (identifiers.length === 0) {
    return { value: '', error: `No identifiers for entity "${entityId}"` };
  }

  const match = identifiers.find(i => i.identifierType === identType);
  if (match) {
    return { value: match.identifierValue };
  }

  return { value: identifiers[0].identifierValue };
}
