import type { PrismaClient } from '@prisma/client';

/**
 * One asset template per hierarchy kind (2026-10-21, found by the coverage
 * campaign). Block / Area / AHU are created as asset_instances and REQUIRE a
 * templateId; a typed filter insert REQUIRES an active FILTER template (the
 * fn_mirror_typed_to_asset_instance trigger raises without one). Nothing else
 * creates templates since the templates API was removed, so a FRESH install
 * could not create its first block (verified on a fresh database: 400 "must
 * have required property 'templateId'").
 *
 * Create-only and per kind, like every seed write: a site that already has an
 * active template of a kind is left exactly as it is.
 */
export const HIERARCHY_TEMPLATES = [
  { templateKind: 'BLOCK', name: 'Block', icon: 'building' },
  { templateKind: 'AREA', name: 'Area', icon: 'layout' },
  { templateKind: 'AHU', name: 'AHU', icon: 'wind' },
  { templateKind: 'FILTER', name: 'Filter', icon: 'filter' },
] as const;

export async function ensureHierarchyTemplates(prisma: PrismaClient): Promise<{ created: string[] }> {
  const created: string[] = [];
  for (const t of HIERARCHY_TEMPLATES) {
    const existing = await prisma.assetTemplate.findFirst({ where: { templateKind: t.templateKind, isActive: true }, select: { id: true } });
    if (existing) continue;
    // A same-named template may exist inactive or under another kind; never collide with it.
    const nameTaken = await prisma.assetTemplate.findUnique({ where: { name: t.name }, select: { id: true } });
    await prisma.assetTemplate.create({
      data: { name: nameTaken ? `${t.name} (system)` : t.name, templateKind: t.templateKind, icon: t.icon, isActive: true, createdBy: 'system' },
    });
    created.push(t.templateKind);
  }
  return { created };
}
