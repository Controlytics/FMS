import { type FastifyInstance } from 'fastify';
import { buildContext } from '../../../lib/build-context.js';
import { enforceReauthAlways } from '../../../lib/reauth-check.js';
import { auditLog } from '../../../lib/audit.js';
import { prisma } from '../../../lib/prisma.js';

// Stored shape: { [moduleKey: string]: string[] }  — role names allowed to open each module
export async function accessMatrixRoutes(app: FastifyInstance) {
  app.get('/access-matrix', {
    preHandler: [app.requirePermission('CONFIG_READ')],
    schema: { tags: ['Config'], summary: 'Get configuration access matrix' },
  }, async () => {
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'access-matrix' } });
    return (row?.configValue as any) ?? {};
  });

  app.put('/access-matrix', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['Config'],
      summary: 'Update configuration access matrix',
      body: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
    },
  }, async (req, reply) => {
    // 2026-09-03: the backend half of the 2026-05-04 web-routes review (H1).
    // access-matrix.tsx has wrapped this save in reauth.execute since then, but
    // the ENDPOINT never checked — so the signature was a UI convention any
    // direct API call skipped, and "any user with CONFIG_UPDATE could rebind
    // every config tab to every role" stayed true off-screen.
    //
    // enforceReauthAlways, NOT enforceReauth, because the admin-managed policy
    // cannot gate this one: `UPDATE_ROLE_CONFIG` is configured for SUPERVISOR
    // and PROJECT_LEADER, while the roles that actually hold CONFIG_UPDATE are
    // ADMIN and SUPER_ADMIN — so the config-driven check would enforce nothing
    // for exactly the callers that can reach the route. Which module each role
    // may open is not an opt-in policy.
    //
    // The UI needs no change: useReauth.execute runs the callback passwordless
    // first, and re-throws this 401 to pop its own dialog (api-client.ts:66),
    // then retries with the password. One extra round trip, no stuck spinner —
    // save()'s onError clears `saving`, and a cancel falls back to it.
    const { ok } = await enforceReauthAlways('UPDATE_ROLE_CONFIG', req, reply);
    if (!ok) return;

    const body = req.body as Record<string, string[]>;
    const ctx = buildContext(req);
    const existing = await prisma.systemConfig.findUnique({ where: { configKey: 'access-matrix' } });
    await prisma.systemConfig.upsert({
      where: { configKey: 'access-matrix' },
      update: { configValue: body },
      create: { configKey: 'access-matrix', configValue: body as any, configType: 'security' },
    });
    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CONFIG_CHANGED',
      targetType: 'system_config', targetId: 'access-matrix',
      beforeValue: existing?.configValue,
      afterValue: body,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
    return { success: true };
  });

  app.get('/access-matrix/my-modules', {
    schema: { tags: ['Config'], summary: 'Get modules allowed for the current role' },
  }, async (req) => {
    const role = req.user?.role;
    if (!role) return { role: null, allowed: [] as string[] };
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'access-matrix' } });
    const matrix = (row?.configValue as Record<string, string[]>) ?? {};
    const allowed = Object.entries(matrix)
      .filter(([, roles]) => Array.isArray(roles) && roles.includes(role))
      .map(([moduleKey]) => moduleKey);
    return { role, allowed };
  });
}
