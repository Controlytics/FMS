import { type FastifyInstance } from 'fastify';
import { enforceReauthAlways } from '../../../lib/reauth-check.js';
import { buildContext } from '../../../lib/build-context.js';
import { auditLog } from '../../../lib/audit.js';
import { prisma } from '../../../lib/prisma.js';
import { resolveTabletAccess, TABLET_FEATURES } from '../../../lib/tablet-access.js';
import { ValidationError } from '../../../lib/errors.js';

const liveRoleNames = async () => new Set((await prisma.role.findMany({ select: { name: true } })).map((r) => r.name));

export async function tabletAccessRoutes(app: FastifyInstance) {
  app.get('/tablet-access', {
    // SUPER_ADMIN only (D03-15, 2026-10-22): this decides which roles may sign in
    // on a tablet at all. The card has always been a Super Admin Settings card;
    // the route took CONFIG_READ / CONFIG_UPDATE, so ADMIN could edit it by URL.
    preHandler: [app.requireSuperAdmin()],
    schema: { tags: ['Config'], summary: 'Get tablet app access configuration' },
  }, async () => {
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'tablet-access' } });
    const stored = (row?.configValue as Record<string, unknown> | null) ?? {};
    // A-02 (2026-10-21): entries for roles that no longer exist are hidden - the
    // page echoes the stored value back on save, and the save now refuses them.
    const roles = await liveRoleNames();
    return Object.fromEntries(Object.entries(stored).filter(([role]) => roles.has(role)));
  });

  app.put('/tablet-access', {
    preHandler: [app.requireSuperAdmin()],
    schema: {
      tags: ['Config'],
      summary: 'Update tablet app access configuration',
      body: { type: 'object', additionalProperties: true },
    },
  }, async (req, reply) => {
    // 2026-09-03: gated. This write was CONFIG_UPDATE-only and took no
    // signature at all. enforceReauthAlways, not enforceReauth: the action is
    // newly registered, so it is absent from system_config['action-reauth'] and
    // the config-driven check would gate nobody — the "toggle that does
    // nothing" shape. This decides which roles may log in on the tablet at all.
    const body = req.body as Record<string, unknown>;
    // A-02 (2026-10-21): this decides which roles may sign in on a tablet, and it
    // stored any object as-is (`{OPERATOR: "yes"}` included). Refuse a wrong
    // shape, unknown or SUPER_ADMIN roles (SA is never configurable) and unknown
    // feature keys, naming each.
    const roles = await liveRoleNames();
    const problems: string[] = [];
    for (const [role, features] of Object.entries(body)) {
      if (role.startsWith('_')) continue; // `_currentPassword`: transport field, taken by the gate below
      if (role === 'SUPER_ADMIN') { problems.push('SUPER_ADMIN cannot be configured (it always has every tablet feature)'); continue; }
      if (!roles.has(role)) problems.push(`unknown role ${role}`);
      if (!Array.isArray(features) || !features.every((f) => typeof f === 'string')) { problems.push(`${role} must be a list of feature names`); continue; }
      const unknown = (features as string[]).filter((f) => !TABLET_FEATURES.has(f));
      if (unknown.length) problems.push(`${role}: unknown feature(s) ${unknown.join(', ')}`);
    }
    if (problems.length) throw new ValidationError(`Tablet access not saved: ${problems.join('; ')}.`, { problems });
    // D03-09 / F-42: signed only once the body is known to be valid (the gate
    // also strips `_currentPassword` from `body` before it is stored below).
    const { ok } = await enforceReauthAlways('UPDATE_TABLET_ACCESS', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    await prisma.systemConfig.upsert({
      where: { configKey: 'tablet-access' },
      update: { configValue: body as any },
      create: { configKey: 'tablet-access', configValue: body as any, configType: 'security' },
    });
    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CONFIG_CHANGED',
      targetType: 'system_config', targetId: 'tablet-access',
      afterValue: body,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
    return { success: true };
  });

  // Authenticated-but-no-specific-permission: mobile app checks its allowed features
  //
  // 2026-05-21 v2 — deny-by-default for unconfigured roles once the admin has
  // configured at least one role. Behaviour matrix:
  //   - SUPER_ADMIN: always allowed everything (hardcoded — admin recovery
  //     route; lets the global owner reach the tablet config UI on the tablet
  //     even if they accidentally locked the role out).
  //   - Tablet-access config doesn't exist OR is empty `{}`:
  //       → fall back to legacy default-allow (`configured: false`) so a fresh
  //         install / never-configured install behaves the same as before.
  //   - Config has at least one role configured AND this role has its own
  //     entry: respect that entry exactly (`configured: true`).
  //   - Config has at least one role configured AND this role has NO entry:
  //     deny everything (`configured: true`, `allowed: []`). This is the bit
  //     operators expect: admin opted into the allowlist UI and only checked
  //     SUPERVISOR — everyone else is locked out, not silently default-allowed.
  app.get('/tablet-access/my-features', {
    schema: { tags: ['Config'], summary: 'Get allowed tablet features for the current user' },
  }, async (req) => {
    const role = req.user?.role;
    if (!role) return { allowed: [], configured: false };

    // 2026-10-13: the rule lives in lib/tablet-access.ts so the login refusal
    // (auth.service `client: 'tablet'`) reads exactly the same answer.
    // SUPER_ADMIN is hardcoded there to everything — it cannot be locked out.
    return { role, ...(await resolveTabletAccess(role)) };
  });
}
