/**
 * Sync routes — Phase 8.4b (Option D, 2026-05-02).
 *
 * GET /api/sync/since — versioned local-cache hydrator.
 *
 * Auth: any logged-in user (single-tenant; data is filtered by what the
 * user's templates make visible — today, all FILTER-kind instances). The
 * global onRequest hook in plugins/auth.ts already enforces the bearer-
 * token check; no `requirePermission()` is added here per task brief.
 */
import type { FastifyInstance } from 'fastify';
import { SyncService } from './sync.service.js';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';

export default async function syncRoutes(app: FastifyInstance) {
  const service = new SyncService();

  app.get('/since', {
    schema: {
      tags: ['Sync'],
      summary: 'Versioned local-cache hydrator (Option D, 8.4b)',
      description: 'Returns rows newer than the client cursors. Each entity '
        + 'is capped at 500 rows; if any entity hits the cap, hasMore=true '
        + 'and the FE retries with updated cursors. checklistProfiles and '
        + 'assetTemplates are always [] in 8.4b (deferred to 8.4a follow-up).',
      querystring: {
        type: 'object',
        properties: {
          profileVersion: { type: 'integer', minimum: 0, default: 0 },
          filterProfileVersion: { type: 'integer', minimum: 0, default: 0 },
          equipmentGroupVersion: { type: 'integer', minimum: 0, default: 0 },
          checklistVersion: { type: 'integer', minimum: 0, default: 0 },
          assetTemplateVersion: { type: 'integer', minimum: 0, default: 0 },
          filterUpdatedSince: { type: 'string', nullable: true },
        },
      },
      response: {
        // Top-level shape is explicit so Fastify won't strip the entity arrays
        // even when empty. Each entity item uses additionalProperties:true so
        // Prisma row shapes pass through verbatim — same convention as the
        // existing `/:id` and version-history routes (filter-profiles/routes.ts).
        200: {
          type: 'object',
          required: [
            'filterCleaningProfiles',
            'filterProfiles',
            'equipmentGroups',
            'checklistProfiles',
            'assetTemplates',
            'filters',
            'serverTimestamp',
            'hasMore',
          ],
          properties: {
            filterCleaningProfiles: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
            filterProfiles: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
            equipmentGroups: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
            checklistProfiles: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
            assetTemplates: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
            filters: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
            serverTimestamp: { type: 'string' },
            hasMore: { type: 'boolean' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const q = req.query as Record<string, unknown>;
    return service.since(ctx, {
      profileVersion: q.profileVersion as number | undefined,
      filterProfileVersion: q.filterProfileVersion as number | undefined,
      equipmentGroupVersion: q.equipmentGroupVersion as number | undefined,
      checklistVersion: q.checklistVersion as number | undefined,
      assetTemplateVersion: q.assetTemplateVersion as number | undefined,
      filterUpdatedSince: q.filterUpdatedSince as string | undefined,
    });
  });
}
