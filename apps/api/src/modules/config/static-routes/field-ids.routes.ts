import { type FastifyInstance } from 'fastify';
import { enforceReauthAlways } from '../../../lib/reauth-check.js';
import { buildContext } from '../../../lib/build-context.js';
import { configService } from '../config.service.js';

export async function fieldIdsRoutes(app: FastifyInstance) {
  // 2026-05-26 audit fix (PA-BE-1): pre-fix this GET had no permission
  // preHandler. Pattern drift — every other admin-config list GET in
  // this codebase gates the full list on CONFIG_READ and exposes a
  // separate `/current` for everyone. Added CONFIG_READ to match.
  app.get('/field-ids', {
    preHandler: [app.requirePermission('CONFIG_READ')],
    schema: {
      tags: ['Config'],
      summary: 'List all field ID configurations',
      description: 'Retrieve all field ID label configurations. Requires CONFIG_READ permission.',
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

  // The labels themselves, for every signed-in user (2026-10-01).
  //
  // The 2026-05-26 fix above gated the full list on CONFIG_READ and its comment
  // says the pattern is "a separate `/current` for everyone" — but that
  // `/current` was never added. So `useFieldLabels` (and the tablet's label
  // warm-up) called the gated list: every role without CONFIG_READ got a 403 on
  // each page load, and an admin's renamed labels never reached operators, who
  // kept seeing the built-in defaults. Found when the http log started naming
  // refusals — the tablet was logging one 403 every ~10 seconds.
  //
  // Returns only what a label needs: the field id and its display name. No
  // module, description, timestamps or editor — those stay behind CONFIG_READ.
  app.get('/field-ids/current', {
    schema: {
      tags: ['Config'],
      summary: 'Field labels for the signed-in user',
      description: 'The display name of every field id. Authenticated; no permission required. The full records need CONFIG_READ (GET /field-ids).',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fieldId: { type: 'string' },
              displayName: { type: 'string' },
            },
          },
        },
      },
    },
  }, async () => {
    const all = await configService.listFieldIds();
    return all.map((f: { fieldId: string; displayName: string }) => ({ fieldId: f.fieldId, displayName: f.displayName }));
  });

  app.put('/field-ids/:fieldId', {
    preHandler: [app.requirePermission('FIELD_ID_UPDATE')],
    schema: {
      tags: ['Config'],
      summary: 'Update field ID display name',
      description: 'Update the display name for a specific field ID. Requires FIELD_ID_UPDATE permission (granted by the `config.field_ids` feature toggle on the Role Privileges page).',
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
  }, async (req, reply) => {
    // 2026-09-03: gated. This write was CONFIG_UPDATE-only and took no
    // signature at all. enforceReauthAlways, not enforceReauth: the action is
    // newly registered, so it is absent from system_config['action-reauth'] and
    // the config-driven check would gate nobody — the "toggle that does
    // nothing" shape. This renames the field labels operators read on every record.
    const { ok } = await enforceReauthAlways('UPDATE_FIELD_ID', req, reply);
    if (!ok) return;

    const { fieldId } = req.params as { fieldId: string };
    const { displayName } = req.body as { displayName: string };
    const ctx = buildContext(req);
    await configService.updateFieldId(fieldId, displayName, ctx);
    return { success: true };
  });
}
