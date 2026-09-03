import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const brandingDef: ModuleConfigDefinition = {
  moduleKey: 'branding',
  moduleName: 'Branding',
  description: 'Customize browser tab, logo, colors, company name & version',
  icon: 'palette',
  category: 'display',
  sortOrder: 11,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: false,
  hasCustomPage: true,
  customPagePath: '/config/branding',
  settings: [
    { key: 'appName', type: 'string', label: 'Application Name', group: 'App' },
    { key: 'appTagline', type: 'string', label: 'Tagline', group: 'App' },
    { key: 'browserTitle', type: 'string', label: 'Browser Tab Title', group: 'App' },
    { key: 'faviconUrl', type: 'string', label: 'Browser Tab Icon', group: 'App' },
    { key: 'companyName', type: 'string', label: 'Company Name', group: 'Company' },
    { key: 'version', type: 'string', label: 'Version', group: 'Company' },
    { key: 'primaryColor', type: 'color', label: 'Primary Color', group: 'Colors' },
    { key: 'secondaryColor', type: 'color', label: 'Secondary Color', group: 'Colors' },
  ],
};
