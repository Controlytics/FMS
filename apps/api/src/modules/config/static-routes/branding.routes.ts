import { type FastifyInstance } from 'fastify';
import { brandingConfigSchema } from '@digilog/shared';
import { enforceReauth } from '../../../lib/reauth-check.js';
import { buildContext } from '../../../lib/build-context.js';
import { configService } from '../config.service.js';

export async function brandingRoutes(app: FastifyInstance) {
  // Public GET for login page
  app.get('/branding', {
    schema: {
      tags: ['Config'],
      summary: 'Get branding configuration',
      description: 'Retrieve the current branding settings (company name, logo, colors). Public endpoint for login page.',
      response: {
        200: { type: 'object', additionalProperties: true, description: 'Branding configuration object' },
      },
    },
  }, async () => {
    return configService.getConfig('branding', brandingConfigSchema);
  });

  app.put('/branding', {
    // SUPER_ADMIN only (D03-15, 2026-10-22): edited only on a SUPER_ADMIN-only
    // page; CONFIG_UPDATE let ADMIN save it by calling the API directly.
    preHandler: [app.requireSuperAdmin()],
    schema: {
      tags: ['Config'],
      summary: 'Update branding configuration',
      description: 'Update branding settings such as company name, logo URL, and theme colors. SUPER_ADMIN only.',
      body: { type: 'object', description: 'Branding configuration values' },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            details: { type: 'object' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_BRANDING', req, reply);
    if (!ok) return;

    const ctx = buildContext(req);
    const data = await configService.updateConfig('branding', req.body, brandingConfigSchema, 'branding', false, ctx);
    return { success: true, data };
  });
}
