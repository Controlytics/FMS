# DigiLog — Frontend Guide

## Overview

React 19 SPA built with Vite 6, styled with Tailwind CSS 4, served by Nginx in production. No component library — all UI built with Tailwind utility classes.

**Entry point:** `apps/web/src/main.tsx`
**Dev server:** `npx vite --host` (port 5175)
**Build:** `npx vite build` → `apps/web/dist/`

## All Routes (85+ pages)

### Public Routes (no authentication)

| Path | Page | Description |
|---|---|---|
| `/login` | LoginPage | Username/password login with force-login option |
| `/forgot-password` | ForgotPasswordPage | Submit password reset request |
| `/change-password` | ChangePasswordPage | Forced password change on first login |
| `/contact-admin` | ContactAdminPage | Display admin contact info |

### Dashboard & Profile

| Path | Page | Permission |
|---|---|---|
| `/` | DashboardPage | Any authenticated user |
| `/profile` | ProfilePage | Any authenticated user |

### User Management

| Path | Page | Permission |
|---|---|---|
| `/users` | UserListPage | USER_READ |
| `/users/create` | CreateUserPage | USER_CREATE |
| `/users/:id` | EditUserPage | USER_UPDATE |
| `/users/reset-requests` | ResetRequestsPage | USER_RESET_PASSWORD |

### Entity Management (lazy-loaded)

| Path | Page | Permission |
|---|---|---|
| `/assets` | AssetsPage | ASSET_VIEW |
| `/assets/templates` | AssetTemplatesPage | ASSET_VIEW |

### Filter Management (lazy-loaded)

| Path | Page | Permission |
|---|---|---|
| `/filter-list` | FilterListPage | ASSET_READ |
| `/filters` | FilterOperationsPage | FILTER_OPERATE |
| `/filters/:id/trace` | FilterTraceabilityPage | EVENT_READ |
| `/filter-retirements` | RetirementListPage | ASSET_READ |
| `/filter-replacements` | ReplacementListPage | ASSET_READ |

### Cleaning Profiles (lazy-loaded)

| Path | Page | Permission |
|---|---|---|
| `/filter-cleaning-profiles` | CleaningProfileListPage | FCP_READ |
| `/filter-cleaning-profiles/:id/edit` | CleaningProfileEditorPage | FCP_UPDATE |

### Checklists (lazy-loaded)

| Path | Page | Permission |
|---|---|---|
| `/checklists` | ChecklistProfileListPage | FCP_READ |
| `/checklists/:id` | ChecklistProfileDetailPage | FCP_READ |
| `/checklist/:entityId` | ChecklistPage (standalone) | Any authenticated |

### Cleaning Cycles (lazy-loaded)

| Path | Page | Permission |
|---|---|---|
| `/cleaning-cycles` | CleaningCycleHistoryPage | CYCLE_READ |
| `/cleaning-cycles/:id` | CleaningCycleTimelinePage | CYCLE_READ |

### PM Schedules (lazy-loaded)

| Path | Page | Permission |
|---|---|---|
| `/pm-schedules` | PmScheduleListPage | PM_READ |
| `/pm-schedules/:entityId` | PmScheduleDetailPage | PM_READ |
| `/my-tasks` | MyTasksPage | PM_EXECUTE |

### Equipment & AHU (lazy-loaded)

| Path | Page | Permission |
|---|---|---|
| `/ahus/:id` | AhuDashboardPage | ASSET_VIEW |

### Reports (lazy-loaded)

| Path | Page | Permission |
|---|---|---|
| `/report-templates` | ReportTemplateListPage | REPORT_TEMPLATE_READ |
| `/report-templates/:id/edit` | ReportTemplateEditorPage | REPORT_TEMPLATE_UPDATE |
| `/reports` | ReportListPage | REPORT_VIEW |
| `/reports/generate` | ReportGeneratePage | REPORT_GENERATE |
| `/reports/:id` | ReportDetailPage | REPORT_VIEW |

### Rule Chains (lazy-loaded)

| Path | Page | Permission |
|---|---|---|
| `/rule-chains` | RuleChainsPage | RULE_CHAIN_VIEW |
| `/rule-chains/:id` | RuleChainEditorPage | RULE_CHAIN_UPDATE |

### Alarms & Notifications

| Path | Page | Permission |
|---|---|---|
| `/alarms` | AlarmDashboardPage (lazy) | ALARM_VIEW |
| `/notifications` | NotificationsPage | NOTIFICATION_VIEW |

### Audit & System

| Path | Page | Permission |
|---|---|---|
| `/audit` | AuditTrailPage | AUDIT_READ |
| `/system-health` | SystemHealthPage (lazy) | SUPER_ADMIN/ADMIN |
| `/debug/traces` | DebugTracesPage | READ_DEBUG_TRACE |

### Approvals

| Path | Page | Permission |
|---|---|---|
| `/approvals` | ApprovalsPage (lazy) | BLOCK_CHANGE_APPROVE |
| `/admin-requests` | AdminRequestsPage (lazy) | USER_CREATE |

### Organization Management

| Path | Page | Permission |
|---|---|---|
| `/organizations` | OrganizationsPage (lazy) | ORG_VIEW |
| `/organizations/:id` | OrgDetailPage (lazy) | ORG_VIEW |

### Configuration (20+ pages)

| Path | Page | Permission |
|---|---|---|
| `/config` | ConfigIndexPage | CONFIG_READ |
| `/config/branding` | BrandingConfigPage | SUPER_ADMIN |
| `/config/roles` | RoleAccessPage | ROLE_MANAGE |
| `/config/backup` | BackupRestorePage | CONFIG_UPDATE |
| `/config/action-reauth` | ActionReauthPage | SUPER_ADMIN |
| `/config/equipment-groups` | EquipmentGroupsConfigPage | EG_VIEW |
| `/config/report-settings` | ReportSettingsPage | CONFIG_UPDATE |
| `/config/filter-data-management` | FilterDataManagementPage | ORG_MANAGE |
| `/config/tablet-access` | TabletAccessConfigPage | CONFIG_UPDATE |
| `/config/dynamic/:moduleKey` | DynamicConfigPage | CONFIG_READ |
| ... | 10+ more config pages | Various |

### Mobile (lazy-loaded, standalone layout)

| Path | Page | Description |
|---|---|---|
| `/m/login` | MobileLoginPage | Tablet login |
| `/m` | MobileOperationsPage | Tablet cleaning operations |

## Custom Hooks (14)

### Authentication & Session

| Hook | File | Purpose |
|---|---|---|
| `useAuth()` | `use-auth.ts` | Login, logout, token refresh, user data, permissions |
| `useSession()` | `use-session.ts` | Idle timeout tracking, warning dialog countdown |
| `useSingleTab()` | `use-single-tab.ts` | One tab per user enforcement via heartbeat |
| `useReauth()` | `use-reauth.ts` | Password re-entry dialog for sensitive operations |

### UI & Configuration

| Hook | File | Purpose |
|---|---|---|
| `useBranding()` | `use-branding.ts` | Fetch branding config, apply theme colors |
| `useToast()` | `use-toast.ts` | Success/error/warning notification toasts |
| `useRoleColors()` | `use-role-colors.ts` | Color mapping per user role |
| `useFieldLabels()` | `use-field-labels.ts` | Dynamic field name labels from config |
| `useDatetimeFormat()` | `use-datetime-format.ts` | Locale-aware date/time formatting |
| `usePaginationConfig()` | `use-pagination-config.ts` | Page size options from config |

### Business Logic

| Hook | File | Purpose |
|---|---|---|
| `useReportConfig()` | `use-report-config.ts` | Report layout settings (header, footer) |
| `useOffline()` | `use-offline.ts` | Offline operation queue, sync status |
| `useEntityWebsocket()` | `use-entity-websocket.ts` | Real-time WebSocket data subscription |
| `useRfidGuard()` | `use-rfid-guard.ts` | Block RFID keyboard input in non-RFID fields |

## Components

### Layout Components

| Component | File | Purpose |
|---|---|---|
| `AppLayout` | `layout/app-layout.tsx` | Main wrapper: sidebar + header + page outlet |
| `Sidebar` | `layout/sidebar.tsx` | 27-item navigation, permission-filtered, collapsible |
| `Header` | `layout/header.tsx` | Top bar: menu toggle, profile, logout |

### Auth & Guard Components

| Component | File | Purpose |
|---|---|---|
| `RequireRole` | `require-role.tsx` | Permission gate — wraps routes |
| `ReauthDialog` | `reauth-dialog.tsx` | Password re-entry modal for sensitive actions |
| `ErrorBoundary` | `error-boundary.tsx` | Global error catch |
| `RouteErrorBoundary` | `route-error-boundary.tsx` | Per-route error catch |

### UI Primitives (Tailwind-based)

| Component | File | Description |
|---|---|---|
| `Button` | `ui/button.tsx` | Primary, outline, ghost variants |
| `Input` | `ui/input.tsx` | Text, password, number inputs |
| `Select` | `ui/select.tsx` | Dropdown selector |
| `Dialog` | `ui/dialog.tsx` | Modal dialog (header, title, footer) |
| `Card` | `ui/card.tsx` | Card container |
| `Table` | `ui/table.tsx` | Data table with th/tr/td |
| `Badge` | `ui/badge.tsx` | Status badges (success, error, warning) |
| `AlarmBadge` | `ui/alarm-badge.tsx` | Alarm severity badges |
| `Toast` | `ui/toast.tsx` | Notification toast (5s auto-dismiss) |
| `HelpButton` | `ui/help-button.tsx` | Tooltip help |
| `CodeSnippet` | `ui/code-snippet.tsx` | Formatted code display |
| `ConnectivityIndicator` | `ui/connectivity-indicator.tsx` | Online/offline status |
| `ErrorPopup` | `ui/error-popup.tsx` | Error notification dialog |

### Feature Components

| Component | File | Purpose |
|---|---|---|
| `ReportPageWrapper` | `report-page-wrapper.tsx` | Wraps report tables with header/footer |
| `ToastProvider` | `toast-provider.tsx` | SWR error toast registration |

## Utility Libraries

| File | Purpose |
|---|---|
| `lib/api-client.ts` | HTTP client (get/post/put/delete), auto-attach token, 401 redirect, reauth methods |
| `lib/swr-config.ts` | SWR defaults (5s dedup, 2 retries, no focus revalidation) |
| `lib/themes.ts` | 10 color presets, `applyTheme()` sets CSS vars on `:root` |
| `lib/theme-styles.ts` | Tailwind theme customization utilities |
| `lib/cn.ts` | Class name merger (clsx-like) |
| `lib/password-utils.ts` | Password strength validation |
| `lib/url-utils.ts` | URL parsing, safe redirect checking |
| `lib/filter-constants.ts` | Filter stage type constants |
| `lib/pdf-report.ts` | PDF generation for reports |
| `lib/offline-store.ts` | IndexedDB offline cache (operations, filters, identifiers) |
| `lib/sync-engine.ts` | Offline sync engine (FIFO, skip conflicts, auto-sync on reconnect) |

## Authentication Flow

```
1. User enters credentials on /login
2. POST /api/auth/login { username, password, force? }
3. If session conflict → show "force login" option
4. Token stored in sessionStorage (+ localStorage backup)
5. If forcePasswordChange → redirect to /change-password
6. Fetch /api/auth/me → get user profile + permissions
7. Navigate to returnUrl or / (dashboard)
8. Token auto-refreshes every 30 minutes
9. Idle timeout (configurable, default 15 min) → warning → auto-logout
10. Single-tab enforcement: heartbeat every 1s, 3s timeout detection
```

## Permission System

```typescript
// Route-level guard
<RequireRole permissions={[PERMISSIONS.USER_READ]}>
  <UserListPage />
</RequireRole>

// Page-level check
const { user } = useAuth();
const isSuperAdmin = user?.role === 'SUPER_ADMIN';
const canEdit = isSuperAdmin || (user?.permissions ?? []).includes('USER_UPDATE');

// SUPER_ADMIN bypasses ALL permission checks
```

## Theming System

```
10 Presets: ocean, forest, sunset, mint, rose, slate, indigo, amber, emerald, violet

Each preset defines:
  --theme-primary, --theme-secondary, --theme-accent
  --theme-gradient-from, --theme-gradient-to
  --theme-focus-ring

Applied via: useBranding() → applyTheme() → CSS custom properties on :root

Used on: sidebar gradient, buttons, dialog headers, links, badges, focus rings
```

## Offline Architecture

```
Online Mode:
  API calls → apiClient.post/put/delete → server response

Offline Mode:
  API calls → executeOrQueue() hook
    → If online → direct API call
    → If offline → IndexedDB queue + "pending" indicator

Reconnect:
  sync-engine.ts detects connectivity
    → Replays queued operations (FIFO order)
    → Skips conflicting operations
    → Shows "synced" indicator

Cached Data (IndexedDB):
  - Filter instances (for offline lookup)
  - Cleaning profile templates
  - Cleaning reasons
  - Identifier → filter map (for offline RFID)
```

## Key Patterns

1. **SWR for all reads** — auto-revalidation, dedup, error retry
2. **apiClient for all writes** — post/put/delete with token attachment
3. **Lazy loading** — heavy pages code-split via `React.lazy()`
4. **Permission gating** — `<RequireRole>` wrapper + `isSuperAdmin` bypass
5. **Re-authentication** — `useReauth()` + `ReauthDialog` for 69 sensitive actions
6. **Toast notifications** — success/error feedback (never `alert()`)
7. **Light theme only** — bg-white cards, bg-slate-50 sections, no dark mode
8. **Responsive** — sidebar collapses to hamburger on mobile, reduced padding
