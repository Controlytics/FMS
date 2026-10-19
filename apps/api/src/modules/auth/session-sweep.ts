/**
 * Server-side session reaper (2026-06-03).
 *
 * Terminates active sessions that have expired (past `expiresAt`) or gone idle
 * beyond the configured idle timeout, and records a `LOGOUT` audit (reason
 * `session_timeout`) for each. This is what makes a tablet app-close /
 * window-close / crash / network-loss actually END the session AND appear in
 * the audit trail — the client process is gone in those cases and can never
 * call POST /logout, so the server is the only reliable place to record it.
 *
 * The idle sweep runs only when auto-logout is enabled and uses
 * `idleTimeoutMinutes + 2` so an OPEN app's client-side idle logout (which
 * records reason `idle_timeout`) always lands first — the server only catches
 * sessions the client couldn't terminate itself. `expiresAt` is the always-on
 * hard cap regardless of the idle setting.
 *
 * Triggered by the `session_sweep` in-process node-cron tick (every 5 min,
 * registered in app.ts). Returns
 * the number of sessions reaped (for the cron log + tests).
 */
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { authRepository } from './auth.repository.js';

export async function sweepExpiredSessions(): Promise<{ swept: number }> {
  const raw = (await authRepository.getSessionConfig()) as any;
  // Config may be flat or `{ value: {...} }` depending on how it was saved.
  const legacy = raw?.value && typeof raw.value === 'object' ? raw.value : (raw ?? {});
  // OQ-12 (QA 2026-10-19): the idle settings MOVED into the password policy
  // (packages/shared passwordPolicySchema "Session Settings (moved from
  // sessionConfigSchema)"). That is the row admins edit (Config → Password
  // Policy) and the one the web idle timer reads (app-layout.tsx). This sweep
  // still read the old `session` row, which has no editing page — so the server
  // logged users out on a different idle time than the one configured and shown.
  // Password policy wins; the old row is only a fallback for a value it lacks.
  const policy = ((await authRepository.getPasswordPolicyConfig()) ?? {}) as any;
  const cfg = {
    autoLogoutEnabled: policy.autoLogoutEnabled ?? legacy.autoLogoutEnabled,
    idleTimeoutMinutes: policy.idleTimeoutMinutes ?? legacy.idleTimeoutMinutes,
  };
  const now = new Date();

  const or: any[] = [{ expiresAt: { lt: now } }]; // hard expiry — always
  if (cfg.autoLogoutEnabled !== false) {
    const idleMin = Number.isFinite(Number(cfg.idleTimeoutMinutes)) ? Number(cfg.idleTimeoutMinutes) : 15;
    const cutoff = new Date(now.getTime() - (idleMin + 2) * 60_000);
    or.push({ lastActiveAt: { lt: cutoff } });
  }

  const stale = await prisma.session.findMany({
    where: { isActive: true, OR: or },
    include: { user: { select: { username: true, role: true } } },
  });

  let swept = 0;
  for (const s of stale) {
    await prisma.session.update({ where: { id: s.id }, data: { isActive: false, terminationReason: 'session_timeout' } });
    await auditLog({
      userId: s.user?.username ?? s.userId,
      userRole: s.user?.role ?? 'UNKNOWN',
      action: 'LOGOUT',
      targetType: 'session',
      targetId: s.id,
      afterValue: { username: s.user?.username, reason: 'session_timeout' },
      reason: 'Session ended by server (idle/expiry) — app closed, timed out, or connection lost',
      signatureMeaning: `Session for "${s.user?.username ?? s.userId}" terminated by server timeout`,
      ipAddress: s.ipAddress ?? '127.0.0.1',
      userAgent: s.userAgent ?? undefined,
      sessionId: s.id,
    });
    swept++;
  }
  return { swept };
}
