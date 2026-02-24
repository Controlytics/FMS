import type { RequestContext } from '../../types/context.js';
import { auditLog } from '../../lib/audit.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { configRepository } from './config.repository.js';
import { getActionReauthConfig, invalidateReauthCache, isReauthRequired } from '../../lib/reauth-check.js';
import { getDefaultTemplates, FEATURE_TO_PERMISSION_MAP, FEATURE_PRIVILEGES } from '@digilog/shared';
import { validateUserId } from '../../lib/user-id-validator.js';
import { prisma } from '../../lib/prisma.js';

/**
 * Reverse-map a role's permission constants to feature privilege booleans.
 * Used to populate the Role Privileges page when role_configs has no data.
 */
function reverseMapPermissions(rolePermissions: string[]): Record<string, boolean> {
  const featurePerms: Record<string, boolean> = {};
  for (const feature of FEATURE_PRIVILEGES) {
    const requiredPerms = FEATURE_TO_PERMISSION_MAP[feature.id];
    if (requiredPerms) {
      // Feature is enabled if ANY of its mapped permissions exist in the role
      featurePerms[feature.id] = requiredPerms.some(p => rolePermissions.includes(p));
    }
  }
  return featurePerms;
}

export const configService = {
  async getConfig(key: string, schema: any) {
    const config = await configRepository.getSystemConfig(key);
    const parsed = schema.safeParse(config?.configValue ?? {});
    return parsed.success ? parsed.data : config?.configValue ?? {};
  },

  async updateConfig(key: string, data: any, schema: any, configType: string, requiresReauth: boolean, ctx: RequestContext) {
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new ValidationError('VALIDATION_ERROR', parsed.error.flatten());

    const existing = await configRepository.getSystemConfig(key);
    const beforeValue = existing?.configValue;

    await configRepository.upsertSystemConfig(key, parsed.data, configType, requiresReauth, ctx.userId);

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CONFIG_CHANGED',
      targetType: 'config', targetId: key,
      beforeValue: beforeValue as any, afterValue: parsed.data,
      signatureMeaning: `System configuration modified: ${key}`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return parsed.data;
  },

  // Role Configuration
  async listRoleConfigs() {
    return configRepository.findAllRoleConfigs();
  },

  async getRoleConfig(role: string) {
    const config = await configRepository.findRoleConfig(role);
    const permissions = (config?.permissions as Record<string, boolean>) ?? {};

    // If role_configs has no feature privileges, reverse-map from roles.permissions
    const hasFeaturePerms = Object.keys(permissions).length > 0;
    if (!hasFeaturePerms) {
      const roleRecord = await prisma.role.findUnique({ where: { name: role }, select: { permissions: true } });
      const rolePerms = (roleRecord?.permissions as string[]) ?? [];
      if (rolePerms.length > 0) {
        const mapped = reverseMapPermissions(rolePerms);
        return {
          role,
          sidebarItems: (config?.sidebarItems as string[]) ?? [],
          homeWidgets: (config?.homeWidgets as string[]) ?? [],
          permissions: mapped,
        };
      }
    }

    return config ?? { role, sidebarItems: [], homeWidgets: [], permissions: {} };
  },

  async updateRoleConfig(role: string, data: { sidebarItems?: string[]; homeWidgets?: string[]; permissions?: Record<string, boolean> }, ctx: RequestContext) {
    const existing = await configRepository.findRoleConfig(role);
    const beforeValue = existing ? { sidebarItems: existing.sidebarItems, homeWidgets: existing.homeWidgets, permissions: existing.permissions } : null;

    const config = await configRepository.upsertRoleConfig(role, data, existing, ctx.userId);

    // Sync feature privileges to role's permissions array
    if (data.permissions) {
      const permissionSet = new Set<string>();
      for (const [featureId, enabled] of Object.entries(data.permissions)) {
        if (enabled && FEATURE_TO_PERMISSION_MAP[featureId]) {
          for (const perm of FEATURE_TO_PERMISSION_MAP[featureId]) {
            permissionSet.add(perm);
          }
        }
      }
      const permissionsArray = Array.from(permissionSet);
      await prisma.role.updateMany({
        where: { name: role },
        data: { permissions: permissionsArray },
      });
    }

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CONFIG_CHANGED',
      targetType: 'role_config', targetId: role,
      beforeValue: beforeValue as any,
      afterValue: { sidebarItems: config.sidebarItems, homeWidgets: config.homeWidgets, permissions: config.permissions },
      signatureMeaning: `Role configuration updated for ${role}`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return config;
  },

  // User Configuration
  async getUserConfig(userId: string) {
    const config = await configRepository.findUserConfig(userId);
    return config ?? { userId, sidebarItems: [], homeWidgets: [], permissions: {} };
  },

  async updateUserConfig(userId: string, data: { sidebarItems?: string[]; homeWidgets?: string[]; permissions?: Record<string, boolean> }, ctx: RequestContext) {
    const existing = await configRepository.findUserConfig(userId);
    const beforeValue = existing ? { sidebarItems: existing.sidebarItems, homeWidgets: existing.homeWidgets, permissions: existing.permissions } : null;

    const config = await configRepository.upsertUserConfig(userId, data, existing, ctx.userId);

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CONFIG_CHANGED',
      targetType: 'user_config', targetId: userId,
      beforeValue: beforeValue as any,
      afterValue: { sidebarItems: config.sidebarItems, homeWidgets: config.homeWidgets, permissions: config.permissions },
      signatureMeaning: `User-specific configuration updated for ${userId}`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return config;
  },

  async getMyConfig(username: string) {
    const user = await configRepository.findUserByUsername(username);
    if (!user) return { sidebarItems: [], homeWidgets: [], permissions: {} };

    const userConfig = await configRepository.findUserConfig(user.id);
    if (userConfig && ((userConfig.sidebarItems as any[]).length > 0 || Object.keys(userConfig.permissions as any).length > 0)) {
      return userConfig;
    }

    const roleConfig = await configRepository.findRoleConfig(user.role);
    return roleConfig ?? { sidebarItems: [], homeWidgets: [], permissions: {} };
  },

  // Field IDs
  async listFieldIds() {
    return configRepository.findAllFieldIds();
  },

  async updateFieldId(fieldId: string, displayName: string, ctx: RequestContext) {
    if (!displayName || displayName.trim().length === 0) throw new ValidationError('displayName is required');

    const field = await configRepository.findFieldId(fieldId);
    if (!field) throw new NotFoundError('Field ID not found');

    const beforeValue = { displayName: field.displayName };
    await configRepository.updateFieldId(fieldId, displayName, ctx.userId);

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CONFIG_CHANGED',
      targetType: 'field_id_config', targetId: fieldId,
      beforeValue, afterValue: { displayName: displayName.trim() },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
  },

  // Action Reauth
  async getActionReauth() {
    return getActionReauthConfig();
  },

  async updateActionReauth(data: any, schema: any, ctx: RequestContext) {
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new ValidationError('VALIDATION_ERROR', parsed.error.flatten());

    const existing = await configRepository.getSystemConfig('action-reauth');
    const beforeValue = existing?.configValue;

    await configRepository.upsertSystemConfig('action-reauth', parsed.data, 'security', false, ctx.userId);
    invalidateReauthCache();

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CONFIG_CHANGED',
      targetType: 'config', targetId: 'action-reauth',
      beforeValue: beforeValue as any, afterValue: parsed.data,
      signatureMeaning: 'Action re-authentication configuration modified',
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return parsed.data;
  },

  async checkReauth(action: string, role: string) {
    const needed = await isReauthRequired(action, role);
    return { action, required: needed };
  },

  async getMyActions(role: string) {
    const config = await getActionReauthConfig();
    const actions: string[] = [];
    for (const [action, roles] of Object.entries(config)) {
      if (roles.includes(role)) actions.push(action);
    }
    return { actions };
  },

  // Audit Templates
  async getAuditTemplates() {
    const defaults = getDefaultTemplates();
    const config = await configRepository.getSystemConfig('audit-templates');
    const saved = (config?.configValue ?? {}) as Record<string, string>;
    return { ...defaults, ...saved };
  },

  async updateAuditTemplates(data: any, schema: any, ctx: RequestContext) {
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new ValidationError('VALIDATION_ERROR', parsed.error.flatten());

    const existing = await configRepository.getSystemConfig('audit-templates');
    const beforeValue = existing?.configValue;

    await configRepository.upsertSystemConfig('audit-templates', parsed.data, 'display', false, ctx.userId);

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CONFIG_CHANGED',
      targetType: 'config', targetId: 'audit-templates',
      beforeValue: beforeValue as any, afterValue: parsed.data,
      signatureMeaning: 'Audit text templates configuration modified',
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return parsed.data;
  },

  // User ID
  async getNextUserId(schema: any) {
    const config = await configRepository.getSystemConfig('user-id');
    const settings = schema.safeParse(config?.configValue ?? {});
    const cfg = settings.success ? settings.data : schema.parse({});

    if (!cfg.autoGenerate) return { autoGenerate: false, nextId: null };

    const prefix = cfg.prefix + cfg.prefixSeparator;
    let maxNum = cfg.startNumber - 1;

    if (cfg.prefix) {
      const result = await configRepository.getMaxUserIdNum(prefix);
      if (result[0]?.max_num && result[0].max_num > maxNum) maxNum = result[0].max_num;
    } else {
      const result = await configRepository.getMaxUserIdNumAll();
      if (result[0]?.max_num && result[0].max_num > maxNum) maxNum = result[0].max_num;
    }

    const nextNum = maxNum + 1;
    const numStr = String(nextNum).padStart(cfg.length - (cfg.prefix?.length ?? 0) - (cfg.prefixSeparator?.length ?? 0), '0');
    const nextId = cfg.prefix ? `${cfg.prefix}${cfg.prefixSeparator}${numStr}` : numStr;

    return { autoGenerate: true, nextId };
  },

  async validateUserId(userId: string) {
    if (!userId) throw new ValidationError('User ID is required');
    const result = await validateUserId(userId);
    return result.valid ? { valid: true } : { valid: false, errors: result.errors };
  },
};
