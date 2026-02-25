export const ACTION_COLORS: Record<string, string> = {
  // Authentication
  LOGIN_SUCCESS: 'bg-green-100 text-green-700 border-green-200',
  LOGIN: 'bg-green-100 text-green-700 border-green-200',
  LOGOUT: 'bg-slate-100 text-slate-700 border-slate-200',
  LOGIN_FAILED: 'bg-red-100 text-red-700 border-red-200',
  SESSION_TIMEOUT: 'bg-slate-100 text-slate-700 border-slate-200',
  FORCED_LOGOUT: 'bg-orange-100 text-orange-700 border-orange-200',

  // User Management
  USER_CREATED: 'bg-blue-100 text-blue-700 border-blue-200',
  USER_UPDATED: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  USER_DELETED: 'bg-red-100 text-red-700 border-red-200',
  BULK_USER_DELETED: 'bg-red-100 text-red-700 border-red-200',
  USER_ENABLED: 'bg-green-100 text-green-700 border-green-200',
  USER_DISABLED: 'bg-orange-100 text-orange-700 border-orange-200',
  ACCOUNT_LOCKED: 'bg-red-100 text-red-700 border-red-200',
  ACCOUNT_UNLOCKED: 'bg-green-100 text-green-700 border-green-200',
  PASSWORD_CHANGED: 'bg-amber-100 text-amber-700 border-amber-200',
  PASSWORD_RESET: 'bg-amber-100 text-amber-700 border-amber-200',
  PASSWORD_EXPIRED: 'bg-orange-100 text-orange-700 border-orange-200',
  PROFILE_UPDATED: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  ROLE_ASSIGNED: 'bg-violet-100 text-violet-700 border-violet-200',
  USER_ROLE_CHANGED: 'bg-violet-100 text-violet-700 border-violet-200',

  // Configuration
  CONFIG_CHANGED: 'bg-purple-100 text-purple-700 border-purple-200',

  // Role Management
  ROLE_CREATED: 'bg-violet-100 text-violet-700 border-violet-200',
  ROLE_UPDATED: 'bg-violet-100 text-violet-700 border-violet-200',
  ROLE_DELETED: 'bg-red-100 text-red-700 border-red-200',

  // Backup
  BACKUP_CREATED: 'bg-teal-100 text-teal-700 border-teal-200',
  BACKUP_RESTORED: 'bg-teal-100 text-teal-700 border-teal-200',

  // Data & Approvals
  DATA_VIEWED: 'bg-slate-100 text-slate-700 border-slate-200',
  DATA_EXPORTED: 'bg-slate-100 text-slate-700 border-slate-200',
  APPROVAL_REQUESTED: 'bg-amber-100 text-amber-700 border-amber-200',
  APPROVAL_GRANTED: 'bg-green-100 text-green-700 border-green-200',
  APPROVAL_REJECTED: 'bg-red-100 text-red-700 border-red-200',
  UNAUTHORIZED_ACTION_ATTEMPT: 'bg-red-100 text-red-700 border-red-200',

  // User Creation Requests
  USER_CREATION_REQUEST_SUBMITTED: 'bg-blue-100 text-blue-700 border-blue-200',
  USER_CREATION_REQUEST_APPROVED: 'bg-green-100 text-green-700 border-green-200',
  USER_CREATION_REQUEST_REJECTED: 'bg-red-100 text-red-700 border-red-200',

  // Entity Template Management
  ASSET_TEMPLATE_CREATED: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  ASSET_TEMPLATE_UPDATED: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  ASSET_TEMPLATE_DELETED: 'bg-red-100 text-red-700 border-red-200',
  ASSET_TEMPLATE_VERSION_CREATED: 'bg-indigo-100 text-indigo-700 border-indigo-200',

  // Entity Instance Management
  ASSET_CREATED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  ASSET_UPDATED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  ASSET_STATUS_CHANGED: 'bg-amber-100 text-amber-700 border-amber-200',
  ASSET_DELETED: 'bg-red-100 text-red-700 border-red-200',

  // Entity Relationships
  ASSET_RELATIONSHIP_CREATED: 'bg-sky-100 text-sky-700 border-sky-200',
  ASSET_RELATIONSHIP_DELETED: 'bg-red-100 text-red-700 border-red-200',

  // Entity Identifiers
  ASSET_IDENTIFIER_CREATED: 'bg-lime-100 text-lime-700 border-lime-200',
  ASSET_IDENTIFIER_DELETED: 'bg-red-100 text-red-700 border-red-200',
};

// Actions that represent failures
export const FAIL_ACTIONS = new Set([
  'LOGIN_FAILED',
  'UNAUTHORIZED_ACTION_ATTEMPT',
  'ACCOUNT_LOCKED',
]);

export function getAuditStatus(action: string): 'Success' | 'Fail' {
  return FAIL_ACTIONS.has(action) ? 'Fail' : 'Success';
}

export function getAuditSummary(record: any, templates: Record<string, string>): string {
  const actor = record.userId || 'System';
  const before = record.beforeValue || {};
  const after = record.afterValue || {};
  const targetType = record.targetType || '';

  const targetUser = after.username || before.username || record.targetId || '';
  const isSelf = targetUser === actor;
  const targetName = after.name || before.name || after.label || before.label || record.targetId || '';
  const configKey = record.targetId || targetType || '';
  const version = after.versionNumber || after.version || before.versionNumber || before.version || '';
  const sourceName = after.sourceName || before.sourceName || '';
  const beforeStatus = before.status || '';
  const afterStatus = after.status || '';
  const identifierType = after.identifierType || before.identifierType || '';
  const beforeRole = before.role || '';
  const afterRole = after.role || '';

  const replacePlaceholders = (tpl: string) =>
    tpl
      .replace(/\{actor\}/g, actor)
      .replace(/\{targetUser\}/g, targetUser || actor)
      .replace(/\{targetName\}/g, targetName)
      .replace(/\{configKey\}/g, configKey)
      .replace(/\{targetType\}/g, targetType || 'Data')
      .replace(/\{version\}/g, String(version))
      .replace(/\{sourceName\}/g, sourceName)
      .replace(/\{beforeStatus\}/g, beforeStatus)
      .replace(/\{afterStatus\}/g, afterStatus)
      .replace(/\{identifierType\}/g, identifierType)
      .replace(/\{beforeRole\}/g, beforeRole)
      .replace(/\{afterRole\}/g, afterRole);

  // Self-action handling: check for _SELF variant
  const selfActions = ['USER_UPDATED', 'PROFILE_UPDATED', 'PASSWORD_CHANGED'];
  if (isSelf && selfActions.includes(record.action)) {
    const selfKey = record.action + '_SELF';
    const selfTemplate = templates[selfKey];
    if (selfTemplate) {
      return replacePlaceholders(selfTemplate);
    }
  }

  const template = templates[record.action];
  if (template) {
    return replacePlaceholders(template);
  }

  // Fallback for unknown actions
  const label = record.action.replace(/_/g, ' ').toLowerCase();
  const name = targetName || targetUser;
  return name ? `${label} — "${name}" by ${actor}` : `${label} by ${actor}`;
}
