import { StrictMode } from 'react';
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
import { UserListPage } from './routes/users/list';
import { CreateUserPage } from './routes/users/create';
import { EditUserPage } from './routes/users/edit';
import { ResetRequestsPage } from './routes/users/reset-requests';
import { RequestAccountPage } from './routes/auth/request-account';
import { CreationRequestsPage } from './routes/users/creation-requests';
import { ConfigIndexPage } from './routes/config/index';
import { PasswordPolicyPage } from './routes/config/password-policy';
import { DatetimeConfigPage } from './routes/config/datetime';
import { BrandingConfigPage } from './routes/config/branding';
import { RolePrivilegesPage } from './routes/config/role-privileges';
import { RolesManagementPage } from './routes/config/roles';
import { SidebarConfigPage } from './routes/config/sidebar';
import { FieldIdsPage } from './routes/config/field-ids';
import { UserIdConfigPage } from './routes/config/user-id';
import { BackupRestorePage } from './routes/config/backup';
import { ActionReauthPage } from './routes/config/action-reauth';
import { AuditTemplatesConfigPage } from './routes/config/audit-templates';
import { PaginationConfigPage } from './routes/config/pagination';
import { AuditTrailPage } from './routes/audit/index';
import { NotificationsPage } from './routes/notifications/index';
import { ProfilePage } from './routes/profile/index';
import { AssetsPage } from './routes/assets/index';
import { AssetTemplatesPage } from './routes/assets/templates';
import { ToastProvider } from './components/toast-provider';
import './app.css';

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
          <Route path="/request-account" element={<RequestAccountPage />} />

          {/* Protected routes */}
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/profile" element={<ProfilePage />} />

            {/* User management — permission-based */}
            <Route path="/users" element={<RequireRole permissions={['USER_READ']}><UserListPage /></RequireRole>} />
            <Route path="/users/create" element={<RequireRole permissions={['USER_CREATE']}><CreateUserPage /></RequireRole>} />
            <Route path="/users/reset-requests" element={<RequireRole permissions={['USER_RESET_PASSWORD']}><ResetRequestsPage /></RequireRole>} />
            <Route path="/users/creation-requests" element={<RequireRole permissions={['USER_CREATE']}><CreationRequestsPage /></RequireRole>} />
            <Route path="/users/:id" element={<RequireRole permissions={['USER_READ']}><EditUserPage /></RequireRole>} />

            {/* Configuration — permission-based */}
            <Route path="/config" element={<RequireRole permissions={['CONFIG_READ']}><ConfigIndexPage /></RequireRole>} />
            <Route path="/config/password-policy" element={<RequireRole permissions={['CONFIG_READ']}><PasswordPolicyPage /></RequireRole>} />
            <Route path="/config/datetime" element={<RequireRole permissions={['CONFIG_READ']}><DatetimeConfigPage /></RequireRole>} />
            <Route path="/config/backup" element={<RequireRole permissions={['CONFIG_READ']}><BackupRestorePage /></RequireRole>} />

            {/* Super Admin Settings — SUPER_ADMIN role only */}
            <Route path="/config/branding" element={<RequireRole roles={['SUPER_ADMIN']}><BrandingConfigPage /></RequireRole>} />
            <Route path="/config/role-privileges" element={<RequireRole roles={['SUPER_ADMIN']}><RolePrivilegesPage /></RequireRole>} />
            <Route path="/config/roles" element={<RequireRole roles={['SUPER_ADMIN']}><RolesManagementPage /></RequireRole>} />
            <Route path="/config/sidebar" element={<RequireRole roles={['SUPER_ADMIN']}><SidebarConfigPage /></RequireRole>} />
            <Route path="/config/field-ids" element={<RequireRole roles={['SUPER_ADMIN']}><FieldIdsPage /></RequireRole>} />
            <Route path="/config/user-id" element={<RequireRole roles={['SUPER_ADMIN']}><UserIdConfigPage /></RequireRole>} />
            <Route path="/config/action-reauth" element={<RequireRole roles={['SUPER_ADMIN']}><ActionReauthPage /></RequireRole>} />
            <Route path="/config/audit-templates" element={<RequireRole roles={['SUPER_ADMIN']}><AuditTemplatesConfigPage /></RequireRole>} />
            <Route path="/config/pagination" element={<RequireRole roles={['SUPER_ADMIN']}><PaginationConfigPage /></RequireRole>} />

            {/* Entity Management */}
            <Route path="/assets" element={<AssetsPage />} />
            <Route path="/assets/templates" element={<AssetTemplatesPage />} />

            {/* Notifications */}
            <Route path="/notifications" element={<NotificationsPage />} />

            {/* Audit trail */}
            <Route path="/audit" element={<AuditTrailPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SWRConfig>
    </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
