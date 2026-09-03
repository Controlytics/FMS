import { type FastifyInstance } from 'fastify';
import { passwordPolicySchema, loginSecuritySchema, sessionConfigSchema, datetimeConfigSchema, paginationConfigSchema, exportLimitConfigSchema, backupFormatConfigSchema } from '@digilog/shared';
import { enforceReauth, enforceReauthAlways } from '../../lib/reauth-check.js';
import { errorResponses } from '../../lib/error-schemas.js';
import { buildContext } from '../../lib/build-context.js';
import { configService } from './config.service.js';
import { prisma } from '../../lib/prisma.js';

// Extracted route groups — one file per config surface under static-routes/.
// See each file for the specific endpoints. Adding a new config tab should follow
// the same pattern: create static-routes/<surface>.routes.ts, then register below.
import { actionReauthRoutes } from './static-routes/action-reauth.routes.js';
import { brandingRoutes } from './static-routes/branding.routes.js';
import { userIdRoutes } from './static-routes/user-id.routes.js';
import { fieldIdsRoutes } from './static-routes/field-ids.routes.js';
import { auditTemplatesRoutes } from './static-routes/audit-templates.routes.js';
import { dashboardCardsRoutes } from './static-routes/dashboard-cards.routes.js';
import { tabletAccessRoutes } from './static-routes/tablet-access.routes.js';
import { accessMatrixRoutes } from './static-routes/access-matrix.routes.js';
import { rolesConfigRoutes } from './static-routes/roles.routes.js';
import { cleaningProfileAssignmentRoutes } from './static-routes/cleaning-profile-assignment.routes.js';
import { reportPageTitlesRoutes } from './static-routes/report-page-titles.routes.js';
import { reportLabelsRoutes } from './static-routes/report-labels.routes.js';
import { offlineCacheRoutes } from './static-routes/offline-cache.routes.js';
import { exportOptionsRoutes } from './static-routes/export-options.routes.js';
import { replacementScheduleFiltersRoutes } from './static-routes/replacement-schedule-filters.routes.js';
import { pmScheduleFiltersRoutes } from './static-routes/pm-schedule-filters.routes.js';
import { reportSignatoriesRoutes } from './static-routes/report-signatories.routes.js';
import { ahuCompletionProcessRoutes } from './static-routes/ahu-completion-process.routes.js';
import { blockChangeApprovalRoutes } from './static-routes/block-change-approval.routes.js';

// Map config keys to reauth action names (consumed by the generic configEndpoint factory).
const CONFIG_KEY_TO_ACTION: Record<string, string> = {
  'password-policy': 'UPDATE_PASSWORD_POLICY',
  'login-security': 'UPDATE_LOGIN_SECURITY',
  'session': 'UPDATE_SESSION_CONFIG',
  'datetime': 'UPDATE_DATETIME_CONFIG',
};

export default async function configRoutes(app: FastifyInstance) {
  // Register extracted route groups
  await actionReauthRoutes(app);
  await brandingRoutes(app);
  await userIdRoutes(app);
  await fieldIdsRoutes(app);
  await auditTemplatesRoutes(app);
  await dashboardCardsRoutes(app);
  await tabletAccessRoutes(app);
  await accessMatrixRoutes(app);
  await exportOptionsRoutes(app);
  await replacementScheduleFiltersRoutes(app);
  await pmScheduleFiltersRoutes(app);
  await reportSignatoriesRoutes(app);
  await rolesConfigRoutes(app);
  await cleaningProfileAssignmentRoutes(app);
  await reportPageTitlesRoutes(app);
  await reportLabelsRoutes(app);
  await offlineCacheRoutes(app);
  await ahuCompletionProcessRoutes(app);
  await blockChangeApprovalRoutes(app);

  // Generic CRUD factory for configs whose only work is get/update a typed blob.
  // Used for: password-policy, login-security, session, datetime, pagination.
  //
  // `superAdminOnly` restricts BOTH the admin GET and the PUT to SUPER_ADMIN.
  // It does NOT touch the matching `/<key>/current` public read below — those
  // feed every authenticated page (and, for datetime, the unauthenticated login
  // screen via PUBLIC_GET_PATHS), so locking them would break date rendering
  // app-wide rather than restrict who can EDIT the setting.
  const configEndpoint = (key: string, schema: any, requiresReauth: boolean, superAdminOnly = false) => {
    const titleKey = key.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    app.get(`/${key}`, {
      preHandler: [superAdminOnly ? app.requireSuperAdmin() : app.requirePermission('CONFIG_READ')],
      schema: {
        tags: ['Config'],
        summary: `Get ${titleKey} configuration`,
        description: `Retrieve the current ${titleKey} configuration. Returns defaults if not yet configured.`,
        response: {
          200: { type: 'object', additionalProperties: true, description: `${titleKey} configuration object` },
        },
      },
    }, async () => {
      return configService.getConfig(key, schema);
    });

    app.put(`/${key}`, {
      preHandler: [superAdminOnly ? app.requireSuperAdmin() : app.requirePermission('CONFIG_UPDATE')],
      schema: {
        tags: ['Config'],
        summary: `Update ${titleKey} configuration`,
        description: `Update the ${titleKey} configuration. ${requiresReauth ? 'Changes require user re-authentication.' : ''}`,
        body: { type: 'object', description: `${titleKey} configuration values` },
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
      const body = req.body as Record<string, unknown>;

      // Dynamic re-auth from action-reauth config
      const actionKey = CONFIG_KEY_TO_ACTION[key];
      if (actionKey) {
        const { ok } = await enforceReauth(actionKey, req, reply);
        if (!ok) return;
      }

      // Hardcoded re-auth: always required for sensitive config changes
      // (password-policy, login-security, session, datetime), whatever the
      // admin-managed action-reauth policy says. Skip when the dynamic
      // enforceReauth above already verified the password — it wrote the
      // REAUTH_SUCCESS row, and re-checking would demand the password twice.
      //
      // 2026-09-03: this used to hand-roll the check — a bare verifyPassword on
      // a user row. That had TWO holes the shared path does not:
      //   1. no lockout counting, so a stolen-session holder could grind the
      //      password here indefinitely (the exact oracle the 2026-07-09 review
      //      closed for enforceReauth and for /auth/offline-grant); and
      //   2. no audit row, so the electronic signature on the four most
      //      sensitive configs in the system was never recorded.
      // enforceReauthAlways does both. It reads the password from the body or
      // the x-reauth-password header exactly as before, so the e2e helpers and
      // the UI are unaffected; only the failure MESSAGE wording changes, and
      // every caller branches on `error`, not the text.
      if (requiresReauth && !(req as any)._reauthVerified) {
        const { ok } = await enforceReauthAlways(
          actionKey ?? `UPDATE_${key.toUpperCase().replace(/-/g, '_')}`,
          req,
          reply,
        );
        if (!ok) return;
      }

      const ctx = buildContext(req);
      const data = await configService.updateConfig(key, body, schema, 'security', requiresReauth, ctx);
      return { success: true, data };
    });
  };

  configEndpoint('password-policy', passwordPolicySchema, true);
  configEndpoint('login-security', loginSecuritySchema, true);
  configEndpoint('session', sessionConfigSchema, true);
  // 2026-09-03 (operator request): Date/Time moved to SUPER_ADMIN. It sets the
  // date/time format every §11 record is READ in, so it is not an ADMIN-level
  // display preference. ADMIN held it until now (access-matrix `datetime ->
  // ['ADMIN']` + CONFIG_UPDATE) and loses the ability to edit it; the stale
  // matrix grant is left in place, inert, rather than rewritten from code.
  configEndpoint('datetime', datetimeConfigSchema, true, true);
  configEndpoint('pagination', paginationConfigSchema, false);
  configEndpoint('export-limit', exportLimitConfigSchema, false);
  configEndpoint('backup-format', backupFormatConfigSchema, false);

  // Public reads — all authenticated users (no admin permission required).
  app.get('/password-policy/current', {
    schema: {
      tags: ['Config'],
      summary: 'Get current password policy settings',
      description: 'Retrieve the current password policy (session timeout, expiry). Available to all authenticated users.',
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async () => {
    return configService.getConfig('password-policy', passwordPolicySchema);
  });

  app.get('/pagination/current', {
    schema: {
      tags: ['Config'],
      summary: 'Get current pagination settings',
      description: 'Retrieve the current pagination options (records per page). Available to all authenticated users.',
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async () => {
    return configService.getConfig('pagination', paginationConfigSchema);
  });

  app.get('/datetime/current', {
    schema: {
      tags: ['Config'],
      summary: 'Get current datetime format settings',
      description: 'Retrieve the current date/time format configuration. Available to all authenticated users.',
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async () => {
    return configService.getConfig('datetime', datetimeConfigSchema);
  });

  // Public read — all authenticated users. Every export page (operators
  // included) reads the configured limit here so a raised limit reaches every
  // role, not just admins who can hit the CONFIG_READ-gated endpoint above.
  app.get('/export-limit/current', {
    schema: {
      tags: ['Config'],
      summary: 'Get current export-limit settings',
      description: 'Retrieve the current export record limit and message. Available to all authenticated users.',
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async () => {
    return configService.getConfig('export-limit', exportLimitConfigSchema);
  });

  // Public read — all authenticated users. The Backup & Restore page preselects
  // this format, and BACKUP_EXPORT does not imply CONFIG_READ, so gating this
  // behind the admin endpoint above would leave a backup operator silently
  // falling back to the built-in default instead of the configured one.
  app.get('/backup-format/current', {
    schema: {
      tags: ['Config'],
      summary: 'Get the configured default backup format',
      description: 'Retrieve the default backup file format preselected on the Backup & Restore page. Available to all authenticated users.',
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async () => {
    return configService.getConfig('backup-format', backupFormatConfigSchema);
  });
}
