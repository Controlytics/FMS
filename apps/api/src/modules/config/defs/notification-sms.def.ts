import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const notificationSmsDef: ModuleConfigDefinition = {
  moduleKey: 'notification-sms',
  moduleName: 'SMS Settings',
  description: 'Configure SMS provider for notifications',
  icon: 'phone',
  category: 'notifications',
  sortOrder: 31,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: false,
  hasCustomPage: true,
  customPagePath: '/config/sms-settings',
  settings: [
    { key: 'provider', type: 'select', label: 'Provider', default: 'aws-sns', group: 'Provider',
      options: [{ value: 'aws-sns', label: 'AWS SNS' }, { value: 'twilio', label: 'Twilio' }] },
    { key: 'enabled', type: 'boolean', label: 'Enable SMS', default: false, group: 'General' },
  ],
};
