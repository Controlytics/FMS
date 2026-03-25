import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const notificationTelegramDef: ModuleConfigDefinition = {
  moduleKey: 'notification-telegram',
  moduleName: 'Telegram Notifications',
  description: 'Configure Telegram Bot integration for notifications',
  icon: 'send',
  category: 'notifications',
  sortOrder: 33,
  requiresReauth: false,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  settings: [
    { key: 'enabled', type: 'boolean', label: 'Enable Telegram Notifications', default: false },
    { key: 'botToken', type: 'string', label: 'Bot Token', default: '' },
    { key: 'defaultChatId', type: 'string', label: 'Default Chat ID', default: '' },
  ],
};
