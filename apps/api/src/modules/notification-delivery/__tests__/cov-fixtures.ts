/**
 * Shared fixtures for the notification / backup coverage suites (QA coverage
 * campaign, 2026-10-21). Lives under __tests__ so it is excluded from coverage
 * and never collected as a test file.
 *
 * Every helper here is written for a SHARED digilog_test_db that other agents
 * write to concurrently:
 *   - throwaway roles/users are created per file and deleted in afterAll;
 *   - `action-reauth` is edited with single-statement jsonb updates that add or
 *     remove ONLY this file's role from a key, never a snapshot write-back that
 *     would clobber a concurrent edit;
 *   - a system_config row this file changes is snapshotted and put back.
 */
import { prisma } from '../../../lib/prisma.js';
import { hashPassword } from '../../../lib/password.js';
import { invalidateReauthCache } from '../../../lib/reauth-check.js';

export const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Create (or reset) a throwaway role. Name must be <= 20 chars by campaign rule. */
export async function ensureRole(name: string, permissions: string[]): Promise<void> {
  if (name.length > 20) throw new Error(`role name too long for the campaign rule: ${name}`);
  await prisma.role.upsert({
    where: { name },
    update: { permissions, isActive: true },
    create: {
      name, displayName: `cov ${name}`, description: 'coverage test fixture',
      hierarchyLevel: 1, permissions, isSystem: false, createdBy: 'cov-test',
    },
  });
}

export async function ensureUser(opts: {
  username: string;
  password: string;
  role: string;
  email?: string | null;
  fullName?: string;
  status?: 'ENABLED' | 'DISABLED';
}) {
  const passwordHash = await hashPassword(opts.password);
  const data = {
    passwordHash,
    role: opts.role,
    status: opts.status ?? 'ENABLED',
    email: opts.email === undefined ? `${opts.username}@cov.test` : opts.email,
    fullName: opts.fullName ?? `Cov ${opts.username}`,
    forcePasswordChange: false,
    isTemporaryPassword: false,
    failedLoginAttempts: 0,
    lockedAt: null,
    lockoutUntil: null,
  };
  return prisma.user.upsert({
    where: { username: opts.username },
    update: data as any,
    create: { username: opts.username, createdBy: 'cov-test', ...data } as any,
  });
}

export async function deleteUsersAndRoles(usernames: string[], roles: string[]): Promise<void> {
  if (usernames.length) await prisma.user.deleteMany({ where: { username: { in: usernames } } });
  if (roles.length) await prisma.role.deleteMany({ where: { name: { in: roles } } });
}

/** Log in through the real route as a THROWAWAY user (never the shared `admin`). */
export async function login(app: any, username: string, password: string): Promise<string> {
  await prisma.session.updateMany({
    where: { user: { username }, isActive: true },
    data: { isActive: false, terminationReason: 'test_cleanup' },
  });
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  const body = JSON.parse(res.body);
  if (!body.token) throw new Error(`login failed for ${username}: ${res.statusCode} ${res.body}`);
  return body.token as string;
}

/**
 * Require re-auth for `actions` for `role` only. Atomic per key so a concurrent
 * agent editing other keys (or adding its own role to the same key) is kept.
 */
export async function addReauthRole(actions: string[], role: string): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { configKey: 'action-reauth' },
    update: {},
    create: { configKey: 'action-reauth', configValue: {}, configType: 'security', requiresReauth: false },
  });
  for (const action of actions) {
    await prisma.$executeRaw`
      UPDATE system_config
         SET config_value = jsonb_set(
               config_value, ARRAY[${action}]::text[],
               COALESCE(config_value -> ${action}, '[]'::jsonb) || to_jsonb(${role}::text))
       WHERE config_key = 'action-reauth'
         AND NOT COALESCE(config_value -> ${action}, '[]'::jsonb) @> to_jsonb(ARRAY[${role}::text])`;
  }
  invalidateReauthCache();
}

/** Inverse of addReauthRole: drops only `role`, and the key if it is left empty. */
export async function removeReauthRole(actions: string[], role: string): Promise<void> {
  for (const action of actions) {
    await prisma.$executeRaw`
      UPDATE system_config
         SET config_value = jsonb_set(
               config_value, ARRAY[${action}]::text[],
               COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(config_value -> ${action}) e
                          WHERE e <> to_jsonb(${role}::text)), '[]'::jsonb))
       WHERE config_key = 'action-reauth' AND config_value ? ${action}`;
    await prisma.$executeRaw`
      UPDATE system_config SET config_value = config_value - ${action}
       WHERE config_key = 'action-reauth' AND config_value -> ${action} = '[]'::jsonb`;
  }
  invalidateReauthCache();
}

export type ConfigSnapshot = { key: string; row: Awaited<ReturnType<typeof prisma.systemConfig.findUnique>> };

export async function snapshotConfig(key: string): Promise<ConfigSnapshot> {
  return { key, row: await prisma.systemConfig.findUnique({ where: { configKey: key } }) };
}

export async function restoreConfig(snap: ConfigSnapshot): Promise<void> {
  if (!snap.row) {
    await prisma.systemConfig.deleteMany({ where: { configKey: snap.key } });
    return;
  }
  await prisma.systemConfig.upsert({
    where: { configKey: snap.key },
    update: { configValue: snap.row.configValue as any, updatedBy: snap.row.updatedBy },
    create: {
      configKey: snap.key, configValue: snap.row.configValue as any,
      configType: snap.row.configType, requiresReauth: snap.row.requiresReauth, updatedBy: snap.row.updatedBy,
    },
  });
}

export async function setConfig(key: string, value: Record<string, unknown>): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { configKey: key },
    update: { configValue: value as any },
    create: { configKey: key, configValue: value as any, configType: 'notification', requiresReauth: false },
  });
}

/** Poll with REAL wall-clock time (setImmediate is never faked by these suites). */
export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setImmediate(r));
  }
}

/** audit_trail.chain_position is BIGSERIAL; JSON.stringify needs a replacer. */
export const serializeRow = (row: unknown) => JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
