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
    sidebarId: "rfid-track-record",
    label: "RFID Track Record",
    icon: "\u{1F4E1}",
    description: "RFID assign / remove lifecycle history",
    privilegeIds: ["assets.view", "filters.rfid_manage"],
  },
  {
    sidebarId: "filter-replacements",
    label: "Replacement List",
    icon: "\u{1F504}",
    description: "Filter replacement history + schedule (List | Schedule tabs)",
    privilegeIds: ["assets.view", "replacement_schedule.view", "replacement_schedule.upload", "replacement_schedule.review", "replacement_schedule.approve"],
  },
  // Replacement Schedule moved into the Replacement List page (List | Schedule
  // toggle) — no standalone sidebar entry.
  {
    sidebarId: "filter-operations",
    label: "Filter Operations",
    icon: "\u{1F527}",
    description: "Filter cleaning operations",
    privilegeIds: ["filters.operate", "filters.bypass", "filters.events", "checklists.submit"],
  },
  {
    sidebarId: "cleaning-cycles",
    label: "Filter Cleaning Record",
    icon: "\u{1F504}",
    description: "Cleaning cycle history and timeline",
    privilegeIds: ["cycles.view"],
  },
  {
    sidebarId: "filter-lifecycle-report",
    label: "Filter Lifecycle Report",
    icon: "\u{1F4CA}",
    description: "Per-filter cleaning lifecycle, cycle by cycle",
    privilegeIds: ["cycles.view"],
  },
  {
    sidebarId: "checklists",
    label: "Checklists",
    icon: "\u{1F4CB}",
    description: "Checklist profile management",
    privilegeIds: ["checklists.create", "checklists.edit", "checklists.delete", "checklists.toggle", "checklists.submit"],
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
    privilegeIds: ["equipment_groups.view", "equipment_groups.create", "equipment_groups.edit", "equipment_groups.delete"],
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
    sidebarId: "deviations",
    label: "Deviations",
    icon: "\u{26A0}",
    description: "Overdue PM cleaning deviations + audit trail",
    privilegeIds: ["pm.view", "pm.approve"],
  },
  // Report Templates + Generated Reports removed from the application (2026-06-08).
  {
    sidebarId: "version-history",
    label: "Version History",
    icon: "\u{1F570}️",
    description: "Audit history of versioned definitions (cleaning profiles, filter profiles, checklist profiles, equipment groups). SUPER_ADMIN by default; assignable to other roles.",
    privilegeIds: ["version_history.view"],
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
