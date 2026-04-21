import { type FastifyInstance } from 'fastify';
import { buildContext } from '../../../lib/build-context.js';
import { configService } from '../config.service.js';

export async function fieldIdsRoutes(app: FastifyInstance) {
  app.get('/field-ids', {
    schema: {
      tags: ['Config'],
      summary: 'List all field ID configurations',
      description: 'Retrieve all field ID label configurations. Available to all authenticated users.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              fieldId: { type: 'string' },
              defaultName: { type: 'string' },
              displayName: { type: 'string' },
              module: { type: 'string' },
              description: { type: 'string', nullable: true },
              updatedAt: { type: 'string' },
              updatedBy: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
  }, async () => {
    return configService.listFieldIds();
  });

  app.put('/field-ids/:fieldId', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['Config'],
      summary: 'Update field ID display name',
      description: 'Update the display name for a specific field ID. Requires CONFIG_UPDATE permission.',
      params: {
        type: 'object',
        required: ['fieldId'],
        properties: { fieldId: { type: 'string', description: 'Field ID to update' } },
      },
      body: {
        type: 'object',
        required: ['displayName'],
        properties: { displayName: { type: 'string', description: 'New display name for the field' } },
      },
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' } } },
        400: { type: 'object', properties: { error: { type: 'string' } } },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (req) => {
    const { fieldId } = req.params as { fieldId: string };
    const { displayName } = req.body as { displayName: string };
    const ctx = buildContext(req);
    await configService.updateFieldId(fieldId, displayName, ctx);
    return { success: true };
  });
}
