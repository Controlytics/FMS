import { Client } from 'ldapts';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { invalidateUserAuthCache } from '../../plugins/auth.js';
import { getLogger } from '../../lib/logger.js';
import { isIP } from 'node:net';
import { checkOutboundHost } from '../../lib/ssrf.js';

/** Log type 6 — an external system we depend on; its failures are ops events. */
const ldapLog = getLogger('ldap', 'services');

/**
 * What test-connection tells the caller (SEC-08, security assessment 2026-10-22).
 *
 * The server URL is admin-typed and the server opens a socket to it, so it gets
 * the same resolved-destination check as every outbound HTTP call
 * (lib/ssrf.ts): loopback / link-local / unspecified refused, private LAN
 * allowed. And the raw error is no longer echoed: "read ECONNRESET" (port open),
 * "connect ECONNREFUSED" (closed) and "Connection timeout" (filtered) made
 * test-connection a port scanner. Every failure below the LDAP protocol now
 * answers with ONE sentence; the raw error goes to the services log, where the
 * operator diagnosing a real directory can read it. An LDAP result code is still
 * reported — it means the configured server was reached and spoke LDAP, which is
 * what the admin is testing.
 */
const LDAP_FAILED = 'LDAP connection failed: ';
/**
 * The same sentence was not enough: the TIME still told the port state. Measured
 * 2026-10-22 against this PC's own LAN address (allowed — it is private LAN):
 * an open non-LDAP port answered in 112 ms (reset), a closed one in 2024 ms
 * (Windows retries a refused SYN), a filtered one at the connect timeout. So a
 * failure below the LDAP protocol is answered no sooner than this, or than the
 * configured connect timeout when that is longer — the time a filtered port
 * takes anyway.
 */
export const LDAP_TEST_FAILURE_FLOOR_MS = 5000;
const MSG_BLOCKED = `${LDAP_FAILED}the server address is not allowed (loopback and link-local addresses are refused).`;
const MSG_UNREACHABLE = `${LDAP_FAILED}could not reach the LDAP server. Check the address and port, and that the server is reachable from this machine.`;
const MSG_NO_HOST = 'Server URL must include a host name or address';

/**
 * Where to actually connect. SEC-14 (DNS rebinding): the address that passed the
 * check is the one connected to — the URL's host is replaced by it, so a second
 * resolution inside ldapts cannot return a different (loopback) answer. A host
 * NAME is kept as the TLS servername, so an ldaps:// certificate is still
 * verified against the name the admin typed.
 */
type LdapDestination =
  | { ok: true; connectUrl: string; servername?: string }
  | { ok: false; message: string; reason: string };

/** Scheme + host of the LDAP server, checked before any socket is opened. */
async function checkLdapDestination(serverUrl: string): Promise<LdapDestination> {
  // Audit 2026-09-24 (F4): only ldap:// and ldaps:// — anything else is a
  // request to open a socket to an arbitrary host from the server.
  if (!/^ldaps?:\/\//i.test(serverUrl)) {
    return { ok: false, message: 'Server URL must start with ldap:// or ldaps://', reason: 'SCHEME' };
  }
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    return { ok: false, message: MSG_NO_HOST, reason: 'INVALID_URL' };
  }
  const hostname = url.hostname;
  if (!hostname) return { ok: false, message: MSG_NO_HOST, reason: 'NO_HOST' };
  const dest = await checkOutboundHost(hostname);
  if (dest.ok) {
    const { address, family } = dest.addresses[0];
    const bare = hostname.replace(/^\[(.*)\]$/, '$1');
    url.hostname = family === 6 ? `[${address}]` : address;
    // An IP literal is its own name; Node refuses an IP as servername.
    return { ok: true, connectUrl: url.toString(), ...(isIP(bare) ? {} : { servername: bare }) };
  }
  // A name that does not resolve answers like any other unreachable server, so
  // test-connection is not a DNS oracle for internal names either.
  return dest.error === 'Destination address not allowed'
    ? { ok: false, message: MSG_BLOCKED, reason: 'BLOCKED_DESTINATION' }
    : { ok: false, message: MSG_UNREACHABLE, reason: dest.error };
}

/**
 * Transport per scheme (2026-10-22). ldapts makes a Client TLS whenever ANY
 * `tlsOptions` value is defined (`secure = ldaps || hasTlsOptions`), and these
 * options were always passed — so every ldap:// URL opened with a TLS handshake
 * and a plain directory on 389 could never be reached (pre-existing; proven by
 * e2e/ldap-transport-mode.test.ts). Now:
 *   ldaps://                    TLS from the first byte
 *   ldap:// (startTls, default) plain connect, StartTLS, then bind — the
 *                               password never travels in clear, and a server
 *                               that refuses StartTLS is refused, not downgraded
 *   ldap:// + startTls: false   plain LDAP, the admin's explicit choice
 */
type LdapTransport = Pick<LdapConfig, 'connectionTimeout' | 'tlsRejectUnauthorized' | 'startTls'>;
type CheckedDestination = { connectUrl: string; servername?: string };

const isLdaps = (url: string) => /^ldaps:\/\//i.test(url);

function tlsOptionsFor(cfg: LdapTransport, dest: CheckedDestination) {
  return {
    rejectUnauthorized: cfg.tlsRejectUnauthorized ?? true,
    ...(dest.servername ? { servername: dest.servername } : {}),
  };
}

/** ldapts options for a checked destination — the pinned address, the typed name for TLS. */
function clientOptions(cfg: LdapTransport, dest: CheckedDestination) {
  return {
    url: dest.connectUrl,
    connectTimeout: cfg.connectionTimeout || 5000,
    // Only ldaps:// gets tlsOptions on the Client: on an ldap:// Client they
    // would turn the plain connect into a TLS one (see above).
    ...(isLdaps(dest.connectUrl) ? { tlsOptions: tlsOptionsFor(cfg, dest) } : {}),
  };
}

/**
 * Close a client's connection. ldapts' unbind destroys the socket in its own
 * `finally`, so even a failed unbind (server already gone) leaves nothing open;
 * the failure itself is logged, not thrown — it must not turn a finished bind
 * into an error.
 */
async function releaseClient(client: Client): Promise<void> {
  try {
    await client.unbind();
  } catch (err) {
    ldapLog.warn({ err }, 'LDAP unbind failed (socket destroyed anyway)');
  }
}

/** Bind on a client built by clientOptions, upgrading an ldap:// connection with StartTLS first unless switched off. */
async function secureBind(client: Client, cfg: LdapTransport, dest: CheckedDestination, dn: string, password: string): Promise<void> {
  if (!isLdaps(dest.connectUrl) && cfg.startTls !== false) {
    // A plain object: ldapts adds the plain socket to the options it is given.
    await client.startTLS({ ...tlsOptionsFor(cfg, dest), host: new URL(dest.connectUrl).hostname.replace(/^\[(.*)\]$/, '$1') });
  }
  await client.bind(dn, password);
}

/** The caller-facing sentence for a bind failure. Never the raw error text. */
function describeBindFailure(err: unknown): string {
  // ldapts ResultCodeError (InvalidCredentialsError, UnavailableError, …) carries
  // the numeric LDAP result code; socket / TLS / timeout errors do not.
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'number') {
    return code === 49
      ? `${LDAP_FAILED}the server rejected the bind credentials.`
      : `${LDAP_FAILED}the server answered with LDAP result code ${code}.`;
  }
  return MSG_UNREACHABLE;
}

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
  /** ldap:// only: upgrade with StartTLS before binding (default true). false = plain LDAP. */
  startTls: boolean;
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
  // Secure by default. This was `false`, which meant an ldaps:// bind accepted
  // ANY certificate — an on-path attacker could present a self-signed cert and
  // harvest the service-account bindPassword plus every user's password in
  // cleartext. Operators with an internal CA can still opt out explicitly.
  tlsRejectUnauthorized: true,
  // ldap:// is upgraded with StartTLS before any bind unless switched off.
  startTls: true,
  connectionTimeout: 5000,
  roleMappings: [],
  defaultRole: 'OPERATOR',
  defaultOrganizationId: '',
  syncAttributes: true,
};

/**
 * Does an LDAP group value (typically a full DN from `memberOf`, e.g.
 * "CN=Cleanroom Admins,OU=Groups,DC=corp,DC=local") match a configured mapping?
 *
 * Matches on the whole value or on an exact RDN component — so a mapping of
 * "Cleanroom Admins" still resolves a full DN, which is how operators actually
 * configure this. What it no longer does is substring-match: the previous
 * `.includes()` meant a mapping for "admin" also matched "CN=BackupAdmins",
 * silently handing the admin role to members of any group whose name merely
 * contained the word.
 *
 * `ldapGroupLower` must already be lower-cased by the caller.
 */
function matchesLdapGroup(group: string, ldapGroupLower: string): boolean {
  const g = group.toLowerCase().trim();
  if (g === ldapGroupLower) return true;
  // Compare each RDN's value: "cn=cleanroom admins" -> "cleanroom admins".
  return g.split(',').some((rdn) => {
    const eq = rdn.indexOf('=');
    const value = (eq === -1 ? rdn : rdn.slice(eq + 1)).trim();
    return value === ldapGroupLower;
  });
}

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
    const stored = await this.getConfig();
    const cfg = config ? { ...stored, ...config } : stored;

    if (!cfg.serverUrl || !cfg.bindDN || !cfg.bindPassword) {
      return { success: false, message: 'Server URL, Bind DN, and Bind Password are required' };
    }
    if (!/^ldaps?:\/\//i.test(cfg.serverUrl)) {
      return { success: false, message: 'Server URL must start with ldap:// or ldaps://' };
    }
    // F4 (cont.): the request body is merged OVER the saved config, and the
    // bind used the SAVED bind password — so a CONFIG_UPDATE holder could point
    // `serverUrl` at a host they control and receive the stored service-account
    // password (which GET /config masks) in a cleartext simple bind. Testing a
    // DIFFERENT server, or with the TLS check switched off, requires the caller
    // to supply the bind password themselves.
    const serverChanged = !!config?.serverUrl && config.serverUrl !== stored.serverUrl;
    // Switching StartTLS off would send the STORED password in clear: same rule.
    const tlsLoosened = (config?.tlsRejectUnauthorized === false && stored.tlsRejectUnauthorized !== false)
      || (config?.startTls === false && stored.startTls !== false);
    const usingStoredPassword = !config?.bindPassword || config.bindPassword === '********';
    if ((serverChanged || tlsLoosened) && usingStoredPassword) {
      return { success: false, message: 'Enter the Bind Password to test a different server URL or with TLS verification disabled.' };
    }

    // SEC-08: an "unreachable" answer waits out the floor (see
    // LDAP_TEST_FAILURE_FLOOR_MS), so open / closed / filtered take the same time.
    const started = Date.now();
    const padTo = Math.max(LDAP_TEST_FAILURE_FLOOR_MS, cfg.connectionTimeout || 5000);
    const answer = async (message: string) => {
      if (message === MSG_UNREACHABLE) {
        const wait = padTo - (Date.now() - started);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
      return { success: false, message };
    };

    // SEC-08: destination check BEFORE any socket (see checkLdapDestination).
    const dest = await checkLdapDestination(cfg.serverUrl);
    if (!dest.ok) {
      ldapLog.warn({ serverUrl: cfg.serverUrl, reason: dest.reason }, 'LDAP test-connection refused before connecting');
      return answer(dest.message);
    }

    const client = new Client(clientOptions(cfg, dest));

    let bound = false;
    let failure: unknown;
    try {
      await secureBind(client, cfg, dest, cfg.bindDN, cfg.bindPassword);
      bound = true;
    } catch (err) {
      failure = err;
    } finally {
      // Released on EVERY path, before the failure floor below is waited out —
      // a refused StartTLS or bind used to leave the socket open on the directory.
      await releaseClient(client);
    }
    if (bound) return { success: true, message: 'Successfully connected and authenticated to LDAP server' };
    // The raw error is for the operator's log, not the response (SEC-08).
    ldapLog.warn({ err: failure, serverUrl: cfg.serverUrl }, 'LDAP test-connection failed');
    return answer(describeBindFailure(failure));
  },

  async authenticateUser(username: string, password: string): Promise<LdapAuthResult | null> {
    const cfg = await this.getConfig();
    if (!cfg.enabled) return null;

    // SEC-08: the login bind connects to the same admin-typed address as
    // test-connection, so it gets the same check. Refused = no directory login.
    const dest = await checkLdapDestination(cfg.serverUrl);
    if (!dest.ok) {
      ldapLog.error({ serverUrl: cfg.serverUrl, reason: dest.reason }, 'LDAP login bind refused: server address not usable');
      return null;
    }

    const client = new Client(clientOptions(cfg, dest));

    try {
      // Step 1: Bind as service account
      await secureBind(client, cfg, dest, cfg.bindDN, cfg.bindPassword);

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
      const userClient = new Client(clientOptions(cfg, dest));

      let userBound = false;
      try {
        await secureBind(userClient, cfg, dest, userDn, password);
        userBound = true;
      } catch {
        // Invalid password (or a refused StartTLS) — the answer is null either way.
      } finally {
        // A wrong password used to leave this connection open on the directory.
        await releaseClient(userClient);
      }
      if (!userBound) return null;

      return {
        success: true,
        userDn,
        attributes: { fullName, email, department },
        groups,
      };
    } catch (err: any) {
      ldapLog.error({ err }, 'LDAP authentication error');
      // Best-effort unbind. If the socket is already torn down by the
      // server (common on auth failures), unbind() rejects with "client
      // is not connected" — that's not an actionable error for the caller,
      // but log so a flood of unbind failures (a real server-side issue)
      // is still visible.
      try {
        await client.unbind();
      } catch (unbindErr: any) {
        ldapLog.warn({ err: unbindErr }, 'LDAP unbind after auth error failed');
      }
      return null;
    }
  },

  matchesLdapGroup,

  mapGroupsToRole(groups: string[], config: LdapConfig): string {
    // F4 (cont.): `defaultRole` gets the same SUPER_ADMIN guard as the mappings.
    const fallbackRole = config.defaultRole && config.defaultRole !== 'SUPER_ADMIN' ? config.defaultRole : 'OPERATOR';
    if (!config.roleMappings || config.roleMappings.length === 0) {
      return fallbackRole;
    }

    // Check each mapping - first match wins (mappings should be ordered by priority)
    for (const mapping of config.roleMappings) {
      // An LDAP mapping must never confer SUPER_ADMIN. Such a user is unusable
      // anyway (auth.service.ts refuses the LDAP bind branch for SUPER_ADMIN and
      // the sentinel passwordHash then 401s), so this only stops the config from
      // provisioning a locked-out, over-privileged row.
      if (mapping.role === 'SUPER_ADMIN') continue;
      const ldapGroupLower = mapping.ldapGroup.toLowerCase();
      if (groups.some(g => matchesLdapGroup(g, ldapGroupLower))) {
        return mapping.role;
      }
    }

    return fallbackRole;
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

    // 21 CFR §11.10(e): auto-provisioning creates a user record with a
    // group-mapped role — with an ADMIN mapping, an unknown directory user
    // becomes an ADMIN. The local-admin path emits USER_CREATED; so must this.
    // Best-effort: the caller (auth.service.login) swallows provisioning errors,
    // so an audit failure must not fail an otherwise valid login. Logged loudly.
    try {
      await auditLog({
        userId: username, userRole: role,
        action: 'USER_CREATED', targetType: 'user', targetId: user.id,
        afterValue: {
          username, role, authSource: 'ldap', ldapDn: ldapResult.userDn,
          status: 'ENABLED', ldapGroups: ldapResult.groups,
        },
        reason: 'LDAP auto-provisioning on first successful directory login',
        signatureMeaning: `User "${username}" auto-provisioned from LDAP with role "${role}"`,
      });
    } catch (auditErr: any) {
      ldapLog.error({ err: auditErr, username }, 'Audit write FAILED for auto-provisioned LDAP user');
    }

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
      // Read the prior state so the audit row can show what actually changed —
      // a directory group change can silently escalate this user's role here.
      const before = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, fullName: true, email: true, department: true, role: true, ldapDn: true },
      });
      await prisma.user.update({ where: { id: userId }, data: updates });
      invalidateUserAuthCache(userId);

      // Only audit fields that actually changed — this runs on EVERY LDAP login,
      // and a row per login with no delta is noise that buries the real ones.
      const changed: Record<string, { from: unknown; to: unknown }> = {};
      for (const [key, value] of Object.entries(updates)) {
        const prior = (before as Record<string, any> | null)?.[key];
        if (prior !== value) changed[key] = { from: prior ?? null, to: value };
      }

      if (Object.keys(changed).length > 0) {
        const roleChanged = changed.role !== undefined;
        // Best-effort: auth.service wraps this call in a try/catch, so an audit
        // failure must not break login.
        try {
          await auditLog({
            userId: before?.username ?? userId, userRole: before?.role ?? undefined,
            action: 'USER_UPDATED', targetType: 'user', targetId: userId,
            beforeValue: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.from])),
            afterValue: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.to])),
            reason: 'LDAP attribute sync on login',
            signatureMeaning: roleChanged
              ? `User "${before?.username ?? userId}" role changed "${changed.role.from}" → "${changed.role.to}" by LDAP group mapping`
              : `User "${before?.username ?? userId}" attributes synced from LDAP`,
          });
        } catch (auditErr: any) {
          ldapLog.error({ err: auditErr, userId }, 'Audit write FAILED for LDAP attribute sync');
        }
      }
    }
  },
};
