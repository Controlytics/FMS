export const REAUTH_ACTIONS = {
  // User Management
  CREATE_USER: { label: 'Create User', category: 'User Management' },
  UPDATE_USER: { label: 'Update User', category: 'User Management' },
  DELETE_USER: { label: 'Delete User', category: 'User Management' },
  BULK_DELETE_USERS: { label: 'Bulk Delete Users', category: 'User Management' },
  ENABLE_USER: { label: 'Enable User', category: 'User Management' },
  DISABLE_USER: { label: 'Disable User', category: 'User Management' },
  UNLOCK_USER: { label: 'Unlock User', category: 'User Management' },
  RESET_PASSWORD: { label: 'Reset Password', category: 'User Management' },
  PROCESS_RESET_REQUEST: { label: 'Process Reset Request', category: 'User Management' },
  UPDATE_PROFILE: { label: 'Update Own Profile', category: 'User Management' },
  // M1 (audit 2026-05-04): admin-request approve/reject was reusing CREATE_USER.
  // That conflated audit trails for password-reset / unlock / modify-user
  // approvals (none of which are user-creation). Distinct action keeps the
  // audit trail truthful: "submitter created the user" vs "approver executed
  // the request".
  APPROVE_ADMIN_REQUEST: { label: 'Approve / Reject Admin Request', category: 'User Management' },

  // Config Changes
  UPDATE_PASSWORD_POLICY: { label: 'Update Password Policy', category: 'Configuration' },
  UPDATE_LOGIN_SECURITY: { label: 'Update Login Security', category: 'Configuration' },
  UPDATE_SESSION_CONFIG: { label: 'Update Session Config', category: 'Configuration' },
  UPDATE_DATETIME_CONFIG: { label: 'Update Date/Time Config', category: 'Configuration' },
  UPDATE_USERID_CONFIG: { label: 'Update User ID Config', category: 'Configuration' },
  UPDATE_BRANDING: { label: 'Update Branding', category: 'Configuration' },
  UPDATE_ROLE_CONFIG: { label: 'Update Role Config', category: 'Configuration' },
  // 2026-09-03: four config writes that were gated on CONFIG_UPDATE alone and
  // took no signature at all. All four use enforceReauthAlways, so — like
  // ACKNOWLEDGE_PM_OVERDUE and the report/stage approvals — their row on the
  // Action Re-auth page is informational: the password is intrinsic to the
  // action, not an opt-in policy, and a newly-registered action is absent from
  // system_config['action-reauth'] anyway, so a configurable gate would gate
  // nobody.
  UPDATE_TABLET_ACCESS: { label: 'Update Tablet Access', category: 'Configuration' },
  UPDATE_AUDIT_TEMPLATES: { label: 'Update Audit Templates', category: 'Configuration' },
  UPDATE_REPORT_SIGNATORIES: { label: 'Update Report Signatories', category: 'Configuration' },
  UPDATE_FIELD_ID: { label: 'Update Field Label', category: 'Configuration' },
  // Audit 2026-06-08: PUT /api/config/users/:userId can grant per-user PERMISSION
  // overrides (privilege escalation) — dedicated reauth key + unambiguous audit.
  UPDATE_USER_CONFIG: { label: 'Update User Config', category: 'Configuration' },
  // (MANAGE_DEVICE_CREDENTIAL removed with data-ingestion removal — DeviceCredential model dropped.)
  // C6 (review 2026-05-04): the action-reauth save itself was a privilege
  // escalation — anyone with CONFIG_UPDATE could PUT /api/config/action-reauth
  // without challenge, including disabling reauth on DELETE_USER then deleting
  // users. Dedicated key (rather than reusing UPDATE_ROLE_CONFIG) keeps the
  // audit trail unambiguous: "operator changed who-needs-reauth-for-what".
  UPDATE_REAUTH_CONFIG: { label: 'Update Re-auth Config', category: 'Configuration' },
  // C3 (review 2026-05-04): notification-delivery routes called
  // enforceReauth('UPDATE_EMAIL_CONFIG'/'UPDATE_SMS_CONFIG') against actions
  // that did not exist in this map — isReauthRequired() would always return
  // false, silently disabling the gate. Added so the operator-facing reauth
  // policy page can require step-up auth on outbound-comms credential edits.
  UPDATE_EMAIL_CONFIG: { label: 'Update Email Config', category: 'Configuration' },
  UPDATE_SMS_CONFIG: { label: 'Update SMS Config', category: 'Configuration' },
  // Offline-cache settings are SUPER_ADMIN-only; require step-up auth on
  // changes because operators rely on the configured staleness + hard-cutoff
  // values for 21 CFR Part 11 read-only-lockout enforcement.
  UPDATE_OFFLINE_CACHE_CONFIG: { label: 'Update Offline Cache Config', category: 'Configuration' },

  // Role Management
  CREATE_ROLE: { label: 'Create Role', category: 'Role Management' },
  UPDATE_ROLE: { label: 'Update Role', category: 'Role Management' },
  DELETE_ROLE: { label: 'Delete Role', category: 'Role Management' },

  // Backup
  EXPORT_BACKUP: { label: 'Export Backup', category: 'Backup' },
  RESTORE_BACKUP: { label: 'Restore Backup', category: 'Backup' },

  // Asset Management
  CREATE_ASSET: { label: 'Create Asset', category: 'Asset Management' },
  UPDATE_ASSET: { label: 'Update Asset', category: 'Asset Management' },
  DELETE_ASSET: { label: 'Delete Asset', category: 'Asset Management' },
  // 2026-05-26 audit fix (PA-CLEANUP-4): CREATE_ASSET_RELATIONSHIP +
  // DELETE_ASSET_RELATIONSHIP removed — neither FE nor BE ever called
  // enforceReauth / reauth.execute with those names. Dead constants.
  CREATE_ASSET_IDENTIFIER: { label: 'Create Asset Identifier', category: 'Asset Management' },
  DELETE_ASSET_IDENTIFIER: { label: 'Delete Asset Identifier', category: 'Asset Management' },

  // Data Ingestion & Integration (Phase A)
  CREATE_CHECKLIST_PROFILE: { label: 'Create Checklist Profile', category: 'Checklist' },
  UPDATE_CHECKLIST_PROFILE: { label: 'Update Checklist Profile', category: 'Checklist' },
  DELETE_CHECKLIST_PROFILE: { label: 'Delete Checklist Profile', category: 'Checklist' },
  SUBMIT_CHECKLIST_WITH_SIGNATURE: { label: 'Submit Checklist with Signature', category: 'Checklist' },
  // (OVERRIDE_UNS_PATH / DELETE_UNS_MAPPING / UPDATE_UNS_CONFIG removed with data-ingestion removal.)
  CREATE_HELP_ARTICLE: { label: 'Create Help Article', category: 'Help' },
  UPDATE_HELP_ARTICLE: { label: 'Update Help Article', category: 'Help' },
  DELETE_HELP_ARTICLE: { label: 'Delete Help Article', category: 'Help' },
  // (UPDATE_RETENTION_POLICY / EXECUTE_RETENTION removed with data-ingestion removal.)
  // Audit deletion (audit 2026-05-04 fix #5 — web-routes review H4):
  // 21 CFR Part 11 § 11.10(e) requires audit-trail records be "secure".
  // Deletion is NOT allowed — it broke the hash chain at the deletion point.
  // REDACT replaces it: payload is NULLed but checksum + chain link preserved.
  // Distinct keys for single vs bulk so the surviving audit row records the
  // operator's intent. Delta-audit 2026-05-20 §C1 / May 16 §1.2 fix.
  REDACT_AUDIT_RECORD: { label: 'Redact Audit Record', category: 'Configuration' },
  BULK_REDACT_AUDIT_RECORDS: { label: 'Bulk Redact Audit Records', category: 'Configuration' },
  // 2026-07-01: physical hard-delete of audit rows (breaks the hash chain — see
  // modules/audit/routes.ts). Distinct keys from redact so the reauth policy can
  // differ, and the surviving meta-audit row records single vs bulk intent.
  DELETE_AUDIT_RECORD: { label: 'Delete Audit Record', category: 'Configuration' },
  BULK_DELETE_AUDIT_RECORDS: { label: 'Bulk Delete Audit Records', category: 'Configuration' },
  // 2026-08-27: in-place edit of an audit row (Config → Filter Data Management
  // → Audit Trail tab, and the Replacements tab whose records ARE audit rows).
  // Separate key from DELETE_AUDIT_RECORD so an operator can be allowed to
  // correct a row without being allowed to destroy one.
  UPDATE_AUDIT_RECORD: { label: 'Edit Audit Record', category: 'Configuration' },
  // 2026-05-26 audit fix (PA-REAUTH-4): notification bulk-delete is
  // destructive (irreversible, no recycle bin) and was missing reauth.
  // Single-delete uses the same key — same blast radius per row.
  DELETE_NOTIFICATION: { label: 'Delete Notification', category: 'Notifications' },
  BULK_DELETE_NOTIFICATIONS: { label: 'Bulk Delete Notifications', category: 'Notifications' },
  // 2026-05-26 audit fix (PA-REAUTH-3): super-admin filter-data
  // routes (super-admin/routes.ts) can edit/delete cleaning cycles,
  // filter events, notifications, admin-requests, etc. with no audit
  // trail. The audit-trail retrofit landed 2026-08-27 — every mutation now
  // also writes a MANUAL_RECORD_* row with a mandatory reason — but the reauth
  // step stays: it is the identity check, not the record.
  // Applies to every PUT/DELETE/POST in super-admin/routes.ts.
  SUPER_ADMIN_DATA_EDIT: { label: 'Super-Admin Data Edit', category: 'Super Admin' },
  // LDAP config (audit 2026-05-04 fix #5 — web-routes review H2):
  // bind credentials and base-DN edits can redirect every login to an
  // attacker-controlled directory. Distinct from UPDATE_LOGIN_SECURITY
  // so the audit trail makes the source-of-trust change explicit.
  UPDATE_LDAP_CONFIG: { label: 'Update LDAP Config', category: 'Configuration' },
  // (CREATE/UPDATE/DELETE_TEMPLATE_KIND removed 2026-07-04 — dead/theater: they
  //  rendered in the action-reauth config UI but no endpoint ever enforced them.
  //  Template kinds are seed-only; there is no runtime template-kind CRUD route.)
  // Audit 2026-05-04 fix #5 (web-routes review H — lower-blast config
  // surfaces). Distinct keys would force operators to maintain a check
  // matrix per page; this single umbrella reauth action covers the
  // remaining smaller-blast config writes (dashboard-cards visibility,
  // cleaning-profile-assignment rules, filter-cleaning-reasons
  // dropdown, ahu-filter-set-config mode toggle). The audit row's
  // targetType + targetId distinguishes the surface; the action is
  // shared so operators can opt in / out via one reauth-policy entry.
  UPDATE_CONFIG_PAGE: { label: 'Update Configuration Page', category: 'Configuration' },

  // Phase 2: Filter Management
  START_CLEANING_CYCLE: { label: 'Start Cleaning Cycle', category: 'Filter Management' },
  // Audit S-4 (2026-05-29): POST /:id/advance was the only cycle endpoint
  // without enforceReauth. Every sibling (start-cycle, submit-checklist,
  // bypass, retire, replace, terminate-cycle) requires step-up auth.
  // Advancing through a stage IS a 21 CFR §11 signature-of-intent event —
  // it is the highest-frequency operator action and must be operator-owned.
  ADVANCE_FILTER_STAGE: { label: 'Advance Filter to Next Stage', category: 'Filter Management' },
  BYPASS_FILTER_STAGE: { label: 'Bypass Filter Stage (Deviation)', category: 'Filter Management' },
  // Cleaning stage interlock — always-on signature (not config-toggleable). Listed
  // here for the audit/registry view only; enforced via enforceReauthAlways.
  APPROVE_CLEANING_STAGE: { label: 'Approve Cleaning Stage (Interlock)', category: 'Filter Management' },
  REJECT_CLEANING_STAGE: { label: 'Reject Cleaning Stage (Interlock)', category: 'Filter Management' },
  TERMINATE_CLEANING_CYCLE: { label: 'Terminate Cleaning Cycle', category: 'Filter Management' },
  CREATE_FILTER: { label: 'Create Filter', category: 'Filter Management' },
  EDIT_FILTER: { label: 'Edit Filter', category: 'Filter Management' },
  DELETE_FILTER: { label: 'Delete Filter', category: 'Filter Management' },
  RETIRE_FILTER: { label: 'Retire Filter', category: 'Filter Management' },
  // Filter creation workflow (2026-09-04). Approving a filter is what makes it
  // operable, so each decision is a §11 electronic signature.
  REVIEW_FILTER: { label: 'Review New Filter', category: 'Filter Management' },
  APPROVE_FILTER: { label: 'Approve New Filter', category: 'Filter Management' },
  REJECT_FILTER: { label: 'Reject New Filter', category: 'Filter Management' },
  REPLACE_FILTER: { label: 'Replace Filter', category: 'Filter Management' },
  BULK_UPLOAD_FILTERS: { label: 'Bulk Upload Filters', category: 'Filter Management' },
  REVIEW_REPLACEMENT_SCHEDULE: { label: 'Review Replacement Schedule', category: 'Filter Management' },
  APPROVE_REPLACEMENT_SCHEDULE: { label: 'Approve Replacement Schedule', category: 'Filter Management' },
  REJECT_REPLACEMENT_SCHEDULE: { label: 'Reject Replacement Schedule', category: 'Filter Management' },
  // M2 (audit 2026-05-04): manual filter lifecycle PATCH (INSTALLED / WASH_IN /
  // ... / IN_USE) was reusing the generic UPDATE_ASSET action, hiding cleanroom
  // lifecycle moves under the same audit key as ordinary asset edits. Dedicated
  // action makes inspector audits unambiguous.
  UPDATE_FILTER_LIFECYCLE: { label: 'Update Filter Lifecycle State', category: 'Filter Management' },
  EDIT_HIERARCHY_NODE: { label: 'Edit Hierarchy Node', category: 'Filter Management' },
  DELETE_HIERARCHY_NODE: { label: 'Delete Hierarchy Node', category: 'Filter Management' },
  CREATE_CLEANING_PROFILE: { label: 'Create Cleaning Profile', category: 'Cleaning Profiles' },
  UPDATE_CLEANING_PROFILE: { label: 'Update Cleaning Profile', category: 'Cleaning Profiles' },
  DELETE_CLEANING_PROFILE: { label: 'Delete Cleaning Profile', category: 'Cleaning Profiles' },
  CREATE_FILTER_PROFILE: { label: 'Create Filter Profile', category: 'Filter Profiles' },
  UPDATE_FILTER_PROFILE: { label: 'Update Filter Profile', category: 'Filter Profiles' },
  DELETE_FILTER_PROFILE: { label: 'Delete Filter Profile', category: 'Filter Profiles' },
  ASSIGN_FILTER_PROFILE: { label: 'Assign Filter Profile', category: 'Filter Profiles' },
  CREATE_PM_SCHEDULE: { label: 'Create PM Schedule', category: 'PM Schedules' },
  UPDATE_PM_SCHEDULE: { label: 'Update PM Schedule', category: 'PM Schedules' },
  DELETE_PM_SCHEDULE: { label: 'Delete PM Schedule', category: 'PM Schedules' },
  EDIT_PM_SCHEDULE: { label: 'Edit PM Entry', category: 'PM Schedules' },
  APPROVE_PM_SCHEDULE: { label: 'Approve PM Schedule', category: 'PM Schedules' },
  REJECT_PM_SCHEDULE: { label: 'Reject PM Schedule', category: 'PM Schedules' },
  REVIEW_PM_SCHEDULE: { label: 'Review PM Schedule', category: 'PM Schedules' },
  // Audit 2026-05-09 fix: bulk PM upload + execution-start + entry resubmit
  // were missing reauth gates. SUPER_ADMIN bulk uploads auto-approve every
  // row (pm-import.ts:133), so the upload was a high-trust mutation with no
  // password challenge. PM execution start creates an immutable PmExecution
  // row comparable to start-cycle (which IS reauth-gated). Resubmit flips
  // REJECTED → PENDING — minor but inconsistent with approve/reject.
  UPLOAD_PM_SCHEDULES: { label: 'Bulk Upload PM Schedules', category: 'PM Schedules' },
  START_PM_TASK: { label: 'Start PM Task', category: 'PM Schedules' },
  RESUBMIT_PM_ENTRY: { label: 'Resubmit PM Entry', category: 'PM Schedules' },
  ACKNOWLEDGE_PM_OVERDUE: { label: 'Acknowledge Overdue PM Task', category: 'PM Schedules' },
  CREATE_EQUIPMENT_GROUP: { label: 'Create Equipment Group', category: 'Equipment Groups' },
  UPDATE_EQUIPMENT_GROUP: { label: 'Update Equipment Group', category: 'Equipment Groups' },
  DELETE_EQUIPMENT_GROUP: { label: 'Delete Equipment Group', category: 'Equipment Groups' },

  // Block Change
  APPROVE_BLOCK_CHANGE: { label: 'Approve Block Change', category: 'Filter Management' },
  REJECT_BLOCK_CHANGE: { label: 'Reject Block Change', category: 'Filter Management' },

  // Reports
  // (CREATE/UPDATE/DELETE_REPORT_TEMPLATE, GENERATE_REPORT, SIGN_REPORT,
  // REJECT_REPORT, DELETE_REPORT removed 2026-07-04 with the orphaned reports
  // generate/sign module.) The active report-reviews workflow keeps these two:
  REVIEW_REPORT: { label: 'Review Report', category: 'Reports' },
  APPROVE_REPORT: { label: 'Approve Report', category: 'Reports' },
  SUBMIT_REPORT_REVIEW: { label: 'Submit Report for Review', category: 'Reports' },

  // ── 2026-09-24 coverage sweep (operator: "every operation must have a
  // re-auth selection; if selected, the password must be asked") ──────────
  //
  // Report downloads. PDF / Excel are produced client-side from data already
  // on the page, so the gate is the audit write every export makes first
  // (POST /api/audit/report-export-log) — see lib/report-export-log.ts on the
  // web. One row per report so the policy can differ by report (the Audit
  // Trail export is the one an inspector cares about). The two server-side
  // .xlsx routes (PM / Replacement schedule) enforce the same rows.
  EXPORT_AUDIT_TRAIL: { label: 'Export Audit Trail (PDF / Excel)', category: 'Reports' },
  EXPORT_CLEANING_CYCLE_DETAIL: { label: 'Export Cleaning Cycle Detail', category: 'Reports' },
  EXPORT_CLEANING_LIFECYCLE: { label: 'Export Cleaning Lifecycle Report', category: 'Reports' },
  EXPORT_CLEANING_RECORD: { label: 'Export Cleaning Record', category: 'Reports' },
  EXPORT_DEVIATIONS: { label: 'Export Deviations Report', category: 'Reports' },
  EXPORT_FILTERS: { label: 'Export Filters List', category: 'Reports' },
  EXPORT_PM_SCHEDULE: { label: 'Export PM Schedule', category: 'Reports' },
  EXPORT_QUALITY_NOTIFICATIONS: { label: 'Export Quality Notifications (QNN)', category: 'Reports' },
  EXPORT_RFID_TRACK_RECORD: { label: 'Export RFID Track Record', category: 'Reports' },
  EXPORT_REPLACEMENT_LIST: { label: 'Export Replacement List', category: 'Reports' },
  EXPORT_REPLACEMENT_SCHEDULE: { label: 'Export Replacement Schedule', category: 'Reports' },
  EXPORT_RETIREMENT_LIST: { label: 'Export Retirement List', category: 'Reports' },

  // Stage moves, one row per station. Enforced IN ADDITION to
  // START_CLEANING_CYCLE / ADVANCE_FILTER_STAGE on /advance,
  // /advance-with-checklist and /bulk-operate (per item, from targetState),
  // so an operator can require a signature on, say, Storage In only. Same
  // rows govern the web Filter Operations page and the tablet scan stations.
  STAGE_WASH_IN: { label: 'Move to Wash In (web + tablet station)', category: 'Filter Management' },
  STAGE_WASH_OUT: { label: 'Move to Wash Out (web + tablet station)', category: 'Filter Management' },
  STAGE_DRY_IN: { label: 'Move to Dry In (web + tablet station)', category: 'Filter Management' },
  STAGE_DRY_OUT: { label: 'Move to Dry Out (web + tablet station)', category: 'Filter Management' },
  STAGE_STORAGE_IN: { label: 'Move to Storage In (web + tablet station)', category: 'Filter Management' },
  STAGE_STORAGE_OUT: { label: 'Move to Storage Out (web + tablet station)', category: 'Filter Management' },

  // Operations that had no gate at all.
  REQUEST_BLOCK_CHANGE: { label: 'Request Block Change', category: 'Filter Management' },
  RESUBMIT_FILTER: { label: 'Resubmit Rejected Filter', category: 'Filter Management' },
  UPLOAD_REPLACEMENT_SCHEDULE: { label: 'Upload Replacement Schedule', category: 'Filter Management' },
  // (No row for POST /api/admin-requests: it is the PUBLIC "contact admin"
  // form on the login page — no session, so nothing to re-authenticate.)
  MANAGE_USER_GROUPS: { label: 'Create / Edit / Delete User Group', category: 'User Management' },
  MANAGE_NOTIFICATION_RULES: { label: 'Create / Edit / Delete Notification Rule', category: 'Notifications' },
  DELETE_NOTIFICATION_LOG: { label: 'Delete Notification Delivery Log', category: 'Notifications' },
  MANAGE_DEBUG_TRACES: { label: 'Change Debug Trace Settings', category: 'Configuration' },
  // Was enforced (enforceReauthAlways) but missing from this map, so its row
  // could not be shown. Informational, like the other always-on actions.
  TOGGLE_SUPER_ADMIN_API_ACCESS: { label: 'Toggle Super-Admin API Access', category: 'Super Admin' },
} as const;

export type ReauthAction = keyof typeof REAUTH_ACTIONS;

/**
 * Report name (as sent to POST /api/audit/report-export-log and rendered in
 * the REPORT_GENERATED audit row) → the re-auth row that gates its download.
 * Shared by the API gate and the web export helper so they cannot drift.
 */
export const REPORT_EXPORT_ACTIONS = {
  'Audit Trail': 'EXPORT_AUDIT_TRAIL',
  'Cleaning Cycle Detail': 'EXPORT_CLEANING_CYCLE_DETAIL',
  'Cleaning Lifecycle': 'EXPORT_CLEANING_LIFECYCLE',
  'Cleaning Record': 'EXPORT_CLEANING_RECORD',
  'Deviations': 'EXPORT_DEVIATIONS',
  'Filters': 'EXPORT_FILTERS',
  'PM Schedule': 'EXPORT_PM_SCHEDULE',
  'Quality Notifications': 'EXPORT_QUALITY_NOTIFICATIONS',
  'RFID Track Record': 'EXPORT_RFID_TRACK_RECORD',
  'Replacement List': 'EXPORT_REPLACEMENT_LIST',
  'Replacement Schedule': 'EXPORT_REPLACEMENT_SCHEDULE',
  'Retirement List': 'EXPORT_RETIREMENT_LIST',
} as const satisfies Record<string, ReauthAction>;

export type ReportExportName = keyof typeof REPORT_EXPORT_ACTIONS;

/** Lifecycle stage → its re-auth row. Null for a state that is not a station. */
export function stageReauthAction(targetState: string | null | undefined): ReauthAction | null {
  switch (targetState) {
    case 'WASH_IN': return 'STAGE_WASH_IN';
    case 'WASH_OUT': return 'STAGE_WASH_OUT';
    case 'DRY_IN': return 'STAGE_DRY_IN';
    case 'DRY_OUT': return 'STAGE_DRY_OUT';
    case 'STORAGE_IN': return 'STAGE_STORAGE_IN';
    case 'STORAGE_OUT': return 'STAGE_STORAGE_OUT';
    default: return null;
  }
}

export const REAUTH_ACTION_CATEGORIES = [
  'User Management',
  'Configuration',
  'Role Management',
  'Backup',
  'Asset Management',
  'Checklist',
  // ('UNS' + 'Retention' categories removed with data-ingestion removal.)
  'Help',
  'Filter Management',
  'Cleaning Profiles',
  'Filter Profiles',
  'PM Schedules',
  'Equipment Groups',
  'Reports',
  // Both editors (config/action-reauth.tsx and roles-components/reauth-tab.tsx)
  // build their lists by iterating THIS array, so an action whose category is
  // missing here renders nowhere and its policy can never be set. These two were
  // absent, hiding DELETE_NOTIFICATION, BULK_DELETE_NOTIFICATIONS and
  // SUPER_ADMIN_DATA_EDIT from both screens.
  'Notifications',
  'Super Admin',
] as const;

export type ReauthActionCategory = (typeof REAUTH_ACTION_CATEGORIES)[number];
