import type { FeaturePrivilege } from './feature-privileges.js';
import { FEATURE_PRIVILEGES } from './feature-privileges.js';

export interface SidebarSection {
  sidebarId: string;
  label: string;
  icon: string;
  description: string;
  privilegeIds: string[];
}

/**
 * Maps each sidebar item to its related feature privilege IDs.
 * Used by the unified Role Access Configuration page to show
 * sidebar toggle + feature permissions in one place.
 */
export const SIDEBAR_PRIVILEGE_MAP: SidebarSection[] = [
  {
    sidebarId: 'dashboard',
    label: 'Dashboard',
    icon: '\u{1F3E0}',
    description: 'Main dashboard view',
    privilegeIds: [],
  },
  {
    sidebarId: 'users',
    label: 'Users',
    icon: '\u{1F465}',
    description: 'User management',
    privilegeIds: [
      'users.view', 'users.create', 'users.edit', 'users.delete',
      'users.reset_password', 'users.unlock', 'users.enable_disable',
    ],
  },
  {
    sidebarId: 'assets',
    label: 'Entities',
    icon: '\u{1F3ED}',
    description: 'Entity management and explorer',
    privilegeIds: [
      'assets.view', 'assets.create', 'assets.edit', 'assets.delete',
      'assets.relationships', 'assets.identifiers',
    ],
  },
  {
    sidebarId: 'asset-templates',
    label: 'Entity Templates',
    icon: '\u{1F4CB}',
    description: 'Entity template blueprints',
    privilegeIds: ['assets.templates_view', 'assets.templates_create', 'assets.templates_edit', 'assets.templates_delete'],
  },
  {
    sidebarId: 'configuration',
    label: 'Configuration',
    icon: '\u2699\uFE0F',
    description: 'System settings',
    privilegeIds: ['config.view', 'config.edit'],
  },
  {
    sidebarId: 'notifications',
    label: 'Notifications',
    icon: '\u{1F514}',
    description: 'Notification center',
    privilegeIds: ['notifications.manage'],
  },
  {
    sidebarId: 'audit',
    label: 'Audit Trail',
    icon: '\u{1F4DD}',
    description: 'Activity logs',
    privilegeIds: ['audit.view', 'audit.export'],
  },
];

/** Look up FeaturePrivilege objects for a given sidebar section */
export function getPrivilegesForSection(sidebarId: string): FeaturePrivilege[] {
  const section = SIDEBAR_PRIVILEGE_MAP.find(s => s.sidebarId === sidebarId);
  if (!section) return [];
  return section.privilegeIds
    .map(id => FEATURE_PRIVILEGES.find(fp => fp.id === id))
    .filter((fp): fp is FeaturePrivilege => fp !== undefined);
}
