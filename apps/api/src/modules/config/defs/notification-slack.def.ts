import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const notificationSlackDef: ModuleConfigDefinition = {
  moduleKey: 'notification-slack',
  moduleName: 'Slack Notifications',
  description: 'Configure Slack Webhook integration for notifications',
  icon: 'message-square',
  category: 'notifications',
  sortOrder: 34,
  requiresReauth: false,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  settings: [
    { key: 'enabled', type: 'boolean', label: 'Enable Slack Notifications', default: false },
    { key: 'webhookUrl', type: 'string', label: 'Webhook URL', default: '' },
    { key: 'defaultChannel', type: 'string', label: 'Default Channel', default: '#alerts' },
  ],
};
