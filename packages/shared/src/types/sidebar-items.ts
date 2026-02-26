export interface SidebarItem {
  id: string;
  label: string;
  icon: string;
  description: string;
}

/**
 * All available sidebar navigation items.
 * Single source of truth — sidebar.tsx imports this instead of hardcoding.
 * To add a new sidebar item: add it here and it will automatically appear
 * in the Sidebar Configuration page for role/user visibility settings.
 */
export const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '\u{1F3E0}', description: 'Main dashboard view' },
  { id: 'users', label: 'Users', icon: '\u{1F465}', description: 'User management' },
  { id: 'assets', label: 'Entities', icon: '\u{1F3ED}', description: 'Entity management and explorer' },
  { id: 'asset-templates', label: 'Entity Templates', icon: '\u{1F4CB}', description: 'Entity template blueprints' },
  { id: 'configuration', label: 'Configuration', icon: '\u2699\uFE0F', description: 'System settings' },
  { id: 'notifications', label: 'Notifications', icon: '\u{1F514}', description: 'Notification center' },
  { id: 'audit', label: 'Audit Trail', icon: '\u{1F4DD}', description: 'Activity logs' },
  { id: 'system-health', label: 'System Health', icon: '\u{1F4CA}', description: 'Server and system metrics' },
  { id: 'rule-chains', label: 'Rule Chains', icon: '\u{1F517}', description: 'Data processing rule chains' },
  { id: 'alarms', label: 'Alarms', icon: '\u{1F6A8}', description: 'Alarm monitoring dashboard' },
  { id: 'debug-traces', label: 'Debug Traces', icon: '\u{1F50D}', description: 'Pipeline debug trace viewer' },
];
