import { Client } from 'ldapts';
import { prisma } from '../../lib/prisma.js';
import { invalidateUserAuthCache } from '../../plugins/auth.js';

/**
 * Escape a string for safe use as an LDAP search-filter assertion value.
 *
 * Per RFC 4515 §3, the following characters MUST be escaped in filter
 * assertion values (this is search-filter escaping, NOT DN escaping —
 * the two character sets differ):
 *   \  → \5c   (MUST be substituted FIRST — later substitutions produce \, so
 *               processing \ first prevents those from being double-escaped)
 *   *  → \2a
 *   (  → \28
 *   )  → \29
 *   NUL → \00
 *
 * Audit finding reference: L-1 (Medium-LATENT) — LDAP filter injection.
 * LDAP is currently disabled (enabled: false) so this is a latent risk.
 */
export function escapeLdapFilterValue(v: string): string {
  return v
    .replace(/\\/g, '\\5c')   // MUST be first — subsequent substitutions produce \ in output
    .replace(/\*/g, '\\2a')
    .replace(/\(/g, '\\28')
    .replace(/\)/g, '\\29')
    .replace(/\0/g, '\\00');
}

export interface LdapConfig {
  enabled: boolean;
  serverUrl: string;
  bindDN: string;
  bindPassword: string;
  searchBase: string;
  searchFilter: string;
  usernameAttribute: string;
  emailAttribute: string;
  fullNameAttribute: string;
  departmentAttribute: string;
  groupAttribute: string;
  tlsRejectUnauthorized: boolean;
  connectionTimeout: number;
  roleMappings: Array<{ ldapGroup: string; role: string }>;
  defaultRole: string;
  defaultOrganizationId?: string;
  syncAttributes: boolean;
}

export interface LdapAuthResult {
  success: boolean;
  userDn: string;
  attributes: {
    fullName: string;
    email: string;
    department: string;
  };
  groups: string[];
}

const DEFAULT_CONFIG: LdapConfig = {
  enabled: false,
  serverUrl: '',
  bindDN: '',
  bindPassword: '',
  searchBase: '',
  searchFilter: '(sAMAccountName={{username}})',
  usernameAttribute: 'sAMAccountName',
  emailAttribute: 'mail',
  fullNameAttribute: 'displayName',
  departmentAttribute: 'department',
  groupAttribute: 'memberOf',
  tlsRejectUnauthorized: false,
  connectionTimeout: 5000,
  roleMappings: [],
  defaultRole: 'OPERATOR',
  defaultOrganizationId: '',
  syncAttributes: true,
};

export const ldapService = {
  async getConfig(): Promise<LdapConfig> {
    const config = await prisma.systemConfig.findFirst({ where: { configKey: 'ldap' } });
    if (!config?.configValue) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...(config.configValue as Record<string, unknown>) } as LdapConfig;
  },

  async saveConfig(config: Partial<LdapConfig>, updatedBy: string): Promise<void> {
    const existing = await this.getConfig();

    // If bindPassword is masked placeholder, keep existing
    const merged = { ...existing, ...config };
    if (config.bindPassword === '********') {
      merged.bindPassword = existing.bindPassword;
    }

    await prisma.systemConfig.upsert({
      where: { configKey: 'ldap' },
      update: { configValue: merged as any, updatedBy, updatedAt: new Date() },
      create: { configKey: 'ldap', configValue: merged as any, configType: 'security', requiresReauth: true, updatedBy },
    });
  },

  async testConnection(config?: Partial<LdapConfig>): Promise<{ success: boolean; message: string }> {
    const cfg = config ? { ...await this.getConfig(), ...config } : await this.getConfig();

    if (!cfg.serverUrl || !cfg.bindDN || !cfg.bindPassword) {
      return { success: false, message: 'Server URL, Bind DN, and Bind Password are required' };
    }

    const client = new Client({
      url: cfg.serverUrl,
      connectTimeout: cfg.connectionTimeout || 5000,
      tlsOptions: { rejectUnauthorized: cfg.tlsRejectUnauthorized ?? false },
    });

    try {
      await client.bind(cfg.bindDN, cfg.bindPassword);
      await client.unbind();
      return { success: true, message: 'Successfully connected and authenticated to LDAP server' };
    } catch (err: any) {
      return { success: false, message: `LDAP connection failed: ${err.message || err}` };
    }
  },

  async authenticateUser(username: string, password: string): Promise<LdapAuthResult | null> {
    const cfg = await this.getConfig();
    if (!cfg.enabled) return null;

    const client = new Client({
      url: cfg.serverUrl,
      connectTimeout: cfg.connectionTimeout || 5000,
      tlsOptions: { rejectUnauthorized: cfg.tlsRejectUnauthorized ?? false },
    });

    try {
      // Step 1: Bind as service account
      await client.bind(cfg.bindDN, cfg.bindPassword);

      // Step 2: Search for the user
      // Escape the user-supplied username before substitution to prevent LDAP
      // filter injection (RFC 4515 §3). An unescaped * or () could allow
      // user enumeration or wildcard-targeting even though auth bypass is not
      // possible (bind still requires the real password).
      const safeUsername = escapeLdapFilterValue(username);
      const filter = cfg.searchFilter.replace(/\{\{username\}\}/g, safeUsername);
      const { searchEntries } = await client.search(cfg.searchBase, {
        scope: 'sub',
        filter,
        attributes: [
          cfg.usernameAttribute,
          cfg.emailAttribute,
          cfg.fullNameAttribute,
          cfg.departmentAttribute,
          cfg.groupAttribute,
          'dn',
        ],
      });

      if (searchEntries.length === 0) {
        await client.unbind();
        return null;
      }

      const entry = searchEntries[0];
      const userDn = entry.dn;

      // Extract attributes
      const getAttribute = (attr: string): string => {
        const val = entry[attr];
        if (!val) return '';
        if (Array.isArray(val)) return String(val[0] || '');
        return String(val);
      };

      const fullName = getAttribute(cfg.fullNameAttribute);
      const email = getAttribute(cfg.emailAttribute);
      const department = getAttribute(cfg.departmentAttribute);

      // Extract groups
      const groupVal = entry[cfg.groupAttribute];
      const groups: string[] = [];
      if (groupVal) {
        if (Array.isArray(groupVal)) {
          groups.push(...groupVal.map(String));
        } else {
          groups.push(String(groupVal));
        }
      }

      await client.unbind();

      // Step 3: Verify user's password by binding as the user
      const userClient = new Client({
        url: cfg.serverUrl,
        connectTimeout: cfg.connectionTimeout || 5000,
        tlsOptions: { rejectUnauthorized: cfg.tlsRejectUnauthorized ?? false },
      });

      try {
        await userClient.bind(userDn, password);
        await userClient.unbind();
      } catch {
        return null; // Invalid password
      }

      return {
        success: true,
        userDn,
        attributes: { fullName, email, department },
        groups,
      };
    } catch (err: any) {
      console.error('[LDAP] Authentication error:', err.message);
      // Best-effort unbind. If the socket is already torn down by the
      // server (common on auth failures), unbind() rejects with "client
      // is not connected" — that's not an actionable error for the caller,
      // but log so a flood of unbind failures (a real server-side issue)
      // is still visible.
      try {
        await client.unbind();
      } catch (unbindErr: any) {
        console.warn('[LDAP] unbind after auth error failed:', unbindErr?.message ?? unbindErr);
      }
      return null;
    }
  },

  mapGroupsToRole(groups: string[], config: LdapConfig): string {
    if (!config.roleMappings || config.roleMappings.length === 0) {
      return config.defaultRole || 'OPERATOR';
    }

    // Check each mapping - first match wins (mappings should be ordered by priority)
    for (const mapping of config.roleMappings) {
      const ldapGroupLower = mapping.ldapGroup.toLowerCase();
      if (groups.some(g => g.toLowerCase() === ldapGroupLower || g.toLowerCase().includes(ldapGroupLower))) {
        return mapping.role;
      }
    }

    return config.defaultRole || 'OPERATOR';
  },

  async provisionUser(username: string, ldapResult: LdapAuthResult, config: LdapConfig) {
    const role = this.mapGroupsToRole(ldapResult.groups, config);

    const user = await prisma.user.create({
      data: {
        username,
        fullName: ldapResult.attributes.fullName || username,
        email: ldapResult.attributes.email || `${username}@ldap.local`,
        passwordHash: 'LDAP_EXTERNAL_AUTH',
        role,
        authSource: 'ldap',
        ldapDn: ldapResult.userDn,
        department: ldapResult.attributes.department || null,
        status: 'ENABLED',
        forcePasswordChange: false,
        isTemporaryPassword: false,
      },
    });

    return user;
  },

  async syncUserAttributes(userId: string, ldapResult: LdapAuthResult, config: LdapConfig) {
    if (!config.syncAttributes) return;

    const updates: Record<string, any> = {};
    if (ldapResult.attributes.fullName) updates.fullName = ldapResult.attributes.fullName;
    if (ldapResult.attributes.email) updates.email = ldapResult.attributes.email;
    if (ldapResult.attributes.department) updates.department = ldapResult.attributes.department;
    updates.ldapDn = ldapResult.userDn;

    // Update role if group mapping changed
    const newRole = this.mapGroupsToRole(ldapResult.groups, config);
    if (newRole) updates.role = newRole;

    if (Object.keys(updates).length > 0) {
      await prisma.user.update({ where: { id: userId }, data: updates });
      invalidateUserAuthCache(userId);
    }
  },
};
