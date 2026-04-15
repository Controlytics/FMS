import { prisma } from '../../../lib/prisma.js';
import type { ResolutionContext, ResolvedValue } from './timestamp-source.js';

export async function resolveAttribute(slotRef: string, field: string, ctx: ResolutionContext): Promise<ResolvedValue> {
  const slotName = slotRef.startsWith('$') ? slotRef.slice(1) : slotRef;
  const entityId = ctx.entitySlots[slotName];
  if (!entityId) {
    return { value: '', error: `Entity slot "${slotName}" not found` };
  }

  const instance = await prisma.assetInstance.findUnique({
    where: { id: entityId },
    include: {
      template: { select: { name: true, attributeSchema: true } },
    },
  });

  if (!instance) {
    return { value: '', error: `Entity "${entityId}" not found` };
  }

  if (field === '*') {
    return { value: instance.attributes ?? {} };
  }

  const attrs = (instance.attributes as Record<string, unknown>) ?? {};

  if (field === 'name') return { value: instance.name };
  if (field === 'id') return { value: instance.id };
  if (field === 'template') return { value: instance.template?.name ?? '' };

  return { value: attrs[field] ?? '' };
}
