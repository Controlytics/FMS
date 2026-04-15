import type { FeaturePrivilege } from "./feature-privileges.js";
import { FEATURE_PRIVILEGES } from "./feature-privileges.js";

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
    sidebarId: "dashboard",
    label: "Dashboard",
    icon: "\u{1F3E0}",
    description: "Main dashboard view",
    privilegeIds: [],
  },
  {
    sidebarId: "users",
    label: "Users",
    icon: "\u{1F465}",
    description: "User management",
    privilegeIds: [
      "users.view", "users.create", "users.edit", "users.delete",
      "users.reset_password", "users.unlock", "users.enable_disable",
    ],
  },
  {
    sidebarId: "admin-requests",
    label: "Admin Requests",
    icon: "\u{1F4CB}",
    description: "Review and process user requests",
    privilegeIds: [
      "admin_requests.view",
    ],
  },
  {
    sidebarId: "assets",
    label: "Entities",
    icon: "\u{1F3ED}",
    description: "Entity management and explorer",
    privilegeIds: [
      "assets.view", "assets.create", "assets.edit", "assets.delete",
      "assets.relationships.create", "assets.relationships.delete",
      "assets.identifiers.create", "assets.identifiers.delete",
    ],
  },
  {
    sidebarId: "asset-templates",
    label: "Entity Templates",
    icon: "\u{1F4CB}",
    description: "Entity template blueprints",
    privilegeIds: ["assets.templates.create", "assets.templates.edit", "assets.templates.delete"],
  },
  {
    sidebarId: "configuration",
    label: "Configuration",
    icon: "\u2699\uFE0F",
    description: "System settings",
    privilegeIds: ["config.view", "config.edit"],
  },
  {
    sidebarId: "notifications",
    label: "Notifications",
    icon: "\u{1F514}",
    description: "Notification center",
    privilegeIds: ["notifications.view", "notifications.manage", "notifications.delete"],
  },
  {
    sidebarId: "audit",
    label: "Audit Trail",
    icon: "\u{1F4DD}",
    description: "Activity logs",
    privilegeIds: ["audit.view", "audit.export"],
  },
  {
    sidebarId: "rule-chains",
    label: "Rule Chains",
    icon: "\u{1F517}",
    description: "Rule chain automation",
    privilegeIds: ["rulechains.view", "rulechains.create", "rulechains.edit", "rulechains.delete"],
  },
  {
    sidebarId: "alarms",
    label: "Alarms",
    icon: "\u{1F6A8}",
    description: "Alarm management",
    privilegeIds: ["alarms.view", "alarms.acknowledge", "alarms.clear"],
  },
  {
    sidebarId: "system-health",
    label: "System Health",
    icon: "\u{1F4CA}",
    description: "System health monitoring",
    privilegeIds: [],
  },
  {
    sidebarId: "debug-traces",
    label: "Debug Traces",
    icon: "\u{1F41B}",
    description: "Pipeline debug traces",
    privilegeIds: ["debug.view", "debug.manage"],
  },
  {
    sidebarId: "filter-list",
    label: "Filters",
    icon: "\u{1F50D}",
    description: "Filter inventory by block",
    privilegeIds: ["assets.view", "filters.operate", "filters.events", "assets.identifiers.create", "assets.identifiers.delete", "filters.bulk_upload", "filters.retire", "filters.replace", "filters.status_update", "filters.hierarchy_create", "filters.rfid_manage"],
  },
  {
    sidebarId: "filter-retirements",
    label: "Retirement List",
    icon: "\u{1F6AB}",
    description: "Retired filter inventory",
    privilegeIds: ["assets.view"],
  },
  {
    sidebarId: "filter-replacements",
    label: "Replacement List",
    icon: "\u{1F504}",
    description: "Filter replacement history",
    privilegeIds: ["assets.view"],
  },
  {
    sidebarId: "filter-operations",
    label: "Filter Operations",
    icon: "\u{1F527}",
    description: "Filter cleaning operations",
    privilegeIds: ["filters.operate", "filters.bypass", "filters.events", "checklists.submit"],
  },
  {
    sidebarId: "cleaning-cycles",
    label: "Cleaning Cycles",
    icon: "\u{1F504}",
    description: "Cleaning cycle history and timeline",
    privilegeIds: ["cycles.view"],
  },
  {
    sidebarId: "checklists",
    label: "Checklists",
    icon: "\u{1F4CB}",
    description: "Checklist profile management",
    privilegeIds: ["cleaning_profiles.view", "cleaning_profiles.create", "cleaning_profiles.edit", "cleaning_profiles.delete"],
  },
  {
    sidebarId: "cleaning-profiles",
    label: "Cleaning Profiles",
    icon: "\u{1F9F9}",
    description: "Cleaning pipeline profile management",
    privilegeIds: ["cleaning_profiles.view", "cleaning_profiles.create", "cleaning_profiles.edit", "cleaning_profiles.delete"],
  },
  {
    sidebarId: "equipment-groups",
    label: "Equipment Groups",
    icon: "\u2699\uFE0F",
    description: "Equipment group configuration",
    privilegeIds: ["assets.view", "assets.create", "assets.edit", "assets.delete"],
  },
  {
    sidebarId: "organizations",
    label: "Organizations",
    icon: "\u{1F3E2}",
    description: "Organization management",
    privilegeIds: ["org.view", "org.manage"],
  },
  {
    sidebarId: "pm-schedules",
    label: "PM Schedules",
    icon: "\u{1F4C5}",
    description: "Preventive maintenance scheduling",
    privilegeIds: ["pm.view", "pm.create", "pm.edit", "pm.delete", "pm.approve"],
  },
  {
    sidebarId: "my-tasks",
    label: "My Tasks",
    icon: "\u{1F3AF}",
    description: "Filters due for cleaning based on PM schedules",
    privilegeIds: ["pm.view", "pm.execute"],
  },
  {
    sidebarId: "approvals",
    label: "Approvals",
    icon: "\u2705",
    description: "Block change approval requests",
    privilegeIds: ["block_change.request", "block_change.approve"],
  },
  {
    sidebarId: "report-templates",
    label: "Report Templates",
    icon: "\u{1F4C4}",
    description: "Report template management",
    privilegeIds: ["report_templates.view", "report_templates.create", "report_templates.edit", "report_templates.delete"],
  },
  {
    sidebarId: "reports",
    label: "Generated Reports",
    icon: "\u{1F4CA}",
    description: "View and manage generated reports",
    privilegeIds: ["reports.view", "reports.generate"],
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
