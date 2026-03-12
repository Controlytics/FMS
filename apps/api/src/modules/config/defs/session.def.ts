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
  hasCustomPage: true,
  customPagePath: '/config/password-policy',
  settings: [
    { key: 'sessionDurationHours', type: 'number', label: 'Session Duration (hours)', min: 1, max: 24, default: 8, group: 'Session' },
    { key: 'autoLogoutEnabled', type: 'boolean', label: 'Auto Logout', default: true, group: 'Idle' },
    { key: 'idleTimeoutMinutes', type: 'number', label: 'Idle Timeout (minutes)', min: 5, max: 60, default: 15, group: 'Idle' },
  ],
};
