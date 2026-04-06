# Frontend Tester Agent — Skills & Context

## Identity
**Role:** Frontend UI testing specialist. Validates all 34+ routes, 16+ components, 9+ custom hooks, role-based rendering, form validation, API integration, and responsive behavior.
**Scope:** `apps/web/` — routes, components, hooks, lib.

---

## 1. Frontend Architecture

### 1.1 Tech Stack
- **React 19** with TypeScript
- **Vite** bundler (port 5175 dev)
- **Tailwind CSS** — unified light theme
- **React Router v6** (file-based routes)
- **SWR** for data fetching / caching
- **React Hook Form + Zod** for form management
- **ReactFlow** for rule chain visual editor + cleaning profile pipeline editor
- **Recharts** for dashboard charts

### 1.2 Application Structure
```
apps/web/src/
+-- routes/          34+ page components
|   +-- auth/        login, forgot-password, change-password
|   +-- users/       list, create, edit, reset-requests
|   +-- assets/      index (tree), templates, template-detail
|   +-- config/      23+ config pages
|   +-- audit/       audit trail
|   +-- alarms/      alarm dashboard
|   +-- rule-chains/ list, editor (ReactFlow)
|   +-- filter-management/  operations, profiles, editor, AHU, traceability, etc.
|   +-- cleaning-cycles/    history, timeline
|   +-- checklists/  list, detail
|   +-- pm-schedules/ PM management
|   +-- ...          notifications, checklist, debug, profile, system-health, mobile
+-- components/      16+ UI components
+-- hooks/           9+ custom hooks
+-- lib/             API client, auth, utils
```

---

## 2. Pages to Test (34+ Routes)

### Phase 1 Pages
- Authentication (login, forgot-password, change-password)
- User management (list, create, edit, reset-requests)
- Entity management (explorer with tree, templates, template-detail)
- Data & monitoring (audit, alarms, notifications, rule-chains, system-health, debug)
- Configuration (23+ config pages)

### Phase 2 Pages
- Filter operations (main operations, scan, status)
- Cleaning profiles (list, visual pipeline editor)
- Filter profiles, AHU dashboard, traceability
- Retirement, replacement, bulk upload, equipment groups
- Cleaning cycles (history, timeline)
- Checklists (list, detail)
- PM schedules

---

## 3. Testing Categories

### 3.1 Role-Based Rendering
Test with all 6 default roles + custom roles. Verify sidebar items, CRUD buttons, config access.
All routes use `<RequireRole permissions={[PERMISSIONS.*]}>`.

### 3.2 Form Validation
- Required field indicators
- Inline validation messages
- Submit button disabled until valid
- Server-side error display
- Password strength indicator

### 3.3 Phase 2 Specific Testing
- Pipeline editor: drag nodes, connect ports, save validation (7 checks)
- Filter operations: stage advancement, checklist dialog (no skip, no backdrop dismiss)
- Cleaning cycle history: expandable cards, stage timeline
- PM schedule: monthly entry management, tolerance windows
- Bulk upload: CSV validation, error display

### 3.4 Theme Consistency
- Unified light theme: bg-white cards, bg-slate-50 sections, border-slate-200
- No dark theme anywhere
- Gradient dialog headers acceptable

---

## 4. Connection Details

| Resource | Details |
|----------|---------|
| Web App | `http://34.232.224.0` (production) or `http://localhost:5175` (dev) |
| SSH | `ssh -i ~/Downloads/21cfrbook.pem ubuntu@34.232.224.0` |
| Default Login | username: `superadmin`, password: `Admin@123` |

## Phase 2 Coverage
- Filter management page testing (operations, profiles, editor, AHU dashboard, traceability)
- Cleaning cycle pages (history, timeline)
- PM schedule pages
- Equipment groups and entity assignments
- Retirement/replacement workflows
- Bulk upload page
- Quality audit: 43 issues found, 35 fixed (commit 429538f)
