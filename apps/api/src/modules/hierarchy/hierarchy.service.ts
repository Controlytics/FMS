/**
 * hierarchy.service.ts — Wave 2 of the asset-removal programme (2026-05-17).
 *
 * Read-only service over the new typed-hierarchy tables (`blocks`, `areas`,
 * `ahus`, `filters`). Wave 1 introduced the four Prisma models + the
 * `fn_mirror_asset_instance` trigger that keeps them in sync with every
 * `asset_instances` mutation, so writes still flow through the legacy
 * `instance.service.ts` and we just *read* the mirrored typed rows here.
 *
 * Why a service layer (when the routes are this thin):
 *   - Lets the route file stay declarative (schema + auth + handler glue).
 *   - Makes unit-testing the query shapes cheap — mock `prisma.block.*`
 *     and assert the `where` / `include` payloads without standing up a
 *     Fastify instance.
 *   - Gives us one place to grow visibility filters or pin-cycle joins
 *     later without re-templating route schemas.
 *
 * Pagination contract (matches the audit §1.8 fix landed earlier today on
 *   `queries/telemetry.routes.ts`):
 *   - default page = 1, default limit = 50
 *   - hard ceiling = 500 enforced both by the JSON-schema `maximum: 500`
 *     and by `Math.min(Math.max(limit ?? 50, 1), 500)` in `normalizeLimit`.
 *
 * Visibility: this read path does NOT apply EntityAssignment /
 * TemplateAssignment scoping. Wave 2 is just proving the read path; the
 * existing /api/assets/instances endpoints still serve the gated-list use
 * case. Wave 5 will revisit if the typed-hierarchy route becomes the FE's
 * primary feed.
 */

import { prisma } from '../../lib/prisma.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

type ExpandLevel = 0 | 1 | 2 | 3;

export interface PageQuery {
  page?: number;
  limit?: number;
}

export interface BlockListQuery extends PageQuery {
  expand?: string;
}

export interface AreaListQuery extends PageQuery {
  blockId?: string;
  expand?: string;
}

export interface AhuListQuery extends PageQuery {
  areaId?: string;
  expand?: string;
}

export interface FilterListQuery extends PageQuery {
  ahuId?: string;
}

/** Bounded `take` value matching audit §1.8 contract. */
export function normalizeLimit(raw?: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
}

export function normalizePage(raw?: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 1;
  return Math.max(Math.trunc(n), 1);
}

/**
 * `?expand=areas` → 1
 * `?expand=areas.ahus` → 2
 * `?expand=areas.ahus.filters` → 3
 * (anything unrecognised → 0; no expansion)
 */
function parseExpandDepthFromBlock(expand?: string): ExpandLevel {
  switch (expand) {
    case 'areas': return 1;
    case 'areas.ahus': return 2;
    case 'areas.ahus.filters': return 3;
    default: return 0;
  }
}

/**
 * `?expand=ahus` → 1
 * `?expand=ahus.filters` → 2
 */
function parseExpandDepthFromArea(expand?: string): 0 | 1 | 2 {
  switch (expand) {
    case 'ahus': return 1;
    case 'ahus.filters': return 2;
    default: return 0;
  }
}

function parseExpandDepthFromAhu(expand?: string): 0 | 1 {
  return expand === 'filters' ? 1 : 0;
}

/** Build a nested Prisma `include` for the blocks query. */
function buildBlockInclude(depth: ExpandLevel): Record<string, unknown> | undefined {
  if (depth === 0) return undefined;
  if (depth === 1) return { areas: { where: { isActive: true } } };
  if (depth === 2) {
    return {
      areas: {
        where: { isActive: true },
        include: { ahus: { where: { isActive: true } } },
      },
    };
  }
  // depth === 3
  return {
    areas: {
      where: { isActive: true },
      include: {
        ahus: {
          where: { isActive: true },
          include: { filters: { where: { isActive: true } } },
        },
      },
    },
  };
}

function buildAreaInclude(depth: 0 | 1 | 2): Record<string, unknown> | undefined {
  if (depth === 0) return undefined;
  if (depth === 1) return { ahus: { where: { isActive: true } } };
  return {
    ahus: {
      where: { isActive: true },
      include: { filters: { where: { isActive: true } } },
    },
  };
}

function buildAhuInclude(depth: 0 | 1): Record<string, unknown> | undefined {
  if (depth === 0) return undefined;
  return { filters: { where: { isActive: true } } };
}

interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function paginateMeta(total: number, page: number, limit: number) {
  return {
    total,
    page,
    limit,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

export const hierarchyService = {
  // ─── BLOCKS ───────────────────────────────────────────────────────────
  async listBlocks(q: BlockListQuery): Promise<PaginatedResult<unknown>> {
    const page = normalizePage(q.page);
    const limit = normalizeLimit(q.limit);
    const depth = parseExpandDepthFromBlock(q.expand);
    const include = buildBlockInclude(depth);
    const where = { isActive: true };
    const [rows, total] = await Promise.all([
      prisma.block.findMany({
        where,
        ...(include ? { include } : {}),
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      } as any),
      prisma.block.count({ where }),
    ]);
    return { data: rows as unknown[], ...paginateMeta(total, page, limit) };
  },

  async getBlock(id: string, expand?: string) {
    const depth = parseExpandDepthFromBlock(expand);
    const include = buildBlockInclude(depth);
    return prisma.block.findFirst({
      where: { id, isActive: true },
      ...(include ? { include } : {}),
    } as any);
  },

  // ─── AREAS ────────────────────────────────────────────────────────────
  async listAreas(q: AreaListQuery): Promise<PaginatedResult<unknown>> {
    const page = normalizePage(q.page);
    const limit = normalizeLimit(q.limit);
    const depth = parseExpandDepthFromArea(q.expand);
    const include = buildAreaInclude(depth);
    const where: Record<string, unknown> = { isActive: true };
    if (q.blockId) where.blockId = q.blockId;
    const [rows, total] = await Promise.all([
      prisma.area.findMany({
        where,
        ...(include ? { include } : {}),
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      } as any),
      prisma.area.count({ where }),
    ]);
    return { data: rows as unknown[], ...paginateMeta(total, page, limit) };
  },

  async getArea(id: string, expand?: string) {
    const depth = parseExpandDepthFromArea(expand);
    const include = buildAreaInclude(depth);
    return prisma.area.findFirst({
      where: { id, isActive: true },
      ...(include ? { include } : {}),
    } as any);
  },

  // ─── AHUS ─────────────────────────────────────────────────────────────
  async listAhus(q: AhuListQuery): Promise<PaginatedResult<unknown>> {
    const page = normalizePage(q.page);
    const limit = normalizeLimit(q.limit);
    const depth = parseExpandDepthFromAhu(q.expand);
    const include = buildAhuInclude(depth);
    const where: Record<string, unknown> = { isActive: true };
    if (q.areaId) where.areaId = q.areaId;
    const [rows, total] = await Promise.all([
      prisma.ahu.findMany({
        where,
        ...(include ? { include } : {}),
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      } as any),
      prisma.ahu.count({ where }),
    ]);
    return { data: rows as unknown[], ...paginateMeta(total, page, limit) };
  },

  async getAhu(id: string, expand?: string) {
    const depth = parseExpandDepthFromAhu(expand);
    const include = buildAhuInclude(depth);
    return prisma.ahu.findFirst({
      where: { id, isActive: true },
      ...(include ? { include } : {}),
    } as any);
  },

  // ─── FILTERS ──────────────────────────────────────────────────────────
  async listFilters(q: FilterListQuery): Promise<PaginatedResult<unknown>> {
    const page = normalizePage(q.page);
    const limit = normalizeLimit(q.limit);
    const where: Record<string, unknown> = { isActive: true };
    if (q.ahuId) where.ahuId = q.ahuId;
    const [rows, total] = await Promise.all([
      prisma.filter.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      } as any),
      prisma.filter.count({ where }),
    ]);
    return { data: rows as unknown[], ...paginateMeta(total, page, limit) };
  },

  async getFilter(id: string) {
    return prisma.filter.findFirst({ where: { id, isActive: true } } as any);
  },

  // ─── FULL TREE ────────────────────────────────────────────────────────
  /**
   * Full nested tree (blocks → areas → ahus → filters) for the FE preview
   * page. Unbounded — there are 4 blocks / ~6 filters in production today,
   * so the row count cannot blow up. If the dataset grows, switch to the
   * paginated listBlocks + ?expand=areas.ahus.filters path.
   */
  async getTree() {
    return prisma.block.findMany({
      where: { isActive: true },
      include: {
        areas: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
          include: {
            ahus: {
              where: { isActive: true },
              orderBy: { name: 'asc' },
              include: {
                filters: {
                  where: { isActive: true },
                  orderBy: { name: 'asc' },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    } as any);
  },
};
