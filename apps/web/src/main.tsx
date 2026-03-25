import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { swrConfig } from './lib/swr-config';
import { ErrorBoundary } from './components/error-boundary';
import { RequireRole } from './components/require-role';
import { AppLayout } from './components/layout/app-layout';
import { LoginPage } from './routes/auth/login';
import { ForgotPasswordPage } from './routes/auth/forgot-password';
import { ChangePasswordPage } from './routes/auth/change-password';
import { DashboardPage } from './routes/dashboard';
import { PERMISSIONS } from '@digilog/shared';
import { UserListPage } from './routes/users/list';
import { CreateUserPage } from './routes/users/create';
import { EditUserPage } from './routes/users/edit';
import { ResetRequestsPage } from './routes/users/reset-requests';
import { ConfigIndexPage } from './routes/config/index';
import { PasswordPolicyPage } from './routes/config/password-policy';
import { DatetimeConfigPage } from './routes/config/datetime';
import { BrandingConfigPage } from './routes/config/branding';
// removed: RolePrivilegesPage
import { RoleAccessPage } from './routes/config/role-access';
// removed: SidebarConfigPage
import { FieldIdsPage } from './routes/config/field-ids';
import { UserIdConfigPage } from './routes/config/user-id';
import { BackupRestorePage } from './routes/config/backup';
import { DynamicConfigPage } from './routes/config/dynamic-config';
import { ActionReauthPage } from './routes/config/action-reauth';
import { AuditTemplatesConfigPage } from './routes/config/audit-templates';
import { PaginationConfigPage } from './routes/config/pagination';
import { AlarmColumnsConfigPage } from './routes/config/alarm-columns';
import { AuditTrailPage } from './routes/audit/index';
import { NotificationsPage } from './routes/notifications/index';
import { ProfilePage } from './routes/profile/index';
import { ToastProvider } from './components/toast-provider';
import './app.css';

// Lazy-loaded heavy pages (code-split into separate chunks)
const AssetsPage = lazy(() => import('./routes/assets/index').then(m => ({ default: m.AssetsPage })));
const AssetTemplatesPage = lazy(() => import('./routes/assets/templates').then(m => ({ default: m.AssetTemplatesPage })));
const RuleChainsPage = lazy(() => import('./routes/rule-chains/index').then(m => ({ default: m.RuleChainsPage })));
const RuleChainEditorPage = lazy(() => import('./routes/rule-chains/editor').then(m => ({ default: m.RuleChainEditorPage })));
const AlarmDashboardPage = lazy(() => import('./routes/alarms/index').then(m => ({ default: m.AlarmDashboardPage })));
const UnsConfigPage = lazy(() => import('./routes/config/uns').then(m => ({ default: m.UnsConfigPage })));
const HelpArticlesPage = lazy(() => import('./routes/config/help').then(m => ({ default: m.HelpArticlesPage })));
const RetentionConfigPage = lazy(() => import('./routes/config/retention').then(m => ({ default: m.RetentionConfigPage })));
const LdapConfigPage = lazy(() => import("./routes/config/ldap").then(m => ({ default: m.default })));
const SystemHealthPage = lazy(() => import('./routes/system-health/index').then(m => ({ default: m.SystemHealthPage })));
const DebugTracesPage = lazy(() => import('./routes/debug/index').then(m => ({ default: m.DebugTracesPage })));
const ChecklistPage = lazy(() => import('./routes/checklist/index').then(m => ({ default: m.ChecklistPage })));
const EmailSettingsPage = lazy(() => import('./routes/config/notification-settings/email-settings').then(m => ({ default: m.EmailSettingsPage })));
const SmsSettingsPage = lazy(() => import('./routes/config/notification-settings/sms-settings').then(m => ({ default: m.SmsSettingsPage })));
const NotificationRulesPage = lazy(() => import('./routes/config/notification-rules/index').then(m => ({ default: m.NotificationRulesPage })));
const NotificationLogsPage = lazy(() => import('./routes/config/notification-settings/notification-logs').then(m => ({ default: m.NotificationLogsPage })));
const OrganizationsPage = lazy(() => import("./routes/tenant/organizations"));
const OrgDetailPage = lazy(() => import("./routes/tenant/org-detail"));

function LazyFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <svg className="w-6 h-6 animate-spin text-cyan-500" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <ToastProvider>
    <SWRConfig value={swrConfig}>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/change-password" element={<ChangePasswordPage />} />

          {/* Protected routes */}
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/profile" element={<ProfilePage />} />

            {/* User management — permission-based */}
            <Route path="/users" element={<RequireRole permissions={[PERMISSIONS.USER_READ]}><UserListPage /></RequireRole>} />
            <Route path="/users/create" element={<RequireRole permissions={[PERMISSIONS.USER_CREATE]}><CreateUserPage /></RequireRole>} />
            <Route path="/users/reset-requests" element={<RequireRole permissions={[PERMISSIONS.USER_RESET_PASSWORD]}><ResetRequestsPage /></RequireRole>} />
            <Route path="/users/:id" element={<RequireRole permissions={[PERMISSIONS.USER_READ]}><EditUserPage /></RequireRole>} />

            {/* Configuration — permission-based */}
            <Route path="/config" element={<RequireRole permissions={[PERMISSIONS.CONFIG_READ]}><ConfigIndexPage /></RequireRole>} />
            <Route path="/config/password-policy" element={<RequireRole permissions={[PERMISSIONS.CONFIG_READ]}><PasswordPolicyPage /></RequireRole>} />
            <Route path="/config/ldap" element={<RequireRole permissions={[PERMISSIONS.CONFIG_READ]}><Suspense fallback={<div>Loading...</div>}><LdapConfigPage /></Suspense></RequireRole>} />
            <Route path="/config/datetime" element={<RequireRole permissions={[PERMISSIONS.CONFIG_READ]}><DatetimeConfigPage /></RequireRole>} />
            <Route path="/config/backup" element={<RequireRole permissions={[PERMISSIONS.CONFIG_READ]}><BackupRestorePage /></RequireRole>} />

            {/* Super Admin Settings — SUPER_ADMIN role only */}
            <Route path="/config/branding" element={<RequireRole roles={['SUPER_ADMIN']}><BrandingConfigPage /></RequireRole>} />
            <Route path="/config/roles" element={<RequireRole roles={['SUPER_ADMIN']}><RoleAccessPage /></RequireRole>} />
            <Route path="/config/field-ids" element={<RequireRole roles={['SUPER_ADMIN']}><FieldIdsPage /></RequireRole>} />
            <Route path="/config/user-id" element={<RequireRole roles={['SUPER_ADMIN']}><UserIdConfigPage /></RequireRole>} />
            <Route path="/config/action-reauth" element={<RequireRole roles={['SUPER_ADMIN']}><ActionReauthPage /></RequireRole>} />
            <Route path="/config/audit-templates" element={<RequireRole roles={['SUPER_ADMIN']}><AuditTemplatesConfigPage /></RequireRole>} />
            <Route path="/config/pagination" element={<RequireRole roles={['SUPER_ADMIN']}><PaginationConfigPage /></RequireRole>} />
            <Route path="/config/alarm-columns" element={<RequireRole roles={['SUPER_ADMIN']}><AlarmColumnsConfigPage /></RequireRole>} />
            <Route path="/config/email-settings" element={<RequireRole roles={['SUPER_ADMIN']}><Suspense fallback={<LazyFallback />}><EmailSettingsPage /></Suspense></RequireRole>} />
            <Route path="/config/sms-settings" element={<RequireRole roles={['SUPER_ADMIN']}><Suspense fallback={<LazyFallback />}><SmsSettingsPage /></Suspense></RequireRole>} />
            <Route path="/config/notification-rules" element={<RequireRole roles={['SUPER_ADMIN']}><Suspense fallback={<LazyFallback />}><NotificationRulesPage /></Suspense></RequireRole>} />
                <Route path="/config/notification-logs" element={<RequireRole roles={['SUPER_ADMIN']}><Suspense fallback={<LazyFallback />}><NotificationLogsPage /></Suspense></RequireRole>} />
            <Route path="/config/dynamic/:moduleKey" element={<RequireRole permissions={[PERMISSIONS.CONFIG_READ]}><DynamicConfigPage /></RequireRole>} />

            {/* Multi-Tenant Management */}
            <Route path="/organizations" element={<RequireRole roles={["SUPER_ADMIN", "ADMIN"]}><Suspense fallback={<LazyFallback />}><OrganizationsPage /></Suspense></RequireRole>} />
            <Route path="/organizations/:id" element={<RequireRole roles={["SUPER_ADMIN", "ADMIN", "ORG_ADMIN"]}><Suspense fallback={<LazyFallback />}><OrgDetailPage /></Suspense></RequireRole>} />
            {/* Entity Management (lazy-loaded) — permission-based */}
            <Route path="/assets" element={<RequireRole permissions={[PERMISSIONS.ASSET_VIEW]}><Suspense fallback={<LazyFallback />}><AssetsPage /></Suspense></RequireRole>} />
            <Route path="/assets/templates" element={<RequireRole permissions={[PERMISSIONS.ASSET_VIEW]}><Suspense fallback={<LazyFallback />}><AssetTemplatesPage /></Suspense></RequireRole>} />

            {/* Rule Chains — Admin only (lazy-loaded) */}
            <Route path="/rule-chains" element={<RequireRole permissions={[PERMISSIONS.RULE_CHAIN_VIEW]}><Suspense fallback={<LazyFallback />}><RuleChainsPage /></Suspense></RequireRole>} />
            <Route path="/rule-chains/:id" element={<RequireRole permissions={[PERMISSIONS.RULE_CHAIN_UPDATE]}><Suspense fallback={<LazyFallback />}><RuleChainEditorPage /></Suspense></RequireRole>} />

            {/* Alarms (lazy-loaded) */}
            <Route path="/alarms" element={<Suspense fallback={<LazyFallback />}><AlarmDashboardPage /></Suspense>} />

            {/* System Health — Admin only (lazy-loaded) */}
            <Route path="/system-health" element={<RequireRole roles={['SUPER_ADMIN', 'ADMIN']}><Suspense fallback={<LazyFallback />}><SystemHealthPage /></Suspense></RequireRole>} />

            {/* Pipeline Debug Traces — Admin only (lazy-loaded) */}
            <Route path="/debug/traces" element={<RequireRole permissions={[PERMISSIONS.READ_DEBUG_TRACE]}><Suspense fallback={<LazyFallback />}><DebugTracesPage /></Suspense></RequireRole>} />

            {/* UNS Configuration (lazy-loaded) */}
            <Route path="/config/uns" element={<RequireRole permissions={[PERMISSIONS.UNS_VIEW]}><Suspense fallback={<LazyFallback />}><UnsConfigPage /></Suspense></RequireRole>} />

            {/* Help Article Manager (lazy-loaded) */}
            <Route path="/config/help" element={<RequireRole roles={['SUPER_ADMIN']}><Suspense fallback={<LazyFallback />}><HelpArticlesPage /></Suspense></RequireRole>} />

            {/* Retention Management (lazy-loaded) */}
            <Route path="/config/retention" element={<RequireRole roles={['SUPER_ADMIN']}><Suspense fallback={<LazyFallback />}><RetentionConfigPage /></Suspense></RequireRole>} />


            {/* Notifications */}
            <Route path="/notifications" element={<NotificationsPage />} />

            {/* Audit trail */}

            {/* Phase 2: Digital Filter Management System */}
            <Route path="/filter-cleaning-profiles" element={<Suspense fallback={<LazyFallback />}><CleaningProfileListPage /></Suspense>} />
            <Route path="/filter-cleaning-profiles/:id/edit" element={<Suspense fallback={<LazyFallback />}><CleaningProfileEditorPage2 /></Suspense>} />
            <Route path="/filter-profiles" element={<Suspense fallback={<LazyFallback />}><FilterProfileListPage /></Suspense>} />
            <Route path="/filters/:id/operate" element={<Suspense fallback={<LazyFallback />}><FilterOperationsPage /></Suspense>} />
            <Route path="/filters/:id/trace" element={<Suspense fallback={<LazyFallback />}><FilterTraceabilityPage /></Suspense>} />
            <Route path="/cleaning-cycles" element={<Suspense fallback={<LazyFallback />}><CleaningCycleHistoryPage /></Suspense>} />
            <Route path="/cleaning-cycles/:id" element={<Suspense fallback={<LazyFallback />}><CleaningCycleTimelinePage /></Suspense>} />
            <Route path="/config/filter-lifecycle" element={<RequireRole permissions={[PERMISSIONS.CONFIG_READ]}><Suspense fallback={<LazyFallback />}><LifecycleStateConfigPage /></Suspense></RequireRole>} />
            <Route path="/config/filter-cleaning-reasons" element={<RequireRole permissions={[PERMISSIONS.CONFIG_READ]}><Suspense fallback={<LazyFallback />}><CleaningReasonsConfigPage /></Suspense></RequireRole>} />
            <Route path="/pm-schedules" element={<Suspense fallback={<LazyFallback />}><PmScheduleListPage /></Suspense>} />
            <Route path="/pm-schedules/:entityId" element={<Suspense fallback={<LazyFallback />}><PmScheduleDetailPage /></Suspense>} />
            <Route path="/ahus/:id" element={<Suspense fallback={<LazyFallback />}><AhuDashboardPage /></Suspense>} />

            <Route path="/audit" element={<AuditTrailPage />} />

          </Route>

          {/* Standalone checklist form (no sidebar/header, auth handled by component) */}
          <Route path="/checklist/:entityId" element={<Suspense fallback={<LazyFallback />}><ChecklistPage /></Suspense>} />
        </Routes>
      </BrowserRouter>
    </SWRConfig>
    </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
