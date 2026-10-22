/**
 * A-01 Phase 2 Tier 1 — Typed-asset dispatch helper.
 *
 * Foundation for the asset_instances → typed-tables write-cutover. Used by
 * the canonical instance.repository.ts to dual-write asset UPDATES to both the
 * typed-hierarchy table (blocks / areas / ahus / filters) AND the legacy
 * `asset_instances` table. Creates and soft-deletes are not here — see the
 * notes above and below dispatchUpdate.
 *
 * Why dual-write rather than typed-only:
 *   - The legacy `asset_instances` table is still read by ~60% of the
 *     backend (107 prisma.assetInstance.* call sites across 39 files).
 *     Until those sites migrate (Phase 2 Tiers 2-7), `asset_instances`
 *     must stay populated.
 *   - Transaction rollback cleans up both writes atomically on failure.
 *
 * Why OTHER kind is special-cased:
 *   - Per D-decision D1 (signed off 2026-05-29 — see tasks/A-01-D-DECISIONS.md),
 *     OTHER-kind asset_instances have no typed home and stay on the legacy
 *     table indefinitely. The helper writes them to asset_instances only.
 *
 * Limitations / future work:
 *   - Read paths (findMany / findUnique / findFirst) are NOT in scope here.
 *     The forward mirror keeps typed tables synced; consumers can already
 *     read either side. This file is write-cutover only.
 *   - Identifier / relationship cascades are handled by separate FK
 *     ON DELETE CASCADE rules; the dispatch helper doesn't touch them.
 *   - The asset_template_versions snapshot side-effect on template updates
 *     happens in the template repository, not here.
 */

import { prisma } from './prisma.js';

// ─── Kind types & shapes ────────────────────────────────────────────────────

export type HierarchyKind = 'BLOCK' | 'AREA' | 'AHU' | 'FILTER';
export type AssetKind = HierarchyKind | 'OTHER' | 'EQUIPMENT';

/**
 * The subset of asset_instances columns that the typed tables mirror.
 * Excludes `templateId` (typed tables don't carry it) and `parentId`
 * (typed tables use kind-specific FKs — translated below).
 */
export interface CommonAssetData {
  name: string;
  description?: string | null;
  status?: string;
  attributes?: Record<string, unknown>;
  customAttributes?: Record<string, unknown>;
  
  isActive?: boolean;
  createdBy?: string | null;
  updatedBy?: string | null;
}

// ─── Kind lookup ────────────────────────────────────────────────────────────
// (kindFromTemplateId + its per-process template-kind cache went with
// dispatchCreate on 2026-10-22: it was that function's only caller.)

function normalizeKind(raw: string): AssetKind {
  switch (raw) {
    case 'BLOCK': case 'AREA': case 'AHU': case 'FILTER': case 'EQUIPMENT': case 'OTHER':
      return raw as AssetKind;
    default:
      return 'OTHER';
  }
}

export function isHierarchyKind(k: AssetKind): k is HierarchyKind {
  return k === 'BLOCK' || k === 'AREA' || k === 'AHU' || k === 'FILTER';
}

/**
 * Resolve the kind of an existing asset by id. Uses the asset_instances ⇒
 * template join. Returns null if the id isn't found.
 */
export async function kindFromInstanceId(id: string): Promise<AssetKind | null> {
  const inst = await prisma.assetInstance.findUnique({
    where: { id },
    select: { template: { select: { templateKind: true } } },
  });
  if (!inst?.template) return null;
  return normalizeKind(inst.template.templateKind);
}

// ─── Data-shape translation ─────────────────────────────────────────────────

/**
 * Translate an asset_instances-shaped data object to its typed-table shape.
 * Strips fields the typed tables don't carry (`templateId`, `templateVersion`,
 * `currentLifecycleState`, etc. — those live on FilterDetails) and translates
 * `parentId` into the kind-specific typed FK column name (areas.blockId,
 * ahus.areaId, filters.ahuId; blocks have no parent FK).
 */
export function translateToTypedShape(
  kind: HierarchyKind,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const {
    // Drop these — typed tables don't have them:
    templateId, templateVersion, parentId,
    currentLifecycleState, currentCycleId, filterProfileId, filterSet,
    // Pass-through:
    ...rest
  } = data as any;

  // Add the kind-specific parent FK if parentId was supplied.
  // blocks have no parent; areas.blockId, ahus.areaId, filters.ahuId.
  if (parentId !== undefined) {
    if (kind === 'AREA')   (rest as any).blockId = parentId;
    else if (kind === 'AHU')   (rest as any).areaId  = parentId;
    else if (kind === 'FILTER')(rest as any).ahuId   = parentId;
    // For BLOCK we drop parentId silently — blocks are top-of-tree.
  }

  return rest;
}

// ─── Tx-aware Prisma delegate dispatch ─────────────────────────────────────

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function typedDelegate(tx: Tx, kind: HierarchyKind) {
  switch (kind) {
    case 'BLOCK':  return tx.block;
    case 'AREA':   return tx.area;
    case 'AHU':    return tx.ahu;
    case 'FILTER': return tx.filter;
  }
}

// ─── Public CRUD primitives ─────────────────────────────────────────────────

// No dispatchCreate (removed 2026-10-22, D-LIB-1). It had no caller: asset
// creates go through instance.service.ts `tx.assetInstance.create`, and the
// forward mirror (fn_mirror_asset_instance) writes the typed row with the same
// id. It was also broken for FILTER: it inserted the typed `filters` row first,
// and `filters` is the one typed table WITH a reverse mirror
// (trg_mirror_typed_to_asset_instance), which immediately inserts the
// asset_instances row with that id, so the helper's own asset_instances create
// hit the primary key (P2002, rolled back). A future A-01 tier that creates
// through the typed tables must write ONE side and let the mirror write the
// other, never both. OTHER / EQUIPMENT stay asset_instances-only (D1=C).

/**
 * Dual-write update by id. Resolves kind via asset_instances ⇒ template join
 * (single round-trip), then updates the typed table + asset_instances inside
 * a transaction. OTHER goes to asset_instances only.
 *
 * Returns the asset_instances row (the API-shape consumers expect).
 */
export async function dispatchUpdate(
  id: string,
  data: Record<string, unknown>,
): Promise<any> {
  const kind = await kindFromInstanceId(id);
  if (!kind) throw new Error(`Asset instance not found: ${id}`);

  if (!isHierarchyKind(kind)) {
    return prisma.assetInstance.update({ where: { id }, data: data as any });
  }

  return prisma.$transaction(async (tx) => {
    const typedData = translateToTypedShape(kind, data);
    // Only update typed table if there's anything mappable to it (e.g. a
    // template-id-only update has nothing left after translate). Otherwise
    // skip the typed update to avoid Prisma "no fields to update" errors.
    if (Object.keys(typedData).length > 0) {
      await (typedDelegate(tx, kind) as any).update({
        where: { id },
        data: typedData,
      });
    }
    return tx.assetInstance.update({ where: { id }, data: data as any });
  });
}

// No dispatchSoftDeleteMany (removed 2026-10-22). Its only caller was
// instance.repository.ts softDeleteMany, which nothing called. Live soft-deletes
// write ONE side and let a mirror write the other: instance.service.ts
// (tx.assetInstance.updateMany -> forward mirror) and filter.service.ts
// softDelete (typed filters -> reverse mirror). It dual-wrote isActive=false +
// updatedBy to the typed table per kind and to asset_instances for every kind
// (OTHER / EQUIPMENT on asset_instances only, D1=C).
