import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { swrConfig } from './lib/swr-config';
import { AppLayout } from './components/layout/app-layout';
import { LoginPage } from './routes/auth/login';
import { ChangePasswordPage } from './routes/auth/change-password';
import { DashboardPage } from './routes/dashboard';
import { UserListPage } from './routes/users/list';
import { CreateUserPage } from './routes/users/create';
import { EditUserPage } from './routes/users/edit';
import { ConfigIndexPage } from './routes/config/index';
import { PasswordPolicyPage } from './routes/config/password-policy';
import { LoginSecurityPage } from './routes/config/login-security';
import { SessionConfigPage } from './routes/config/session';
import { DatetimeConfigPage } from './routes/config/datetime';
import { TemplateListPage } from './routes/assets/templates';
import { TemplateCreatePage } from './routes/assets/template-create';
import { TemplateDetailPage } from './routes/assets/template-detail';
import { HierarchyPage } from './routes/assets/hierarchy';
import { NodeCreatePage } from './routes/assets/node-create';
import { AuditTrailPage } from './routes/audit/index';
import './app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SWRConfig value={swrConfig}>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/change-password" element={<ChangePasswordPage />} />

          {/* Protected routes */}
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />

            {/* User management */}
            <Route path="/users" element={<UserListPage />} />
            <Route path="/users/create" element={<CreateUserPage />} />
            <Route path="/users/:id" element={<EditUserPage />} />

            {/* Configuration */}
            <Route path="/config" element={<ConfigIndexPage />} />
            <Route path="/config/password-policy" element={<PasswordPolicyPage />} />
            <Route path="/config/login-security" element={<LoginSecurityPage />} />
            <Route path="/config/session" element={<SessionConfigPage />} />
            <Route path="/config/datetime" element={<DatetimeConfigPage />} />

            {/* Asset management */}
            <Route path="/assets" element={<HierarchyPage />} />
            <Route path="/assets/templates" element={<TemplateListPage />} />
            <Route path="/assets/templates/create" element={<TemplateCreatePage />} />
            <Route path="/assets/templates/:id" element={<TemplateDetailPage />} />
            <Route path="/assets/node/create" element={<NodeCreatePage />} />

            {/* Audit trail */}
            <Route path="/audit" element={<AuditTrailPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SWRConfig>
  </StrictMode>,
);
