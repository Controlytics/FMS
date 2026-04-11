import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { swrConfig } from './lib/swr-config';
import { ErrorBoundary } from './components/error-boundary';
import { RouteErrorBoundary } from './components/route-error-boundary';
import { RequireRole } from './components/require-role';
import { AppLayout } from './components/layout/app-layout';
import { LoginPage } from './routes/auth/login';
import { ForgotPasswordPage } from './routes/auth/forgot-password';
import { ChangePasswordPage } from './routes/auth/change-password';
import { ContactAdminPage } from './routes/auth/contact-admin';
import { DashboardPage } from './routes/dashboard';
import { FilterOperationsPage } from "./routes/filter-management/filter-operations";
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
import DashboardCardsConfig from './routes/config/dashboard-cards';
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
const LdapConfigPage = lazy(() => import("./routes/config/ldap"));
const SystemHealthPage = lazy(() => import('./routes/system-health/index').then(m => ({ default: m.SystemHealthPage })));
const DebugTracesPage = lazy(() => import('./routes/debug/index').then(m => ({ default: m.DebugTracesPage })));
const ChecklistPage = lazy(() => import('./routes/checklist/index').then(m => ({ default: m.ChecklistPage })));
const EmailSettingsPage = lazy(() => import('./routes/config/notification-settings/email-settings').then(m => ({ default: m.EmailSettingsPage })));
const SmsSettingsPage = lazy(() => import('./routes/config/notification-settings/sms-settings').then(m => ({ default: m.SmsSettingsPage })));
const NotificationRulesPage = lazy(() => import('./routes/config/notification-rules/index').then(m => ({ default: m.NotificationRulesPage })));
const NotificationLogsPage = lazy(() => import('./routes/config/notification-settings/notification-logs').then(m => ({ default: m.NotificationLogsPage })));
const OrganizationsPage = lazy(() => import("./routes/tenant/organizations"));
const OrgDetailPage = lazy(() => import("./routes/tenant/org-detail"));

// Phase 2: Digital Filter Management System
const ChecklistProfileListPage = lazy(() => import("./routes/checklists/list").then(m => ({ default: m.ChecklistProfileListPage })));
const ChecklistProfileDetailPage = lazy(() => import("./routes/checklists/detail").then(m => ({ default: m.ChecklistProfileDetailPage })));
const CleaningProfileListPage = lazy(() => import("./routes/filter-management/cleaning-profile-list").then(m => ({ default: m.CleaningProfileListPage })));
// FilterProfileListPage removed — replaced by Config > Cleaning Profile Assignment

const CleaningCycleHistoryPage = lazy(() => import("./routes/cleaning-cycles/history").then(m => ({ default: m.CleaningCycleHistoryPage })));
const CleaningCycleTimelinePage = lazy(() => import("./routes/cleaning-cycles/timeline").then(m => ({ default: m.CleaningCycleTimelinePage })));
const LifecycleStateConfigPage = lazy(() => import("./routes/config/filter-lifecycle").then(m => ({ default: m.LifecycleStateConfigPage })));
const CleaningReasonsConfigPage = lazy(() => import("./routes/config/filter-cleaning-reasons").then(m => ({ default: m.CleaningReasonsConfigPage })));
const EquipmentGroupsConfigPage = lazy(() => import("./routes/config/equipment-groups").then(m => ({ default: m.EquipmentGroupsConfigPage })));
const CleaningProfileAssignmentPage = lazy(() => import('./routes/config/cleaning-profile-assignment').then(m => ({ default: m.CleaningProfileAssignmentPage })));
const PmScheduleListPage = lazy(() => import("./routes/pm-schedules/index").then(m => ({ default: m.PmScheduleListPage })));
const PmScheduleDetailPage = lazy(() => import("./routes/pm-schedules/detail").then(m => ({ default: m.PmScheduleDetailPage })));
const MyTasksPage = lazy(() => import("./routes/my-tasks/index").then(m => ({ default: m.MyTasksPage })));
const AhuDashboardPage = lazy(() => import("./routes/filter-management/ahu-dashboard").then(m => ({ default: m.AhuDashboardPage })));
const FilterTraceabilityPage = lazy(() => import("./routes/filter-management/filter-traceability").then(m => ({ default: m.FilterTraceabilityPage })));
const CleaningProfileEditorPage2 = lazy(() => import("./routes/filter-management/cleaning-profile-editor").then(m => ({ default: m.CleaningProfileEditorPage })));
const FilterListPage = lazy(() => import("./routes/filter-management/filter-list").then(m => ({ default: m.FilterListPage })));
const RetirementListPage = lazy(() => import("./routes/filter-management/retirement-list").then(m => ({ default: m.RetirementListPage })));
const AdminRequestsPage = lazy(() => import("./routes/admin-requests/index").then(m => ({ default: m.AdminRequestsPage })));
const ReplacementListPage = lazy(() => import("./routes/filter-management/replacement-list").then(m => ({ default: m.ReplacementListPage })));

const ApprovalsPage = lazy(() => import("./routes/approvals/index").then(m => ({ default: m.ApprovalsPage })));

// Mobile
const MobileOperationsPage = lazy(() => import("./routes/mobile/mobile-operations").then(m => ({ default: m.MobileOperationsPage })));
const MobileLoginPage = lazy(() => import("./routes/mobile/mobile-login").then(m => ({ default: m.MobileLoginPage })));

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

// Auto-redirect to mobile UI when running inside Capacitor APK
if ((window as any).Capacitor?.isNativePlatform?.() && !window.location.pathname.startsWith('/m')) {
  window.location.href = '/m/login';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <ToastProvider>
    <SWRConfig value={swrConfig}>
      <BrowserRouter>
        <Routes>
          {/* Mobile routes — standalone, no sidebar */}
          <Route path="/m/login" element={<Suspense fallback={<LazyFallback />}><MobileLoginPage /></Suspense>} />
          <Route path="/m" element={<Suspense fallback={<LazyFallback />}><MobileOperationsPage /></Suspense>} />

          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/contact-admin" element={<ContactAdminPage />} />

          {/* Protected routes */}
          <Route element={<RouteErrorBoundary><AppLayout /></RouteErrorBoundary>}>
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
            <Route path="/config/ldap" element={<RequireRole permissions={[PERMISSIONS.CONFIG_READ]}><Suspense fallback={<LazyFallback />}><LdapConfigPage /></Suspense></RequireRole>} />
            <Route path="/config/datetime" element={<RequireRole permissions={[PERMISSIONS.CONFIG_READ]}><DatetimeConfigPage /></RequireRole>} />
            <Route path="/config/backup" element={<RequireRole permissions={[PERMISSIONS.CONFIG_READ]}><BackupRestorePage /></RequireRole>} />

            {/* Super Admin Settings — SUPER_ADMIN role only */}
            <Route path="/config/branding" element={<RequireRole roles={['SUPER_ADMIN']}><BrandingConfigPage /></RequireRole>} />
            <Route path="/config/roles" element={<RequireRole permissions={[PERMISSIONS.ROLE_MANAGE]}><RoleAccessPage /></RequireRole>} />
            <Route path="/config/field-ids" element={<RequireRole permissions={[PERMISSIONS.FIELD_ID_UPDATE]}><FieldIdsPage /></RequireRole>} />
            <Route path="/config/user-id" element={<RequireRole roles={['SUPER_ADMIN']}><UserIdConfigPage /></RequireRole>} />
            <Route path="/config/action-reauth" element={<RequireRole roles={['SUPER_ADMIN']}><ActionReauthPage /></RequireRole>} />
            <Route path="/config/audit-templates" element={<RequireRole roles={['SUPER_ADMIN']}><AuditTemplatesConfigPage /></RequireRole>} />
            <Route path="/config/pagination" element={<RequireRole roles={['SUPER_ADMIN']}><PaginationConfigPage /></RequireRole>} />
            <Route path="/config/dashboard-cards" element={<RequireRole roles={['SUPER_ADMIN', 'ADMIN']}><DashboardCardsConfig /></RequireRole>} />
            <Route path="/config/alarm-columns" element={<RequireRole roles={['SUPER_ADMIN']}><AlarmColumnsConfigPage /></RequireRole>} />
            <Route path="/config/email-settings" element={<RequireRole roles={['SUPER_ADMIN']}><Suspense fallback={<LazyFallback />}><EmailSettingsPage /></Suspense></RequireRole>} />
            <Route path="/config/sms-settings" element={<RequireRole roles={['SUPER_ADMIN']}><Suspense fallback={<LazyFallback />}><SmsSettingsPage /></Suspense></RequireRole>} />
            <Route path="/config/notification-rules" element={<RequireRole roles={['SUPER_ADMIN']}><Suspense fallback={<LazyFallback />}><NotificationRulesPage /></Suspense></RequireRole>} />
                <Route path="/config/notification-logs" element={<RequireRole roles={['SUPER_ADMIN']}><Suspense fallback={<LazyFallback />}><NotificationLogsPage /></Suspense></RequireRole>} />
            <Route path="/config/dynamic/:moduleKey" element={<RequireRole permissions={[PERMISSIONS.CONFIG_READ]}><DynamicConfigPage /></RequireRole>} />

            {/* Multi-Tenant Management */}
            <Route path="/organizations" element={<RequireRole permissions={[PERMISSIONS.ORG_VIEW, PERMISSIONS.ORG_MANAGE]}><Suspense fallback={<LazyFallback />}><OrganizationsPage /></Suspense></RequireRole>} />
            <Route path="/organizations/:id" element={<RequireRole permissions={[PERMISSIONS.ORG_VIEW, PERMISSIONS.ORG_MANAGE]}><Suspense fallback={<LazyFallback />}><OrgDetailPage /></Suspense></RequireRole>} />
            {/* Entity Management (lazy-loaded) — permission-based */}
            <Route path="/assets" element={<RequireRole permissions={[PERMISSIONS.ASSET_VIEW]}><Suspense fallback={<LazyFallback />}><AssetsPage /></Suspense></RequireRole>} />
            <Route path="/assets/templates" element={<RequireRole permissions={[PERMISSIONS.ASSET_VIEW]}><Suspense fallback={<LazyFallback />}><AssetTemplatesPage /></Suspense></RequireRole>} />

            {/* Rule Chains — Admin only (lazy-loaded) */}
            <Route path="/rule-chains" element={<RequireRole permissions={[PERMISSIONS.RULE_CHAIN_VIEW]}><Suspense fallback={<LazyFallback />}><RuleChainsPage /></Suspense></RequireRole>} />
            <Route path="/rule-chains/:id" element={<RequireRole permissions={[PERMISSIONS.RULE_CHAIN_UPDATE]}><Suspense fallback={<LazyFallback />}><RuleChainEditorPage /></Suspense></RequireRole>} />

            {/* Alarms (lazy-loaded) */}
            <Route path="/alarms" element={<RequireRole permissions={[PERMISSIONS.ALARM_VIEW]}><Suspense fallback={<LazyFallback />}><AlarmDashboardPage /></Suspense></RequireRole>} />

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
            <Route path="/notifications" element={<RequireRole permissions={[PERMISSIONS.NOTIFICATION_VIEW, PERMISSIONS.NOTIFICATION_MANAGE]}><NotificationsPage /></RequireRole>} />

            {/* Audit trail */}

            {/* Phase 2: Digital Filter Management System */}
            <Route path="/filter-list" element={<RequireRole permissions={[PERMISSIONS.ASSET_READ, PERMISSIONS.ASSET_VIEW]}><Suspense fallback={<LazyFallback />}><FilterListPage /></Suspense></RequireRole>} />
            <Route path="/filter-retirements" element={<RequireRole permissions={[PERMISSIONS.ASSET_READ, PERMISSIONS.ASSET_VIEW]}><Suspense fallback={<LazyFallback />}><RetirementListPage /></Suspense></RequireRole>} />
            <Route path="/filter-replacements" element={<RequireRole permissions={[PERMISSIONS.ASSET_READ, PERMISSIONS.ASSET_VIEW]}><Suspense fallback={<LazyFallback />}><ReplacementListPage /></Suspense></RequireRole>} />
            <Route path="/filters" element={<RequireRole permissions={[PERMISSIONS.FILTER_OPERATE, PERMISSIONS.ASSET_READ]}><FilterOperationsPage /></RequireRole>} />
            <Route path="/filters/stage/:stageKey" element={<RequireRole permissions={[PERMISSIONS.FILTER_OPERATE, PERMISSIONS.ASSET_READ]}><FilterOperationsPage /></RequireRole>} />
            <Route path="/checklists" element={<RequireRole permissions={[PERMISSIONS.FCP_READ]}><Suspense fallback={<LazyFallback />}><ChecklistProfileListPage /></Suspense></RequireRole>} />
            <Route path="/checklists/:id" element={<RequireRole permissions={[PERMISSIONS.FCP_READ]}><Suspense fallback={<LazyFallback />}><ChecklistProfileDetailPage /></Suspense></RequireRole>} />
            <Route path="/filter-cleaning-profiles" element={<RequireRole permissions={[PERMISSIONS.FCP_READ]}><Suspense fallback={<LazyFallback />}><CleaningProfileListPage /></Suspense></RequireRole>} />
            <Route path="/filter-cleaning-profiles/:id/edit" element={<RequireRole permissions={[PERMISSIONS.FCP_UPDATE]}><Suspense fallback={<LazyFallback />}><CleaningProfileEditorPage2 /></Suspense></RequireRole>} />
            {/* Filter Profiles removed — replaced by Config > Cleaning Profile Assignment */}
            <Route path="/filters/:id/operate" element={<RequireRole permissions={[PERMISSIONS.FILTER_OPERATE, PERMISSIONS.ASSET_READ]}><FilterOperationsPage /></RequireRole>} />
            <Route path="/filters/:id/trace" element={<RequireRole permissions={[PERMISSIONS.EVENT_READ, PERMISSIONS.ASSET_READ]}><Suspense fallback={<LazyFallback />}><FilterTraceabilityPage /></Suspense></RequireRole>} />
            <Route path="/cleaning-cycles" element={<RequireRole permissions={[PERMISSIONS.CYCLE_READ]}><Suspense fallback={<LazyFallback />}><CleaningCycleHistoryPage /></Suspense></RequireRole>} />
            <Route path="/cleaning-cycles/:id" element={<RequireRole permissions={[PERMISSIONS.CYCLE_READ]}><Suspense fallback={<LazyFallback />}><CleaningCycleTimelinePage /></Suspense></RequireRole>} />
            <Route path="/config/filter-lifecycle" element={<RequireRole permissions={[PERMISSIONS.CONFIG_READ]}><Suspense fallback={<LazyFallback />}><LifecycleStateConfigPage /></Suspense></RequireRole>} />
            <Route path="/config/filter-cleaning-reasons" element={<RequireRole permissions={[PERMISSIONS.CONFIG_READ]}><Suspense fallback={<LazyFallback />}><CleaningReasonsConfigPage /></Suspense></RequireRole>} />
            <Route path="/config/equipment-groups" element={<RequireRole permissions={[PERMISSIONS.CONFIG_READ]}><Suspense fallback={<LazyFallback />}><EquipmentGroupsConfigPage /></Suspense></RequireRole>} />
            <Route path="/config/cleaning-profile-assignment" element={<RequireRole permissions={[PERMISSIONS.CONFIG_READ]}><Suspense fallback={<LazyFallback />}><CleaningProfileAssignmentPage /></Suspense></RequireRole>} />
            <Route path="/pm-schedules" element={<RequireRole permissions={[PERMISSIONS.PM_READ]}><Suspense fallback={<LazyFallback />}><PmScheduleListPage /></Suspense></RequireRole>} />
            <Route path="/pm-schedules/:entityId" element={<RequireRole permissions={[PERMISSIONS.PM_READ]}><Suspense fallback={<LazyFallback />}><PmScheduleDetailPage /></Suspense></RequireRole>} />
            <Route path="/my-tasks" element={<RequireRole permissions={[PERMISSIONS.PM_READ]}><Suspense fallback={<LazyFallback />}><MyTasksPage /></Suspense></RequireRole>} />
            <Route path="/ahus/:id" element={<RequireRole permissions={[PERMISSIONS.ASSET_VIEW]}><Suspense fallback={<LazyFallback />}><AhuDashboardPage /></Suspense></RequireRole>} />
            <Route path="/audit" element={<RequireRole permissions={[PERMISSIONS.AUDIT_READ]}><AuditTrailPage /></RequireRole>} />
            <Route path="/admin-requests" element={<RequireRole permissions={[PERMISSIONS.USER_CREATE]}><Suspense fallback={<LazyFallback />}><AdminRequestsPage /></Suspense></RequireRole>} />
            <Route path="/approvals" element={<Suspense fallback={<LazyFallback />}><ApprovalsPage /></Suspense>} />

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
