/**
 * Consistent UNS path resolution for entities.
 * Single source of truth for UNS path fallback logic.
 */
export function getEntityUnsPath(entity: {
  unsPath?: string | null;
  name: string;
  template?: { name: string } | null;
}): string {
  if (entity.unsPath) return entity.unsPath;
  if (entity.template?.name) return `${entity.template.name}/${entity.name}`;
  return entity.name;
}
