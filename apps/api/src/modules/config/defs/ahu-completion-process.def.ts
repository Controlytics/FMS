import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const ahuCompletionProcessDef: ModuleConfigDefinition = {
  moduleKey: 'ahu-completion-process',
  moduleName: 'AHU Cleaning Completion Process',
  description: 'Controls what happens when a filter is submitted at its final cleaning stage.',
  icon: 'shield-check',
  category: 'filter-management',
  sortOrder: 72,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: true,
  // 2026-09-24 coverage sweep: every config page is a gate-able action.
  reauthAction: 'UPDATE_CONFIG_PAGE',
  hasCustomPage: false,
  settings: [
    {
      key: 'mode', type: 'select', label: 'Completion Enforcement Mode',
      group: 'General', default: 'NONE',
      options: [
        { value: 'NONE', label: 'None — no check (default)' },
        { value: 'POPUP', label: 'Popup — warn but allow' },
        { value: 'INTERLOCK', label: 'Interlock — block until all AHU filters reach final stage' },
      ],
    },
  ],
};
