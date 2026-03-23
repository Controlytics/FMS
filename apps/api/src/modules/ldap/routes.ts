import { type FastifyInstance } from 'fastify';
import { ldapService } from './ldap.service.js';
import { auditLog } from '../../lib/audit.js';

export default async function ldapRoutes(app: FastifyInstance) {
  // GET /api/ldap/config
  app.get('/config', {
    preHandler: [app.requirePermission('CONFIG_READ')],
    schema: { tags: ['LDAP'], summary: 'Get LDAP configuration' },
  }, async () => {
    const config = await ldapService.getConfig();
    return { ...config, bindPassword: config.bindPassword ? '********' : '' };
  });

  // PUT /api/ldap/config
  app.put('/config', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['LDAP'],
      summary: 'Update LDAP configuration',
      body: { type: 'object', additionalProperties: true },
    },
  }, async (req, reply) => {
    const body = req.body as Record<string, any>;
    await ldapService.saveConfig(body, req.user.username);

    await auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'LDAP_CONFIG_UPDATED',
      targetType: 'system_config',
      targetId: 'ldap',
      afterValue: { ...body, bindPassword: '********' },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { success: true, message: 'LDAP configuration updated' };
  });

  // POST /api/ldap/test-connection
  app.post('/test-connection', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['LDAP'],
      summary: 'Test LDAP connection',
      body: { type: 'object', additionalProperties: true },
    },
  }, async (req) => {
    const body = req.body as Record<string, any>;
    const hasConfig = body && Object.keys(body).length > 0;
    return ldapService.testConnection(hasConfig ? body : undefined);
  });

  // GET /api/ldap/status
  app.get('/status', {
    preHandler: [app.requirePermission('CONFIG_READ')],
    schema: { tags: ['LDAP'], summary: 'Get LDAP status' },
  }, async () => {
    const config = await ldapService.getConfig();
    return { enabled: config.enabled, serverUrl: config.serverUrl || null };
  });
}
