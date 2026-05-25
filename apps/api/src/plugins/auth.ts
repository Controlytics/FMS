import fp from 'fastify-plugin';
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { verifyToken, type JwtPayload } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import {
  verifyOfflineReplayToken,
  OfflineReplayTokenError,
  OFFLINE_REPLAY_TOKEN_HEADER,
  LEGACY_OFFLINE_REPLAY_HEADER,
} from '../lib/offline-replay-token.js';
import { isPasswordExpired } from '../lib/password-expiry.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: JwtPayload;
    /** True only after a verified offline-replay grant token has been
     * presented for the current request. Audit 2026-05-04 fix C1. */
    offlineReplayVerified?: boolean;
  }
}

// Session config cache (1-min TTL) to avoid DB read per request
let sessionConfigCache: { sessionDurationHours: number; cachedAt: number } | null = null;
const SESSION_CONFIG_CACHE_TTL = 60_000; // 1 minute

async function getSessionDurationHours(): Promise<number> {
  const now = Date.now();
  if (sessionConfigCache && (now - sessionConfigCache.cachedAt) < SESSION_CONFIG_CACHE_TTL) {
    return sessionConfigCache.sessionDurationHours;
  }
  const config = await prisma.systemConfig.findFirst({ where: { configKey: 'session' } });
  const hours = (config?.configValue as any)?.sessionDurationHours ?? 8;
  sessionConfigCache = { sessionDurationHours: hours, cachedAt: now };
  return hours;
}

// Password-policy cache (1-min TTL). Read on every authenticated request
// to derive password expiry from the LIVE policy + each user's
// passwordChangedAt + the policy's own updatedAt (grace floor).
// invalidatePasswordPolicyCache() is called from config.service.ts when
// the admin saves a new password policy so the new window applies
// immediately instead of after up to 60s of TTL lag.
type CachedPasswordPolicy = { passwordExpiryDays: number; policyUpdatedAt: Date | null };
let passwordPolicyCache: { policy: CachedPasswordPolicy; cachedAt: number } | null = null;
const PASSWORD_POLICY_CACHE_TTL = 60_000;

async function getPasswordPolicy(): Promise<CachedPasswordPolicy> {
  const now = Date.now();
  if (passwordPolicyCache && (now - passwordPolicyCache.cachedAt) < PASSWORD_POLICY_CACHE_TTL) {
    return passwordPolicyCache.policy;
  }
  const config = await prisma.systemConfig.findUnique({ where: { configKey: 'password-policy' } });
  const policy: CachedPasswordPolicy = {
    passwordExpiryDays: ((config?.configValue as { passwordExpiryDays?: number })?.passwordExpiryDays) ?? 90,
    policyUpdatedAt: config?.updatedAt ?? null,
  };
  passwordPolicyCache = { policy, cachedAt: now };
  return policy;
}

export function invalidatePasswordPolicyCache(): void {
  passwordPolicyCache = null;
}

/**
 * Audit §1.7 (2026-05-16). Caches the per-request user + session reads
 * so every authenticated request doesn't pay 2 DB round-trips before the
 * route logic runs. With Prisma's default pool size (`physical_cpus * 2 + 1`,
 * typically 9 on a 4-core dev box), 50 concurrent users at 1 req/s × 3-4
 * queries each saturated the pool with auth overhead alone.
 *
 * TTL = 30s. Trade-off: a user disabled / locked / role-changed via a
 * SUPER_ADMIN action has up to 30s of zombie access before the cache
 * expires. Matches the same posture as `sessionConfigCache` above.
 *
 * Invalidation: callers that mutate user.status / user.role / session
 * lifecycle should call `invalidateUserAuthCache(userId)` /
 * `invalidateSessionAuthCache(sessionId)` to take effect immediately.
 * (Wire-up across user.service.ts + auth.service.ts is a follow-up PR.)
 *
 * NOT INCLUDED in this PR: debouncing the session.update for lastActiveAt
 * + expiresAt (the row-lock-serialising write). That requires careful
 * coordination with the expiresAt enforcement check below — separate PR.
 */
type CachedSession = { id: string; createdAt: Date; expiresAt: Date; isActive: boolean };
type CachedUser = {
  role: string;
  username: string;
  status: string;
  forcePasswordChange: boolean;
  passwordChangedAt: Date | null;
  createdAt: Date;
  /** Legacy snapshot column — no longer used to gate expiry (isPasswordExpired
   * derives from passwordChangedAt + live policy). Retained for back-compat
   * with any caller that still reads from req-attached user. */
  passwordExpiresAt: Date | null;
};

const userAuthCache = new Map<string, { user: CachedUser; cachedAt: number }>();
const sessionAuthCache = new Map<string, { session: CachedSession; cachedAt: number }>();
const AUTH_CACHE_TTL_MS = 30_000;

async function getCachedSession(sessionId: string): Promise<CachedSession | null> {
  const cached = sessionAuthCache.get(sessionId);
  if (cached && Date.now() - cached.cachedAt < AUTH_CACHE_TTL_MS) return cached.session;
  const session = await prisma.session.findFirst({
    where: { id: sessionId, isActive: true },
    select: { id: true, createdAt: true, expiresAt: true, isActive: true },
  });
  if (session) sessionAuthCache.set(sessionId, { session, cachedAt: Date.now() });
  return session;
}

async function getCachedUser(userId: string): Promise<CachedUser | null> {
  const cached = userAuthCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < AUTH_CACHE_TTL_MS) return cached.user;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true, username: true, status: true, forcePasswordChange: true,
      passwordChangedAt: true, createdAt: true, passwordExpiresAt: true,
    },
  });
  if (!user) return user;
  // Do NOT cache users mid-password-change. Temp-password / expired-password
  // operators flip forcePasswordChange false the moment they submit a new
  // password; if we cache the stale `true`, dashboard SWR queries after the
  // redirect see 403 FORCE_PASSWORD_CHANGE for up to 30s and the FE
  // window.location-redirects back to /change-password (operator perceives
  // it as "page refreshed, new password didn't take"). They go through
  // change-password exactly once — paying one extra DB read per request
  // during that brief window is cheap; the cache is for steady-state users.
  if (user.forcePasswordChange) return user;
  userAuthCache.set(userId, { user, cachedAt: Date.now() });
  return user;
}

/** Evict a user from the auth cache. Call from user.service.ts mutation paths
 * (status change, role change, force-password-change toggle, delete). */
export function invalidateUserAuthCache(userId: string): void {
  userAuthCache.delete(userId);
}

/** Evict a session from the auth cache. Call from auth.service.ts logout +
 * force-logout + session-expiry + password-reset paths. */
export function invalidateSessionAuthCache(sessionId: string): void {
  sessionAuthCache.delete(sessionId);
}


const isProduction = process.env.NODE_ENV === 'production';
const PUBLIC_PATHS = [
  '/api/auth/login', '/api/auth/forgot-password', '/api/auth/beacon-logout',
  '/api/health',
  ...(isProduction ? [] : ['/docs', '/docs/']),  // Swagger only public in non-production
  '/api/internal/mqtt',  // EMQX auth callbacks (no JWT)
  '/api/ws',             // WebSocket (authenticates via message flow)
  '/api/notification-settings/email/oauth2/code', // OAuth2 callback (no JWT - redirect from Microsoft/Google)
  '/api/data/telemetry', // Device token auth (handled by route preHandler)
  '/api/data/attributes',// Device token auth (handled by route preHandler)
  '/api/data/binary',    // Device token auth (handled by route preHandler)
  '/api/data/event',     // Device token auth (handled by route preHandler)
];

// Paths that are public only for GET requests
const PUBLIC_GET_PATHS = ['/api/config/branding', '/api/config/datetime/current', '/uploads/photos/', '/uploads/branding/', '/api/roles/active', '/api/admin-requests/user-lookup'];

async function authPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // Fully public paths (all methods)
    if (PUBLIC_PATHS.some((p) => req.url.startsWith(p))) return;

    // Paths that are public only for GET requests
    if (req.method === 'GET' && PUBLIC_GET_PATHS.some((p) => req.url.startsWith(p))) return;

    // POST /api/admin-requests — public submit (but GET/other methods require auth)
    if (req.method === 'POST' && req.url === '/api/admin-requests') return;

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Missing token' });
    }

    try {
      const payload = await verifyToken(header.slice(7));
      req.user = payload;

      const session = await getCachedSession(payload.sessionId);

      if (!session) {
        return reply.code(401).send({ error: 'SESSION_INVALID', message: 'Session terminated' });
      }

      if (session.expiresAt < new Date()) {
        // Evict cache + persist invalidation in same step.
        invalidateSessionAuthCache(session.id);
        await prisma.session.update({
          where: { id: session.id },
          data: { isActive: false, terminationReason: 'expired' },
        });
        return reply.code(401).send({ error: 'SESSION_EXPIRED', message: 'Session expired' });
      }

      // Enforce absolute session timeout (max 24h regardless of activity)
      const MAX_ABSOLUTE_SESSION_MS = 24 * 60 * 60 * 1000;
      if (Date.now() - session.createdAt.getTime() > MAX_ABSOLUTE_SESSION_MS) {
        invalidateSessionAuthCache(session.id);
        await prisma.session.update({
          where: { id: session.id },
          data: { isActive: false, terminationReason: 'absolute_timeout' },
        });
        return reply.code(401).send({ error: 'SESSION_EXPIRED', message: 'Session exceeded maximum duration. Please log in again.' });
      }

      // Check user status and sync role from DB (cached)
      const user = await getCachedUser(payload.sub);
      if (!user || user.status !== 'ENABLED') {
        // If user was just disabled, evict so next request sees the change.
        invalidateUserAuthCache(payload.sub);
        return reply.code(401).send({ error: 'ACCOUNT_INACTIVE', message: 'Account is not active' });
      }

      // Patch req.user with authoritative DB values
      req.user = {
        ...req.user,
        role: user.role,
        username: user.username,
      };

      // Paths allowed when forcePasswordChange is true
      const PASSWORD_CHANGE_ALLOWED = [
        '/api/auth/change-password',
        '/api/auth/logout',
        '/api/auth/me',
        '/api/config/password-policy',
      ];

      // Check password expiry (server-side enforcement). Derived from
      // passwordChangedAt + the live policy + policy save time (which acts
      // as a grace-period floor — lowering the policy doesn't mass-lock
      // every account whose password is older than the new window). See
      // lib/password-expiry.ts.
      //
      // SUPER_ADMIN is exempt — same posture as the LOCKED / EXPIRED auto-
      // recovery in auth.service.login(). Weakens 21 CFR §11.10(g) for
      // privileged accounts; documented trade-off per user request 2026-05-25.
      let passwordExpired = false;
      if (user.role !== 'SUPER_ADMIN') {
        const policy = await getPasswordPolicy();
        passwordExpired = isPasswordExpired(
          user.passwordChangedAt,
          user.createdAt,
          policy.passwordExpiryDays,
          policy.policyUpdatedAt,
        );
      }

      if (passwordExpired && !user.forcePasswordChange) {
        await prisma.user.update({
          where: { id: payload.sub },
          data: { forcePasswordChange: true },
        });
        // Mutate the cached object in place so this request sees the new state,
        // and evict so the next request re-reads from DB.
        user.forcePasswordChange = true;
        invalidateUserAuthCache(payload.sub);
      }

      // Enforce forcePasswordChange server-side (§11.10(f))
      if (user.forcePasswordChange) {
        const isAllowed = PASSWORD_CHANGE_ALLOWED.some((p) => req.url.startsWith(p));
        if (!isAllowed) {
          const errorCode = passwordExpired ? 'PASSWORD_EXPIRED' : 'FORCE_PASSWORD_CHANGE';
          return reply.code(403).send({
            error: errorCode,
            message: errorCode === 'PASSWORD_EXPIRED'
              ? 'Your password has expired. Please change your password.'
              : 'You must change your password before continuing.',
          });
        }
      }

      // Update last active + extend session expiry (sliding window)
      const durationHours = await getSessionDurationHours();
      await prisma.session.update({
        where: { id: session.id },
        data: {
          lastActiveAt: new Date(),
          expiresAt: new Date(Date.now() + durationHours * 60 * 60 * 1000),
        },
      });

      // Audit 2026-05-04 fix C1: verify offline-replay grant token (if any).
      //
      // Tablets in offline-replay mode send `x-offline-replay-token: <jwt>`.
      // We verify it here in onRequest so the result is available to ALL
      // downstream code (buildContext, enforceReauth, route handlers, the
      // offlinePerformedAt validator) without making 146 buildContext sites
      // async. Rejecting bare `x-offline-replay: true` (the legacy boolean
      // header) here makes the upgrade fail loud, not silent.
      const replayToken = req.headers[OFFLINE_REPLAY_TOKEN_HEADER];
      if (replayToken) {
        try {
          await verifyOfflineReplayToken(
            Array.isArray(replayToken) ? replayToken[0] : replayToken,
            req.user.sub,
            req.user.sessionId,
          );
          req.offlineReplayVerified = true;
        } catch (err: any) {
          if (err instanceof OfflineReplayTokenError) {
            return reply.code(401).send({ error: err.code, message: err.message });
          }
          throw err;
        }
      } else if (req.headers[LEGACY_OFFLINE_REPLAY_HEADER] === 'true') {
        return reply.code(401).send({
          error: 'OFFLINE_REPLAY_HEADER_DEPRECATED',
          message: 'Bare `x-offline-replay: true` is no longer accepted. Obtain an offline-replay grant via POST /api/auth/offline-grant and send it as `x-offline-replay-token`.',
        });
      }
    } catch {
      return reply.code(401).send({ error: 'TOKEN_EXPIRED', message: 'Invalid or expired token' });
    }
  });
}

export default fp(authPlugin, { name: 'auth' });
