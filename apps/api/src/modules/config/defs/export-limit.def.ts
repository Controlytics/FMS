import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';
import { EXPORT_LIMIT_DEFAULT_MAX, EXPORT_LIMIT_DEFAULT_MESSAGE } from '@digilog/shared';

// Export size guardrail. Client-side PDF/Excel generation OOMs the browser past
// tens of thousands of rows, so every export button blocks first and shows the
// message below. `maxRecords` is admin-tunable with NO ceiling (operator
// decision 2026-09-04: no record caps anywhere).
export const exportLimitDef: ModuleConfigDefinition = {
  moduleKey: 'export-limit',
  moduleName: 'Export Limits',
  description: 'Maximum records allowed in a single report/export, and the message shown when that limit is exceeded.',
  icon: 'download',
  category: 'display',
  sortOrder: 13,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: true,
  // 2026-09-24 coverage sweep: every config page is a gate-able action.
  reauthAction: 'UPDATE_CONFIG_PAGE',
  hasCustomPage: false,
  settings: [
    {
      key: 'maxRecords',
      type: 'number',
      label: 'Maximum Export Records',
      description: 'Block any PDF/Excel export with more rows than this. No upper bound - set it as high as the site needs.',
      default: EXPORT_LIMIT_DEFAULT_MAX,
      min: 1,
      group: 'Export Limits',
    },
    {
      key: 'message',
      type: 'textarea',
      label: 'Message When Exceeded',
      description: 'Shown to the user when an export is blocked. Use {count} for the number of rows they tried to export and {max} for the current limit.',
      default: EXPORT_LIMIT_DEFAULT_MESSAGE,
      maxLength: 500,
      group: 'Export Limits',
    },
  ],
};
