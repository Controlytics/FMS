import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from './prisma.js';
import { verifyPassword } from './password.js';
import type { ActionReauthConfig } from '@digilog/shared';

// In-memory cache with TTL to avoid DB hit on every mutation
let configCache: { data: ActionReauthConfig; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 10_000; // 10 seconds

export async function getActionReauthConfig(): Promise<ActionReauthConfig> {
  const now = Date.now();
  if (configCache && (now - configCache.fetchedAt) < CACHE_TTL_MS) {
    return configCache.data;
  }
  const row = await prisma.systemConfig.findUnique({ where: { configKey: 'action-reauth' } });
  const config = (row?.configValue as ActionReauthConfig) ?? {};
  configCache = { data: config, fetchedAt: now };
  return config;
}

export function invalidateReauthCache(): void {
  configCache = null;
}

/**
 * Check if re-auth is required for the given action and role.
 */
export async function isReauthRequired(action: string, role: string): Promise<boolean> {
  const config = await getActionReauthConfig();
  const roles = config[action];
  if (!roles || roles.length === 0) return false;
  return roles.includes(role);
}

/**
 * Enforce re-authentication on a request.
 * Checks the config for the current user's role + action.
 * Validates password from body._currentPassword or x-reauth-password header.
 * Returns { ok: true } if re-auth not needed or password is valid.
 * Returns { ok: false } and sends 401 if re-auth fails (reply already sent).
 */
export async function enforceReauth(
  action: string,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ ok: boolean }> {
  // Offline-replayed operations: the user was already authenticated when they
  // performed the action on the tablet. Skip reauth for these requests.
  if (req.headers['x-offline-replay'] === 'true') return { ok: true };

  const role = req.user.role;
  const needed = await isReauthRequired(action, role);
  if (!needed) return { ok: true };

  // Extract password from body field or custom header
  const body = req.body as Record<string, unknown> | undefined;
  const password = (body?._currentPassword as string)
    ?? (req.headers['x-reauth-password'] as string);

  if (!password) {
    reply.code(401).send({
      error: 'REAUTH_REQUIRED',
      message: 'This action requires password re-authentication.',
      action,
    });
    return { ok: false };
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user) {
    reply.code(401).send({ error: 'REAUTH_FAILED', message: 'User not found.' });
    return { ok: false };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    reply.code(401).send({ error: 'REAUTH_FAILED', message: 'Incorrect password. Please try again.' });
    return { ok: false };
  }

  // Strip password from body so it doesn't get stored or validated by Zod
  if (body?._currentPassword) {
    delete body._currentPassword;
  }

  // Mark request as already verified so hardcoded re-auth can skip
  (req as any)._reauthVerified = true;

  return { ok: true };
}
