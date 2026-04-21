import { type FastifyInstance } from 'fastify';
import { errorResponses } from '../../../lib/error-schemas.js';
import { buildContext } from '../../../lib/build-context.js';
import { configService } from '../config.service.js';

export async function alarmColumnsRoutes(app: FastifyInstance) {
  app.get('/alarm-columns', {
    preHandler: [app.requirePermission('CONFIG_READ')],
    schema: {
      tags: ['Config'],
      summary: 'Get alarm column visibility configuration',
      description: 'Retrieve the alarm column visibility settings for all roles. Returns a map of role names to arrays of visible column IDs.',
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async () => {
    return configService.getAlarmColumns();
  });

  app.put('/alarm-columns', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['Config'],
      summary: 'Update alarm column visibility configuration',
      description: 'Set which alarm columns are visible for each role. Pass an object mapping role names to arrays of column IDs.',
      body: { type: 'object', additionalProperties: true },
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
  }, async (req) => {
    const ctx = buildContext(req);
    const data = await configService.updateAlarmColumns(req.body as Record<string, string[]>, ctx);
    return { success: true, data };
  });

  app.get('/alarm-columns/current', {
    schema: {
      tags: ['Config'],
      summary: 'Get current user alarm column visibility',
      description: 'Returns the list of visible alarm column IDs for the authenticated user based on their role configuration.',
      response: {
        200: {
          type: 'object',
          properties: { columns: { type: 'array', items: { type: 'string' } } },
        },
      },
    },
  }, async (req) => {
    return configService.getMyAlarmColumns(req.user.username);
  });
}
