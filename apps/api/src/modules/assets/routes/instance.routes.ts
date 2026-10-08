 
 import type { FastifyInstance } from 'fastify';
import { enforceReauth } from '../../../lib/reauth-check.js';
import { AppError } from '../../../lib/errors.js';
import { buildContext } from '../../../lib/build-context.js';
import { errorResponses } from '../../../lib/error-schemas.js';
import { createAssetInstanceSchema, updateAssetInstanceSchema, assetQuerySchema } from '@digilog/shared';
import { instanceService } from '../services/instance.service.js';
import { bulkUploadFilters, type UploadScope } from '../services/bulk-upload-filter.service.js';
import { getRolePerms } from '../../../plugins/rbac.js';
import { hasEffectivePermission } from '@digilog/shared';
import { buildFilterUploadTemplate } from '../services/filter-upload-template.service.js';
import { prisma } from '../../../lib/prisma.js';
import {
  listPendingFilters, reviewFilters, approveFilters, rejectFilters, resubmitFilter, pendingFilterCounts,
} from '../filter-approval.service.js';

// Opt-in visibility scoping (EntityAssignment / TemplateAssignment) is unused
// on most installs — both tables are empty. Without this guard every non-admin
// list/tree request runs two findMany({take:10000}) that always return []. Cache
// "is scoping configured at all?" for 30s so the common (empty) case is one cheap
// findFirst per half-minute instead of two full scans per request (audit perf).
let _scopingCache: { configured: boolean; at: number } | null = null;
const SCOPING_TTL_MS = 30_000;
async function isScopingConfigured(prisma: any): Promise<boolean> {
  if (_scopingCache && Date.now() - _scopingCache.at < SCOPING_TTL_MS) return _scopingCache.configured;
  const [e, t] = await Promise.all([
    prisma.entityAssignment.findFirst({ select: { id: true } }),
    prisma.templateAssignment.findFirst({ select: { id: true } }),
  ]);
  const configured = e !== null || t !== null;
  _scopingCache = { configured, at: Date.now() };
  return configured;
}

export default async function instanceRoutes(app: FastifyInstance) {

  // 7. GET /instances — List instances with search/filter/pagination
  app.get('/instances', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Entities'],
      summary: 'List entity instances',
      description: 'List entity instances with optional search, filter by templateId, status, parentId, isActive, and pagination.',
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Search by name' },
          templateId: { type: 'string', format: 'uuid' },
          status: { type: 'string' },
          parentId: { type: 'string' },
          isActive: { type: 'string', description: '"true" or "false"' },
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  templateId: { type: 'string' },
                  templateVersion: { type: 'integer' },
                  status: { type: 'string' },
                  // 2026-09-25 (audit web F3): the scan surfaces cache this list
                  // for offline name-match and need the creation-workflow status
                  // to refuse a not-yet-approved filter at scan time.
                  approvalStatus: { type: 'string', nullable: true },
                  attributes: { type: 'object', additionalProperties: true },
                  parentId: { type: ['string', 'null'], nullable: true },
                  isActive: { type: 'boolean' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                  createdBy: { type: 'string' },
                  filterProfileId: { type: ['string', 'null'], nullable: true },
                  currentLifecycleState: { type: ['string', 'null'], nullable: true },
                  currentCycleId: { type: ['string', 'null'], nullable: true },
                  filterSet: { type: ['string', 'null'], nullable: true },
                  // Authoritative "Last Cleaned" (lib/last-cleaned.ts) — the
                  // tablet reads this instead of re-deriving from cycles.
                  lastCleanedAt: { type: ['string', 'null'], nullable: true },
                  template: {
                    type: 'object',
                    properties: { name: { type: 'string' }, icon: { type: 'string' } },
                  },
                },
              },
            },
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const query = assetQuerySchema.parse(req.query);

    // Inject assignment visibility filter
    //
    // Single-tenant semantics (post-MT-removal 2026-04-30):
    //   - SUPER_ADMIN / ADMIN bypass the filter.
    //   - For other roles the route's ASSET_VIEW permission gate is the
    //     authoritative check. EntityAssignment / TemplateAssignment are
    //     opt-in scoping: if rows exist that target this user (USER) or
    //     their role (ROLE) we honor those rows plus the user's own
    //     creations. If no rows target this user, scoping is off and they
    //     see everything ASSET_VIEW already lets them see.
    //   This replaces the previous default-deny that made SUPERVISOR /
    //   MAINTENANCE / QA's filters page appear empty whenever the
    //   assignment tables were unpopulated (zero rows on RFID today).
    const role = req.user?.role;
    const userId = req.user?.sub;
    const username = req.user?.username;

    let visibilityFilter: Record<string, unknown> | undefined;

    if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
      const { prisma } = await import("../../../lib/prisma.js");

      // Skip the per-user scans entirely when no scoping rows exist anywhere.
      if (!(await isScopingConfigured(prisma))) return instanceService.list(query, undefined);

      const entityAssignments = await prisma.entityAssignment.findMany({
        where: {
          OR: [
            { assigneeType: "USER", userId },
            { assigneeType: "ROLE", roleValue: role },
          ],
        },
        select: { entityId: true },
      });

      const templateAssignments = await prisma.templateAssignment.findMany({
        where: {
          OR: [
            { assigneeType: "USER", userId },
          ],
        },
        select: { templateId: true },
      });

      const assignedEntityIds = entityAssignments.map((a: any) => a.entityId);
      const assignedTemplateIds = templateAssignments.map((a: any) => a.templateId);
      const hasExplicitAssignments =
        assignedEntityIds.length > 0 || assignedTemplateIds.length > 0;

      if (hasExplicitAssignments) {
        const orConditions: any[] = [];
        if (assignedEntityIds.length > 0) orConditions.push({ id: { in: assignedEntityIds } });
        if (assignedTemplateIds.length > 0) orConditions.push({ templateId: { in: assignedTemplateIds } });
        // Creator-visibility: an operator's own creations stay visible even
        // when explicit scoping is in play. AssetInstance.createdBy stores
        // the username (set from ctx.userId = req.user.username via
        // buildContext + instance.service.create).
        if (username) orConditions.push({ createdBy: username });
        visibilityFilter = { OR: orConditions };
      }
      // No explicit assignments → opt-in scoping is off; ASSET_VIEW alone
      // grants full read. visibilityFilter stays undefined.
    }
    return instanceService.list(query, visibilityFilter);
  });

  // 8. GET /instances/tree — Get full asset tree
  app.get('/instances/tree', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Entities'],
      summary: 'Get entity instance tree',
      description: 'Return all active instances with parentId relationships as a flat array. The frontend builds the tree from this.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              parentId: { type: ['string', 'null'], nullable: true },
              templateId: { type: 'string' },
              status: { type: 'string' },
              template: {
                type: 'object',
                properties: { name: { type: 'string' }, icon: { type: 'string' } },
              },
              _count: { type: 'object', properties: { children: { type: 'integer' } } },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    // Visibility filter — same opt-in semantics as GET /instances above.
    const role = req.user?.role;
    const userId = req.user?.sub;
    const username = req.user?.username;

    if (role === "SUPER_ADMIN" || role === "ADMIN") {
      return instanceService.getTree();
    }

    const { prisma } = await import("../../../lib/prisma.js");
    // Same short-circuit as GET /instances — no scoping rows means full tree.
    if (!(await isScopingConfigured(prisma))) return instanceService.getTree();
    const entityAssignments = await prisma.entityAssignment.findMany({
      where: { OR: [
        { assigneeType: "USER", userId },
        { assigneeType: "ROLE", roleValue: role },
      ]},
      select: { entityId: true },
    });
    const templateAssignments = await prisma.templateAssignment.findMany({
      where: { OR: [
        { assigneeType: "USER", userId },
      ]},
      select: { templateId: true },
    });
    const eIds = entityAssignments.map((a: any) => a.entityId);
    const tIds = templateAssignments.map((a: any) => a.templateId);
    const hasExplicitAssignments = eIds.length > 0 || tIds.length > 0;

    if (!hasExplicitAssignments) {
      // Opt-in scoping not configured for this user → full tree, same as
      // GET /instances above. ASSET_VIEW is the authoritative gate.
      return instanceService.getTree();
    }

    const orConditions: any[] = [];
    if (eIds.length) orConditions.push({ id: { in: eIds } });
    if (tIds.length) orConditions.push({ templateId: { in: tIds } });
    if (username) orConditions.push({ createdBy: username });
    return instanceService.getTree({ OR: orConditions });
  });

  // 9. GET /instances/:id — Get single instance
  app.get('/instances/:id', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Entities'],
      summary: 'Get entity instance by ID',
      description: 'Retrieve a single entity instance with template info, relationships, identifiers, and parent info.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    return instanceService.getById(id);
  });

  // 10. POST /instances — Create instance from template
  app.post('/instances', {
    preHandler: [app.requireAnyPermission('ASSET_CREATE', 'FILTER_CREATE', 'FILTER_HIERARCHY_CREATE')],
    schema: {
      tags: ['Entities'],
      summary: 'Create entity instance',
      description: 'Create a new entity instance from a template. If parentId is set, auto-creates CONTAINS/CONTAINED_IN relationships.',
      body: {
        type: 'object',
        required: ['name', 'templateId'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          templateId: { type: 'string', format: 'uuid' },
          status: { type: 'string' },
          attributes: { type: 'object', additionalProperties: true },
          telemetryConfig: { type: 'object', additionalProperties: true },
          customAttributes: { type: 'object', additionalProperties: true },
          parentId: { type: 'string', format: 'uuid', nullable: true },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth(['CREATE_ASSET', 'CREATE_FILTER'], req, reply);
    if (!ok) return;

    const parsed = createAssetInstanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const instance = await instanceService.create(parsed.data, buildContext(req));
    return reply.code(201).send({ success: true, data: instance });
  });

  // GET /instances/filter-upload-template.xlsx — Download the bulk-upload
  // template (.xlsx with live Excel data-validation dropdowns). Dropdown
  // values reflect the current filter-field-options master data.
  //
  // The columns follow WHERE the upload was started (2026-10-08):
  //   ahuId   → no ahu / area columns (every filter goes into that AHU)
  //   areaId  → `ahu` column, suggesting the area's AHUs
  //   blockId → optional `area` + `ahu` columns, suggesting the block's ones
  // The AHU / Area dropdowns SUGGEST; a new name may be typed and the upload
  // creates it. An empty block is therefore fine — no NO_AHUS refusal.
  app.get('/instances/filter-upload-template.xlsx', {
    preHandler: [app.requireAnyPermission('ASSET_CREATE', 'FILTER_BULK_UPLOAD')],
    schema: {
      tags: ['Entities'],
      summary: 'Download the filter bulk-upload .xlsx template',
      description: 'Streams an .xlsx workbook with Excel data-validation dropdowns populated from live data. Pass ONE scope: `ahuId` (no ahu/area columns), `areaId` (ahu column) or `blockId` (optional area column + ahu column). The ahu/area dropdowns list what exists at download time; typing a new name is allowed — the upload creates it.',
      querystring: {
        type: 'object',
        properties: {
          blockId: { type: 'string', format: 'uuid' },
          areaId: { type: 'string', format: 'uuid' },
          ahuId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (req, reply) => {
    const { blockId, areaId, ahuId } = req.query as { blockId?: string; areaId?: string; ahuId?: string };
    let buf: Buffer;
    if (ahuId) {
      buf = await buildFilterUploadTemplate({ scope: 'ahu' });
    } else if (areaId) {
      const ahus = await prisma.ahu.findMany({ where: { areaId, isActive: true }, select: { name: true }, orderBy: { name: 'asc' } });
      buf = await buildFilterUploadTemplate({ scope: 'area', ahuNames: ahus.map(a => a.name) });
    } else if (blockId) {
      // An AHU hangs off the block directly OR off an area in it, so both are
      // collected — the same union the Filters page cascade uses.
      const areas = await prisma.area.findMany({ where: { blockId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
      const ahus = await prisma.ahu.findMany({
        where: { isActive: true, OR: [{ blockId }, ...(areas.length ? [{ areaId: { in: areas.map(a => a.id) } }] : [])] },
        select: { name: true }, orderBy: { name: 'asc' },
      });
      buf = await buildFilterUploadTemplate({ scope: 'block', ahuNames: ahus.map(a => a.name), areaNames: areas.map(a => a.name) });
    } else {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Pass blockId, areaId or ahuId — the template columns depend on where the upload goes.' });
    }
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="filter-upload-template.xlsx"')
      .send(buf);
  });

  // Shared 200 response schema for upload + validate (column/value carry the
  // per-cell validation detail — they MUST be declared or Fastify strips them).
  const bulkResultsSchema = {
    type: 'object' as const,
    properties: {
      success: { type: 'boolean' },
      created: { type: 'integer' },
      failed: { type: 'integer' },
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            row: { type: 'integer' },
            name: { type: 'string' },
            status: { type: 'string' },
            id: { type: 'string' },
            column: { type: 'string' },
            value: { type: 'string' },
            error: { type: 'string' },
          },
        },
      },
      rows: { type: 'array', items: { type: 'object', additionalProperties: true } },
      newAreas: { type: 'array', items: { type: 'string' } },
      newAhus: { type: 'array', items: { type: 'string' } },
    },
  };

  // Reads the multipart body shared by upload + validate. `scope` is the level
  // the dialog was opened from (blockId / areaId / ahuId).
  async function readBulkUploadParts(req: any) {
    let fileBuffer: Buffer | null = null;
    let fileTruncated = false;
    const scope: UploadScope = {};
    // 2026-05-22: dialog-level fallback when a row has no `filterSet`.
    let defaultFilterSet: 'SET_A' | 'SET_B' | undefined;
    for await (const part of req.parts()) {
      if (part.type === 'file' && part.fieldname === 'file') {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk);
        fileBuffer = Buffer.concat(chunks);
        if ((part.file as any).truncated) fileTruncated = true;
      } else if (part.type === 'field' && (part.fieldname === 'ahuId' || part.fieldname === 'areaId' || part.fieldname === 'blockId')) {
        const v = String(part.value ?? '').trim();
        if (v) scope[part.fieldname as keyof UploadScope] = v;
      } else if (part.type === 'field' && part.fieldname === 'defaultFilterSet') {
        const raw = String(part.value ?? '').toUpperCase().trim();
        if (raw === 'A' || raw === 'SET_A') defaultFilterSet = 'SET_A';
        else if (raw === 'B' || raw === 'SET_B') defaultFilterSet = 'SET_B';
      }
    }
    return { fileBuffer, fileTruncated, scope, defaultFilterSet };
  }

  // Creating an AHU / Area from the sheet needs what the Structure-view create
  // gates on (filters.hierarchy_create, or the broad ASSET_CREATE) — never just
  // FILTER_BULK_UPLOAD, or the upload would hand out hierarchy creation.
  async function canCreateHierarchy(req: any): Promise<boolean> {
    const role = req.user?.role;
    if (!role) return false;
    if (role === 'SUPER_ADMIN') return true;
    const perms = await getRolePerms(role);
    return ['FILTER_HIERARCHY_CREATE', 'ASSET_CREATE'].some(p => hasEffectivePermission(perms, p));
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function badScope(scope: UploadScope): string | null {
    if (!scope.blockId && !scope.areaId && !scope.ahuId) return 'blockId, areaId or ahuId is required';
    for (const v of Object.values(scope)) if (v && !UUID_RE.test(v)) return 'blockId / areaId / ahuId must be a UUID';
    return null;
  }

  // POST /instances/bulk-upload-filters — Bulk create filters from an .xlsx file
  app.post('/instances/bulk-upload-filters', {
    preHandler: [app.requireAnyPermission('ASSET_CREATE', 'FILTER_BULK_UPLOAD')],
    schema: {
      tags: ['Entities'],
      summary: 'Bulk upload filters from .xlsx',
      description: 'Upload the .xlsx template. Multipart fields: `file` plus ONE scope — `ahuId` (all filters into that AHU), `areaId` (each row names its AHU; missing AHUs are created in the area) or `blockId` (each row names its AHU and optionally its Area; missing ones are created in the block). Creating an AHU/Area needs FILTER_HIERARCHY_CREATE or ASSET_CREATE. No row limit; the file is bounded at 5 MB. Partial success: valid rows are created, invalid rows are reported.',
      consumes: ['multipart/form-data'],
      response: { 200: bulkResultsSchema, ...errorResponses },
    },
  }, async (req, reply) => {
    // Reauth must run BEFORE multipart consumption — req.body is undefined for
    // multipart routes. The FE sends the password via the x-reauth-password
    // header. CREATE_ASSET rides along (2026-10-08): the upload may create
    // AHUs / Areas, which on the Structure view sign CREATE_ASSET — an
    // enabled CREATE_ASSET row must not be bypassable through the upload.
    const { ok } = await enforceReauth(['BULK_UPLOAD_FILTERS', 'CREATE_ASSET'], req, reply);
    if (!ok) return;

    try {
      const { fileBuffer, fileTruncated, scope, defaultFilterSet } = await readBulkUploadParts(req);
      // #low-batch: @fastify/multipart silently TRUNCATES at the 5 MB limit —
      // detect it loudly instead of failing deep in the xlsx parser.
      if (fileTruncated) {
        return reply.code(413).send({ error: 'FILE_TOO_LARGE', message: 'Upload exceeds the maximum file size (5 MB).' });
      }
      if (!fileBuffer || fileBuffer.length === 0) {
        return reply.code(400).send({ error: 'VALIDATION', message: 'An .xlsx file is required' });
      }
      const scopeErr = badScope(scope);
      if (scopeErr) return reply.code(400).send({ error: 'VALIDATION', message: scopeErr });

      const result = await bulkUploadFilters(fileBuffer, scope, defaultFilterSet, buildContext(req), { canCreateHierarchy: await canCreateHierarchy(req) });
      return { success: true, ...result };
    } catch (err: any) {
      if (err.statusCode === 415 || err.message?.includes('multipart')) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', message: 'Request must be multipart/form-data' });
      }
      if (err instanceof AppError) return reply.code(err.statusCode).send({ error: err.code, message: err.message });
      app.log.error(err);
      // Audit 2026-09-24 (A-F2): never echo raw error text (Prisma messages embed a source path).
      return reply.code(500).send({ error: 'UPLOAD_FAILED', message: 'Bulk upload failed' });
    }
  });

  // POST /instances/bulk-upload-filters/validate — Dry-run: parse + validate the
  // .xlsx and return per-cell results + parsed rows for the preview. No DB write.
  app.post('/instances/bulk-upload-filters/validate', {
    preHandler: [app.requireAnyPermission('ASSET_CREATE', 'FILTER_BULK_UPLOAD')],
    schema: {
      tags: ['Entities'],
      summary: 'Validate a bulk-upload .xlsx without creating (dry-run)',
      description: 'Parses + validates the uploaded .xlsx against the live master data and returns row/column/value errors, the parsed rows (with the resolved area/AHU and whether each is new) and the AHUs/Areas the upload WOULD create. Creates nothing.',
      consumes: ['multipart/form-data'],
      response: { 200: bulkResultsSchema, ...errorResponses },
    },
  }, async (req, reply) => {
    try {
      const { fileBuffer, fileTruncated, scope, defaultFilterSet } = await readBulkUploadParts(req);
      if (fileTruncated) {
        return reply.code(413).send({ error: 'FILE_TOO_LARGE', message: 'Upload exceeds the maximum file size (5 MB).' });
      }
      if (!fileBuffer || fileBuffer.length === 0) {
        return reply.code(400).send({ error: 'VALIDATION', message: 'An .xlsx file is required' });
      }
      const scopeErr = badScope(scope);
      if (scopeErr) return reply.code(400).send({ error: 'VALIDATION', message: scopeErr });

      const result = await bulkUploadFilters(fileBuffer, scope, defaultFilterSet, buildContext(req), { validateOnly: true, canCreateHierarchy: await canCreateHierarchy(req) });
      return { success: true, ...result };
    } catch (err: any) {
      if (err.statusCode === 415 || err.message?.includes('multipart')) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', message: 'Request must be multipart/form-data' });
      }
      if (err instanceof AppError) return reply.code(err.statusCode).send({ error: err.code, message: err.message });
      app.log.error(err);
      return reply.code(500).send({ error: 'VALIDATION_FAILED', message: 'Validation failed' });
    }
  });

  // 11. PUT /instances/:id — Update instance
  // ─── Filter creation workflow: review / approve / reject / resubmit ───
  //
  // Mirrors the PM schedule endpoints. Every action takes an ARRAY of filter
  // ids because a bulk upload creates up to 200 at once and "these 198 are
  // fine, those 2 are wrong" has to work. The per-step ROLE gate lives in the
  // service (system_config['filter-approval']); the permission gate is here.

  app.get('/instances/pending-approval', {
    preHandler: [app.requireAnyPermission('FILTER_REVIEW', 'FILTER_APPROVE', 'ASSET_READ')],
    schema: {
      tags: ['Entities'],
      summary: 'Filters in the create → review → approve workflow',
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['PENDING_REVIEW', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED'] },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const { status } = req.query as { status?: string };
    return listPendingFilters(buildContext(req), status);
  });

  app.get('/instances/approval-counts', {
    preHandler: [app.requirePermission('ASSET_READ')],
    schema: {
      tags: ['Entities'],
      summary: 'Counts per filter approval status (Filters page badges)',
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => pendingFilterCounts(buildContext(req)));

  const idsBody = {
    type: 'object',
    required: ['filterIds'],
    properties: {
      filterIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1 },
      remarks: { type: 'string' },
    },
  } as const;

  app.post('/instances/review', {
    preHandler: [app.requirePermission('FILTER_REVIEW')],
    schema: {
      tags: ['Entities'],
      summary: 'Review newly created filters (PENDING_REVIEW → PENDING_APPROVAL)',
      body: idsBody,
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('REVIEW_FILTER', req, reply);
    if (!ok) return;
    const { filterIds, remarks } = req.body as { filterIds: string[]; remarks?: string };
    return reviewFilters(buildContext(req), filterIds, remarks);
  });

  app.post('/instances/approve', {
    preHandler: [app.requirePermission('FILTER_APPROVE')],
    schema: {
      tags: ['Entities'],
      summary: 'Approve filters for use (→ APPROVED). Only approved filters can be operated.',
      body: idsBody,
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('APPROVE_FILTER', req, reply);
    if (!ok) return;
    const { filterIds, remarks } = req.body as { filterIds: string[]; remarks?: string };
    return approveFilters(buildContext(req), filterIds, remarks);
  });

  app.post('/instances/reject', {
    // Either workflow role may reject, so accept either permission — a reviewer
    // who spots a bad row should not have to pass it on to get it turned back.
    preHandler: [app.requireAnyPermission('FILTER_REVIEW', 'FILTER_APPROVE')],
    schema: {
      tags: ['Entities'],
      summary: 'Reject filters (→ REJECTED). The row survives so it can be corrected and resubmitted.',
      body: {
        type: 'object',
        required: ['filterIds', 'remarks'],
        properties: {
          filterIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1 },
          remarks: { type: 'string', minLength: 1 },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('REJECT_FILTER', req, reply);
    if (!ok) return;
    const { filterIds, remarks } = req.body as { filterIds: string[]; remarks: string };
    return rejectFilters(buildContext(req), filterIds, remarks);
  });

  app.post('/instances/:id/resubmit', {
    preHandler: [app.requireAnyPermission('ASSET_CREATE', 'FILTER_CREATE', 'FILTER_BULK_UPLOAD')],
    schema: {
      tags: ['Entities'],
      summary: 'Resubmit a rejected filter (REJECTED → PENDING_REVIEW)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    const { ok: reauthOk } = await enforceReauth('RESUBMIT_FILTER', req, reply);
    if (!reauthOk) return;
    const { id } = req.params as { id: string };
    return resubmitFilter(buildContext(req), id);
  });

  app.put('/instances/:id', {
    preHandler: [app.requireAnyPermission('ASSET_UPDATE', 'FILTER_EDIT', 'FILTER_HIERARCHY_EDIT')],
    schema: {
      tags: ['Entities'],
      summary: 'Update entity instance',
      description: 'Update an entity instance. If parentId changes, updates CONTAINS relationships.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string' },
          attributes: { type: 'object', additionalProperties: true },
          telemetryConfig: { type: 'object', additionalProperties: true },
          customAttributes: { type: 'object', additionalProperties: true },
          parentId: { type: 'string', format: 'uuid', nullable: true },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth(['UPDATE_ASSET', 'EDIT_FILTER', 'EDIT_HIERARCHY_NODE'], req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const parsed = updateAssetInstanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const instance = await instanceService.update(id, parsed.data, buildContext(req));
    return { success: true, data: instance };
  });

  // 12. PATCH /instances/:id/status — Change status
  app.patch('/instances/:id/status', {
    preHandler: [app.requirePermission('ASSET_UPDATE')],
    schema: {
      tags: ['Entities'],
      summary: 'Change entity instance status',
      description: 'Update the status of an entity instance. Requires ASSET_UPDATE permission.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', description: 'New status value' },
          remarks: { type: 'string', description: 'Reason for status change' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_ASSET', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const body = req.body as { status: string; remarks?: string };
    const instance = await instanceService.changeStatus(id, body.status, buildContext(req), body.remarks);
    return { success: true, data: instance };
  });

  // 12b. PATCH /instances/:id/lifecycle-state — Manual lifecycle state update
  app.patch('/instances/:id/lifecycle-state', {
    // M1 fix (2026-06-30): enforce FILTER_STATUS_UPDATE (the perm the UI gates on),
    // not the broader ASSET_UPDATE. Closes the ASSET_UPDATE-only API bypass.
    preHandler: [app.requirePermission('FILTER_STATUS_UPDATE')],
    schema: {
      tags: ['Entities'],
      summary: 'Manually update filter lifecycle state',
      description: 'Update the currentLifecycleState of a filter instance. Requires re-authentication.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['lifecycleState', 'remarks'],
        properties: {
          lifecycleState: {
            type: 'string',
            // INSTALLED + IN_USE remain valid (system-set / historic), but the
            // manual UI dropdown no longer offers them. CLEANING_CYCLE_COMPLETED
            // (2026-06-02) is the terminal state a finished cleaning cycle sets.
            enum: ['INSTALLED', 'WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT', 'IN_USE', 'CLEANING_CYCLE_COMPLETED'],
            description: 'New lifecycle state',
          },
          remarks: { type: 'string', minLength: 1, description: 'Reason for manual state change' },
          // P3 (2026-06-03): when a manual move starts/restarts a cleaning cycle
          // (backward move with an active cycle, or any cleaning-stage move with
          // no active cycle), a cleaning reason is required. Ignored otherwise.
          cleaningReasonKey: { type: 'string', description: 'Cleaning reason key (required when the move starts a cycle)' },
          cleaningJustification: { type: 'string', description: 'Justification (when the chosen reason requires it)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    // M2 (audit 2026-05-04): use UPDATE_FILTER_LIFECYCLE instead of generic
    // UPDATE_ASSET. Manual lifecycle moves (INSTALLED / WASH_IN / DRY_OUT / etc.)
    // belong to the cleanroom filter workflow, not generic asset edits, and the
    // audit key should reflect that for inspector traceability.
    const { ok } = await enforceReauth('UPDATE_FILTER_LIFECYCLE', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const body = req.body as { lifecycleState: string; remarks: string; cleaningReasonKey?: string; cleaningJustification?: string };
    const instance = await instanceService.changeLifecycleState(id, body.lifecycleState, buildContext(req), body.remarks, {
      cleaningReasonKey: body.cleaningReasonKey ?? null,
      cleaningJustification: body.cleaningJustification ?? null,
    });
    return { success: true, data: instance };
  });

  // 13. DELETE /instances/:id — Soft-delete with cascade
  app.delete('/instances/:id', {
    preHandler: [app.requireAnyPermission('ASSET_DELETE', 'FILTER_DELETE', 'FILTER_HIERARCHY_DELETE')],
    schema: {
      tags: ['Entities'],
      summary: 'Soft-delete entity instance',
      description: 'Set isActive=false on an entity instance and cascade to all children. Also removes related relationships and identifiers.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            deactivatedCount: { type: 'integer' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth(['DELETE_ASSET', 'DELETE_FILTER', 'DELETE_HIERARCHY_NODE'], req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const deactivatedCount = await instanceService.delete(id, buildContext(req));
    return { success: true, deactivatedCount };
  });

  // 14. GET /instances/:id/children — Get direct children
  app.get('/instances/:id/children', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Entities'],
      summary: 'Get direct children of an entity instance',
      description: 'Return the direct children of an entity instance.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              templateId: { type: 'string' },
              status: { type: 'string' },
              isActive: { type: 'boolean' },
              template: {
                type: 'object',
                properties: { name: { type: 'string' }, icon: { type: 'string' } },
              },
              _count: { type: 'object', properties: { children: { type: 'integer' } } },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    return instanceService.getChildren(id);
  });
}
