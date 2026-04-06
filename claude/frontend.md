# DigiLog Frontend Documentation

## System Architecture Overview

The system follows a three-tier architecture with Frontend (React 19 + Vite + Tailwind CSS), Backend (Fastify 5 + TypeScript), and Database (PostgreSQL 18 + Prisma + TimescaleDB) layers. An Audit Trail Service captures all user actions (except Super Admin). Authentication and Authorization includes Session Management, Password Policy enforcement, and Permission-based access control.

---

## 1. Tech Stack

- **React 19** with TypeScript
- **Vite** bundler (port 5175 dev, dist/ for production)
- **Tailwind CSS** — unified light theme (bg-white, text-slate-800, bg-slate-50, border-slate-200)
- **React Router v6** — file-based route structure
- **SWR** — data fetching with auto-revalidation
- **React Hook Form + Zod** — form validation with shared schemas
- **ReactFlow** — rule chain visual editor + cleaning profile pipeline editor
- **Recharts** — dashboard charts

---

## 2. User Role Hierarchy & Privileges

### 2.1 Role Hierarchy

**SUPER ADMIN** (Highest Level - No Audit Log - All Privileges)
  |
**ADMIN** (Audit Logged)
  |
**SUPERVISOR** (Audit Logged - Approvals) | **MAINTENANCE** (Audit Logged - Assets) | **OPERATOR** (Audit Logged - View Only)
  |
**VIEWER** (Audit Logged - View Only)

Note: Custom roles can be created by SUPER_ADMIN with any combination of 52+ permissions. The above are the 6 default roles.

### 2.2 Permission-Based Access Control

All routes use `requirePermission()` with specific permission constants from `@digilog/shared`. 52+ permissions covering:
- User management (USER_CREATE, USER_UPDATE, USER_DELETE, etc.)
- Entity management (ASSET_CREATE, ASSET_READ, ASSET_TEMPLATE_MANAGE, etc.)
- Config management (CONFIG_READ, CONFIG_UPDATE, etc.)
- Audit (AUDIT_READ, AUDIT_EXPORT)
- Filter management (FILTER_MANAGE, FILTER_READ, etc.)
- Rule chains (RULE_CHAIN_MANAGE, etc.)
- Notifications, Help, Backup, Debug, and more

---

## 3. Frontend Pages

### 3.1 Authentication Pages
| Route | Component | Purpose |
|-------|-----------|---------|
| `/login` | `auth/login.tsx` | Login with force-login support, branding |
| `/forgot-password` | `auth/forgot-password.tsx` | Password reset request |
| `/change-password` | `auth/change-password.tsx` | Mandatory password change |

### 3.2 Core Pages
| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | Dashboard | Main dashboard with overview cards |
| `/users` | `users/list.tsx` | User management with CRUD |
| `/assets` | `assets/index.tsx` | Entity Explorer — tree + detail panel |
| `/assets/templates` | `assets/templates.tsx` | Entity template management |
| `/audit` | `audit/index.tsx` | Audit trail with filters and export |
| `/alarms` | `alarms/index.tsx` | Alarm dashboard with role-based columns |
| `/notifications` | `notifications/index.tsx` | Notification center |
| `/rule-chains` | `rule-chains/index.tsx` | Rule chain list and visual editor |
| `/system-health` | `system-health/index.tsx` | System health monitoring |
| `/debug` | `debug/index.tsx` | Pipeline debug traces |
| `/profile` | `profile/index.tsx` | User profile |
| `/checklist/:entityId` | `checklist/index.tsx` | Standalone checklist form (no sidebar) |

### 3.3 Configuration Pages (23 auto-discovered)
| Route | Purpose |
|-------|---------|
| `/config/password-policy` | Password complexity rules |
| `/config/login-security` | Failed attempts, lockout |
| `/config/session` | Session timeout, single-session |
| `/config/datetime` | Date/time format, timezone |
| `/config/branding` | Logo, colors |
| `/config/roles` | Role management CRUD |
| `/config/role-privileges` | Permission matrix per role |
| `/config/sidebar` | Sidebar items per role |
| `/config/field-ids` | Custom field labels (78 fields, grouped by module) |
| `/config/backup` | Backup create/restore |
| `/config/action-reauth` | Reauth toggle per role/action |
| `/config/notification-rules` | Notification rule management |
| `/config/notification-settings` | Email/SMS/Telegram/Slack config |
| `/config/alarm-columns` | Alarm column visibility per role |
| `/config/filter-lifecycle` | Filter lifecycle state config |
| `/config/filter-cleaning-reasons` | Cleaning reasons config |
| And more auto-generated config pages... |

### 3.4 Phase 2 — Digital Filter Management Pages
| Route | Component | Purpose |
|-------|-----------|---------|
| `/filter-management/operations` | `filter-operations.tsx` | Main operations (8 stages, scan, checklist, reason) |
| `/filter-management/cleaning-profiles` | `cleaning-profile-list.tsx` | Cleaning profile list |
| `/filter-management/cleaning-profiles/:id/edit` | `cleaning-profile-editor.tsx` | Visual pipeline editor (ReactFlow) |
| `/filter-management/filter-profiles` | `filter-profile-list.tsx` | Filter profile management |
| `/filter-management/ahu-dashboard` | `ahu-dashboard.tsx` | AHU filter set overview by equipment group |
| `/filter-management/traceability` | `filter-traceability.tsx` | Per-filter event history |
| `/filter-management/status` | `filter-status.tsx` | Filter status overview |
| `/filter-management/scan` | `filter-scan.tsx` | QR/barcode scan for filter identification |
| `/filter-management/retirement` | `retirement.tsx` | Filter retirement workflow |
| `/filter-management/replacement` | `replacement.tsx` | Filter replacement workflow |
| `/filter-management/bulk-upload` | `bulk-upload.tsx` | CSV bulk filter import |
| `/filter-management/equipment` | `equipment.tsx` | Equipment group management |
| `/cleaning-cycles` | `history.tsx` | Expandable cycle history cards |
| `/cleaning-cycles/timeline` | `timeline.tsx` | Cycle event timeline with performer names |
| `/checklists` | `list.tsx` | Checklist profile list |
| `/checklists/:id` | `detail.tsx` | Checklist detail with questions |
| `/pm-schedules` | PM schedule pages | PM schedule management |

---

## 4. Custom Hooks (9+)

| Hook | Purpose |
|------|---------|
| `use-auth.ts` | Auth state, login/logout, token management, returnUrl support |
| `use-reauth.ts` | Re-authentication dialog trigger (must be awaited) |
| `use-session.ts` | Session timeout, activity tracking, warning dialog |
| `use-single-tab.ts` | Single-tab enforcement via BroadcastChannel |
| `use-toast.ts` | Toast notification system (success/error/warning/info) |
| `use-branding.ts` | Dynamic branding (logo, colors) |
| `use-datetime-format.ts` | Date/time display formatting per config |
| `use-field-labels.ts` | Dynamic field label names (78 fields) |
| `use-pagination-config.ts` | Configurable page sizes |

---

## 5. UI Component Library (16+ custom components)

All components use Tailwind CSS following Shadcn/ui patterns (variant props, cn() utility, forwardRef).

| Component | Purpose |
|-----------|---------|
| Button | Variants: default, destructive, outline, ghost |
| Input | Types, validation, secureField prop for passwords |
| Card | Content wrapper |
| Badge | Role colors, status indicators, severity |
| Select | Dropdown options |
| Dialog | Modal overlays |
| Table | Columns, sort, pagination |
| Toast | Auto-dismiss notifications |
| Sidebar | Role-filtered navigation |
| Header | User info, logout |
| AppLayout | Auth guard, session timeout |
| ErrorBoundary | Error catching, fallback UI |
| ReauthDialog | Password re-entry for critical actions |
| RequireRole | Permission-based route guard |
| AlarmBadge | Severity colors |
| ConnectivityIndicator | Online/offline status |

---

## 6. Security Features

| Feature | Implementation |
|---------|----------------|
| JWT Storage | sessionStorage (cleared on tab close) |
| Password Masking | secureField prop disables copy/paste/cut/drag/context-menu |
| Session Timeout | Configurable idle timeout with countdown warning |
| Single-Tab | BroadcastChannel prevents concurrent tabs per user |
| Re-authentication | Required for critical actions (configurable per role/action) |
| Forced Password Change | Redirect to /change-password for temporary passwords |
| Login Security | Same error for non-existent users (prevents enumeration) |
| RBAC UI | Components show/hide based on PERMISSIONS constants |

---

## 7. Theme

Unified light theme throughout the application:
- Cards: bg-white
- Sections: bg-slate-50
- Borders: border-slate-200
- Text: text-slate-800
- Gradient dialog headers are acceptable
- NO dark theme anywhere

---

*Document Version: 3.0*
*Last Updated: 2026-04-04*
*Compliance Standard: 21 CFR Part 11*
*Status: Phase 2 Digital FMS complete — 34+ frontend pages, 9+ custom hooks, 16+ UI components, React 19 + Vite + Tailwind CSS*
