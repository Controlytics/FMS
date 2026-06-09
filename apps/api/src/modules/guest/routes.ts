import type { FastifyInstance } from 'fastify';
import { errorResponses } from '../../lib/error-schemas.js';
import { stripHtml } from '../../lib/sanitize.js';
import { createNotification } from '../notifications/notification.service.js';

// Registered at /api/guest (see app.ts). PUBLIC — no auth (guest login flow).
// The only endpoint is a guest "filter cleaning request" that drops a
// GUEST_CLEANING_REQUEST notification, gated to the configured recipient roles.
export default async function guestRoutes(app: FastifyInstance) {
  const clean = (v: unknown, max: number) => stripHtml(String(v ?? '')).trim().slice(0, max);

  app.post('/cleaning-request', {
    schema: {
      tags: ['Guest'],
      summary: 'Submit a guest filter cleaning request (public)',
      body: {
        type: 'object',
        required: ['name', 'employeeId', 'block', 'area', 'ahu', 'filter'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          employeeId: { type: 'string', minLength: 1, maxLength: 60 },
          block: { type: 'string', minLength: 1, maxLength: 120 },
          area: { type: 'string', minLength: 1, maxLength: 120 },
          ahu: { type: 'string', minLength: 1, maxLength: 120 },
          filter: { type: 'string', minLength: 1, maxLength: 120 },
        },
      },
      response: { 200: { type: 'object', properties: { success: { type: 'boolean' } } }, ...errorResponses },
    },
  }, async (req, reply) => {
    const b = req.body as Record<string, unknown>;
    const name = clean(b.name, 120);
    const employeeId = clean(b.employeeId, 60);
    const block = clean(b.block, 120);
    const area = clean(b.area, 120);
    const ahu = clean(b.ahu, 120);
    const filter = clean(b.filter, 120);

    if (!name || !employeeId || !block || !area || !ahu || !filter) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'All fields are required.' });
    }

    // forRole left null — visibility is gated to the configured recipient roles
    // (config 'guest-cleaning-requests'.recipientRoles) by notification.service.
    await createNotification({
      type: 'GUEST_CLEANING_REQUEST',
      title: `Filter Cleaning Request from ${name} (${employeeId})`,
      message: [`Block: ${block}`, `Area: ${area}`, `AHU: ${ahu}`, `Filter: ${filter}`].join('\n'),
      metadata: { name, employeeId, block, area, ahu, filter, source: 'guest' },
    });

    return { success: true };
  });
}
