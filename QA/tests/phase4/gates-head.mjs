// Route gates that changed between the endpoint inventory (docs/production-readiness/03_API_ENDPOINT_INVENTORY.md,
// derived at 4ddd2cd, 2026-10-19) and the commit under test (723afdd, 2026-10-22).
// Found by `git diff -U0 4ddd2cd..723afdd -- apps/api/src/modules apps/api/src/plugins` filtered on
// requirePermission / requireAnyPermission / requireRole / requireSuperAdmin / addHook / AppError(403) /
// enforceReauth*, plus an OpenAPI diff (QA/results/phase4/openapi.json vs QA/results/phase4/2026-10-22/openapi.json).
// Lines are at 723afdd. (A first pass ran at ebb5244: QA/results/phase4/2026-10-22-ebb5244/.)
export const HEAD_SHA = '723afdd';

/** "METHOD /path" -> { gate (inventory syntax), src, commit } */
export const GATE_OVERRIDES = {
  'POST /api/checklist-profiles/': { gate: 'CHECKLIST_CREATE', src: 'checklist-profiles/routes.ts:39', commit: '70adf40' },
  'PUT /api/checklist-profiles/{id}': { gate: 'CHECKLIST_EDIT', src: 'checklist-profiles/routes.ts:49', commit: '70adf40' },
  'DELETE /api/checklist-profiles/{id}': { gate: 'CHECKLIST_DELETE', src: 'checklist-profiles/routes.ts:58', commit: '70adf40' },
  'POST /api/checklist-profiles/{id}/questions': { gate: 'CHECKLIST_CREATE', src: 'checklist-profiles/routes.ts:68', commit: '70adf40' },
  'PUT /api/checklist-profiles/{id}/questions/{questionId}': { gate: 'CHECKLIST_EDIT', src: 'checklist-profiles/routes.ts:78', commit: '70adf40' },
  'DELETE /api/checklist-profiles/{id}/questions/{questionId}': { gate: 'CHECKLIST_DELETE', src: 'checklist-profiles/routes.ts:87', commit: '70adf40' },
  'PUT /api/checklist-profiles/{id}/reorder': { gate: 'CHECKLIST_EDIT', src: 'checklist-profiles/routes.ts:96', commit: '70adf40' },
  'POST /api/filter-cleaning-profiles/': { gate: 'CP_PAGE_CREATE', src: 'cleaning-profiles/routes.ts:99', commit: '70adf40' },
  'PUT /api/filter-cleaning-profiles/{id}': { gate: 'CP_PAGE_EDIT', src: 'cleaning-profiles/routes.ts:160', commit: '70adf40' },
  'PATCH /api/filter-cleaning-profiles/{id}/toggle-status': { gate: 'CP_PAGE_EDIT', src: 'cleaning-profiles/routes.ts:227', commit: '70adf40' },
  'DELETE /api/filter-cleaning-profiles/{id}': { gate: 'CP_PAGE_DELETE', src: 'cleaning-profiles/routes.ts:252', commit: '70adf40' },
  'POST /api/pm-schedules/upload': { gate: 'PM_UPLOAD', src: 'pm-schedules/routes.ts:207', commit: '70adf40' },
  'POST /api/pm-schedules/entries/{id}/resubmit': { gate: 'PM_RESUBMIT', src: 'pm-schedules/routes.ts:479', commit: '70adf40' },
  'PUT /api/pm-schedules/entries/{id}/edit': { gate: 'PM_EDIT_ENTRY', src: 'pm-schedules/routes.ts:507', commit: '70adf40' },
  'GET /api/replacement-schedules/due': { gate: 'any: REPLACEMENT_SCHEDULE_VIEW, FILTER_OPERATE, FILTER_REPLACE', src: 'replacement-schedule/routes.ts:176', commit: '70adf40' },
  'GET /api/replacement-schedules/tasks': { gate: 'any: REPLACEMENT_SCHEDULE_VIEW, FILTER_OPERATE, FILTER_REPLACE', src: 'replacement-schedule/routes.ts:187', commit: '70adf40' },
  'GET /api/replacement-schedules/blocked-filters': { gate: 'any: REPLACEMENT_SCHEDULE_VIEW, FILTER_OPERATE, FILTER_REPLACE', src: 'replacement-schedule/routes.ts:198', commit: '70adf40' },
};

/** Operations in the HEAD OpenAPI spec but not in the inventory. */
export const ADDED_OPS = [
  { module: 'pm-schedules', method: 'POST', path: '/api/pm-schedules/visits', gate: 'PM_CREATE', reauth: 'CREATE_PM_SCHEDULE',
    audited: 'yes', cls: 'ADMIN-WRITE', line: '717', src: 'pm-schedules/routes.ts:717', commit: '5e7f488' },
];

/** Operations in the inventory that no longer exist at the commit under test. */
export const REMOVED_OPS = [
  { method: 'POST', path: '/api/notification-settings/send', commit: '4eeb864', why: 'SEC-03: arbitrary e-mail/SMS send removed (operator decision 2026-10-22)' },
];

/**
 * Re-auth actions every caller of which uses enforceReauthAlways at 723afdd (grep of the extract;
 * OD-01 part 1 = 1f8b8de, part 2 = 8372478). APPROVE_ADMIN_REQUEST is left out: it is always-on only
 * on one branch (admin-requests/routes.ts, `? enforceReauthAlways([...]) : enforceReauth(...)`).
 * Used ONLY to decide that a schema-valid body is safe to send (401 comes before any work).
 */
export const ALWAYS_REAUTH = new Set(['ACKNOWLEDGE_PM_OVERDUE', 'APPROVE_CLEANING_STAGE', 'APPROVE_REPORT', 'BULK_DELETE_AUDIT_RECORDS',
  'BULK_DELETE_USERS', 'BULK_REDACT_AUDIT_RECORDS', 'CREATE_ROLE', 'DELETE_ASSET', 'DELETE_AUDIT_RECORD', 'DELETE_FILTER',
  'DELETE_HIERARCHY_NODE', 'DELETE_ROLE', 'DELETE_USER', 'REDACT_AUDIT_RECORD', 'REJECT_CLEANING_STAGE', 'RESTORE_BACKUP',
  'REVIEW_REPORT', 'SUPER_ADMIN_DATA_EDIT', 'TOGGLE_SUPER_ADMIN_API_ACCESS', 'UPDATE_AUDIT_RECORD', 'UPDATE_AUDIT_TEMPLATES',
  'UPDATE_FIELD_ID', 'UPDATE_FILTER_LIFECYCLE', 'UPDATE_LDAP_CONFIG', 'UPDATE_REAUTH_CONFIG', 'UPDATE_REPORT_SIGNATORIES',
  'UPDATE_ROLE', 'UPDATE_ROLE_CONFIG', 'UPDATE_TABLET_ACCESS', 'UPDATE_USER', 'UPDATE_USER_CONFIG']);

/** Export gates of POST /api/audit/report-export-log at HEAD (audit/routes.ts:45-58, 70adf40 = P4-02 fix). */
export const REPORT_EXPORT_GATES = {
  'Audit Trail': ['AUDIT_EXPORT'],
  'Cleaning Cycle Detail': ['REPORT_EXPORT', 'REPORT_GENERATE'],
  'Cleaning Lifecycle': ['REPORT_EXPORT', 'REPORT_GENERATE'],
  'Cleaning Record': ['REPORT_EXPORT', 'REPORT_GENERATE'],
  'Deviations': ['PM_READ', 'PM_APPROVE'],
  'Filters': ['FILTER_LIST_EXPORT'],
  'PM Schedule': ['PM_READ', 'PM_CREATE', 'PM_UPDATE', 'PM_DELETE', 'PM_APPROVE', 'PM_EXECUTE'],
  'Quality Notifications': ['PM_READ'],
  'RFID Track Record': ['ASSET_VIEW', 'ASSET_READ', 'FILTER_RFID_MANAGE'],
  'Replacement List': ['REPLACEMENT_LIST_EXPORT'],
  'Replacement Schedule': ['REPLACEMENT_SCHEDULE_VIEW', 'REPLACEMENT_SCHEDULE_UPLOAD', 'REPLACEMENT_SCHEDULE_REVIEW', 'REPLACEMENT_SCHEDULE_APPROVE'],
  'Retirement List': ['RETIREMENT_LIST_EXPORT'],
};
