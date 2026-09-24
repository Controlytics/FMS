import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const sessionDef: ModuleConfigDefinition = {
  moduleKey: 'session',
  moduleName: 'Session Settings',
  description: 'Configure session duration and idle timeout',
  icon: 'clock',
  category: 'security',
  sortOrder: 2,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: null,
  requiresReauth: true,
  // 2026-09-24 coverage sweep: every config page is a gate-able action.
  reauthAction: 'UPDATE_SESSION_CONFIG',
  hasCustomPage: true,
  customPagePath: '/config/password-policy',
  settings: [
    // API-15: the JWT is clamped to JWT_EXPIRY_HOURS (env, default 1) at signing
    // time, so a value above that ceiling does NOT extend the login — the token
    // still expires at the cap. The label says so rather than letting the page
    // imply a 24h session it cannot deliver. See lib/jwt.ts signToken().
    { key: 'sessionDurationHours', type: 'number', label: 'Session Duration (hours) — capped by JWT_EXPIRY_HOURS (default 1h)', min: 1, max: 24, default: 8, group: 'Session' },
    { key: 'autoLogoutEnabled', type: 'boolean', label: 'Auto Logout', default: true, group: 'Idle' },
    // 15 min idle is the 21 CFR Part 11 industry default for shared workstations.
    // Allowed range capped at 60 min — anything longer would weaken the
    // unattended-session-attack guarantee that's audited during pharma
    // installations. Admins can lower per-deployment via /config/password-policy.
    { key: 'idleTimeoutMinutes', type: 'number', label: 'Idle Timeout (minutes)', min: 5, max: 60, default: 15, group: 'Idle' },
  ],
};
