import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const rfidScannerDef: ModuleConfigDefinition = {
  moduleKey: 'rfid-scanner',
  moduleName: 'RFID Scanner Settings',
  description: 'Configure RFID tag scanning behavior — debounce, deduplication, and identifier cache',
  icon: 'wifi',
  category: 'filter-management',
  sortOrder: 30,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'ADMIN',
  requiresReauth: false,
  hasCustomPage: false,
  customPagePath: null,
  settings: [
    {
      key: 'debounceMs',
      type: 'number',
      label: 'Scan Debounce (ms)',
      default: 300,
      group: 'Scanning',
    },
    {
      key: 'dedupeRepeatedTags',
      type: 'boolean',
      label: 'Deduplicate Repeated Tag Scans',
      default: true,
      group: 'Scanning',
    },
    {
      key: 'minTagLength',
      type: 'number',
      label: 'Minimum Tag Length (chars)',
      default: 3,
      group: 'Scanning',
    },
    {
      key: 'guardSpeedThresholdMs',
      type: 'number',
      label: 'RFID Guard Speed Threshold (ms)',
      default: 80,
      group: 'Input Guard',
    },
    {
      key: 'guardMinFastKeys',
      type: 'number',
      label: 'Min Fast Keys to Block',
      default: 3,
      group: 'Input Guard',
    },
    {
      key: 'identifierCacheHours',
      type: 'number',
      label: 'Identifier Cache TTL (hours)',
      default: 1,
      group: 'Offline Cache',
    },
  ],
};
