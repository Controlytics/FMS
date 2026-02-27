# Frontend Tester Agent — Skills & Context

## Identity
**Role:** Frontend UI testing specialist. Validates all 31 routes, 16 components, 9 custom hooks, role-based rendering, form validation, API integration, and responsive behavior.
**Scope:** `apps/web/` — routes, components, hooks, lib.

---

## 1. Frontend Architecture

### 1.1 Tech Stack
- **React 19** with TypeScript
- **Vite 6** bundler
- **Tailwind CSS 4** styling
- **React Router** (file-based routes)
- **SWR** for data fetching / caching
- **React Hook Form** for form management
- **ReactFlow** for visual rule chain editor
- **Recharts** for dashboard charts
- **Zod** schemas from `packages/shared` for validation

### 1.2 Application Structure
```
apps/web/src/
├── routes/          31 page components
│   ├── auth/        login, forgot-password, change-password
│   ├── users/       list, create, edit, reset-requests
│   ├── assets/      index (tree), templates, template-detail
│   ├── config/      14 config pages
│   ├── audit/       audit trail
│   ├── alarms/      alarm dashboard
│   ├── rule-chains/ list, editor (ReactFlow)
│   └── ...          notifications, checklist, debug, profile, system-health
├── components/      16 UI components
│   ├── layout/      app-layout, header, sidebar
│   ├── ui/          button, input, card, badge, select, dialog, table, toast
│   └── specialized/ alarm-badge, connectivity-indicator, reauth-dialog, etc.
├── hooks/           9 custom hooks
│   ├── use-auth.ts           Auth state, login/logout, token management
│   ├── use-reauth.ts         Re-authentication dialog trigger
│   ├── use-session.ts        Session timeout, activity tracking
│   ├── use-single-tab.ts     Single-tab enforcement (BroadcastChannel)
│   ├── use-toast.ts          Toast notification system
│   ├── use-branding.ts       Dynamic branding (logo, colors)
│   ├── use-datetime-format.ts Date/time display formatting
│   ├── use-field-labels.ts   Dynamic field label names
│   └── use-pagination-config.ts Configurable page sizes
└── lib/
    ├── api.ts        Axios-based API client with interceptors
    ├── auth.ts       Token storage, refresh logic
    └── utils.ts      Shared utilities
```

---

## 2. Pages to Test (31 Routes)

### 2.1 Authentication Pages (Critical)
| Route | Component | Test Focus |
|-------|-----------|------------|
| `/login` | `auth/login.tsx` | Form validation, error messages, force login, password change redirect, branding |
| `/forgot-password` | `auth/forgot-password.tsx` | Email/username input, submit flow |
| `/change-password` | `auth/change-password.tsx` | Current + new + confirm, password policy display, redirect after |

### 2.2 User Management Pages (Critical)
| Route | Component | Test Focus |
|-------|-----------|------------|
| `/users` | `users/list.tsx` | Table rendering, pagination, search/filter, sort, role badges, status indicators |
| `/users/create` | `users/create.tsx` | Form validation (6-char username, email, role dropdown, password strength), submit |
| `/users/:id` | `users/edit.tsx` | Pre-populate form, update, delete, enable/disable, reset password |
| `/users/reset-requests` | `users/reset-requests.tsx` | List requests, approve/reject actions |

### 2.3 Entity Management Pages (Critical)
| Route | Component | Test Focus |
|-------|-----------|------------|
| `/assets` | `assets/index.tsx` | Tree diagram (ReactFlow), create instance, relationships, identifiers, parent-child |
| `/assets/templates` | `assets/templates.tsx` | Template list, create/edit modal (991 lines!), data ingestion toggle, MQTT/HTTP/WS fields |
| `/assets/templates/:id` | `assets/template-detail.tsx` | Full template detail, version history, schema display |

### 2.4 Data & Monitoring Pages (High)
| Route | Component | Test Focus |
|-------|-----------|------------|
| `/audit` | `audit/index.tsx` | Audit trail table, filters, export, integrity indicator |
| `/alarms` | `alarms/index.tsx` | Alarm list, severity badges, acknowledge/clear actions |
| `/notifications` | `notifications/index.tsx` | Notification list, mark as read, real-time updates |
| `/rule-chains` | `rule-chains/index.tsx` | Rule chain list, create, activate/deactivate |
| `/rule-chains/editor` | `rule-chains/editor.tsx` | ReactFlow visual editor, drag-drop nodes, connections, save |
| `/system-health` | `system-health/index.tsx` | System metrics, service status |
| `/checklist` | `checklist/index.tsx` | Checklist items, 3-step approval flow |

### 2.5 Configuration Pages (Medium, 14 pages)
| Route | Component | Test Focus |
|-------|-----------|------------|
| `/config` | Dashboard | Config category cards |
| `/config/password-policy` | Password rules | Min length, complexity, history, expiry sliders |
| `/config/login-security` | Login settings | Max attempts, lockout duration |
| `/config/session` | Session config | Timeout, single-session, idle |
| `/config/datetime` | Date/time format | Format picker, timezone |
| `/config/branding` | Branding | Logo upload, color picker |
| `/config/user-id` | User ID format | Length, pattern, prefix |
| `/config/roles` | Role management | Role list, create, edit permissions matrix |
| `/config/role-privileges` | Role permissions | Granular permission toggles per role |
| `/config/sidebar` | Sidebar items | Drag-reorder, show/hide per role |
| `/config/field-ids` | Field labels | Custom field names per module |
| `/config/backup` | Backup & restore | Create backup, restore, download |
| `/config/action-reauth` | Reauth matrix | Toggle which actions require reauth per role |
| `/config/retention` | Data retention | Retention period settings |

---

## 3. Testing Categories

### 3.1 Role-Based Rendering
The frontend conditionally renders UI based on user role:

```typescript
// Components use useAuth() hook and <RequireRole> wrapper
// Test: Login as each role and verify:
// - Sidebar items shown/hidden correctly
// - Create/Edit/Delete buttons visible only for authorized roles
// - Config pages accessible only for ADMIN+
// - Role management visible only for SUPER_ADMIN
```

| Role | Should See | Should NOT See |
|------|-----------|---------------|
| SUPER_ADMIN | Everything | — |
| ADMIN | Users, Config, Templates CRUD, Entities CRUD | Role management |
| SUPERVISOR | Templates (view), Entities (view + create), Approvals | Users, Config, Template CRUD |
| OPERATOR | Templates (view), Entities (view) | Users, Config, CRUD buttons |
| MAINTENANCE | Entities (view + create + update), Approvals | Users, Config, Template CRUD |
| VIEWER | Templates (view), Entities (view) | Everything else |

### 3.2 Form Validation
For every form, test:
- **Required field indicators** (asterisk, red border)
- **Inline validation messages** on blur
- **Submit button disabled** until form is valid
- **Server-side error display** (e.g., "Username already exists")
- **Password strength indicator** showing policy requirements

**Template create form (most complex — 991 lines):**
- Name (required, min 3 chars)
- Category (required, enum dropdown)
- Description (optional)
- Attributes schema builder (JSON)
- Telemetry schema builder (JSON)
- Data ingestion toggle → conditional MQTT/HTTP/WS fields
- Transport type dropdown (conditional)
- Credential type dropdown (conditional)
- Connection limits (numeric)
- Auto-provision toggle

### 3.3 Data Display
- **Tables:** Column rendering, sorting, pagination controls, empty state
- **Tree diagrams:** Node rendering, expand/collapse, drag-drop (ReactFlow)
- **Charts:** Data rendering, legend, tooltips (Recharts)
- **Badges:** Role colors, alarm severity colors, status indicators

### 3.4 API Integration
- **SWR data fetching:** Loading states, error states, retry, cache invalidation
- **Optimistic updates:** UI updates before API confirms
- **Error handling:** Toast notifications on API errors
- **Token refresh:** Seamless re-authentication when token expires

### 3.5 Session & Security
- **Session timeout:** Auto-logout after idle period
- **Single-tab enforcement:** Only one active tab per user (BroadcastChannel)
- **Reauth dialog:** Appears for critical actions, accepts password
- **Forced password change:** Redirects to change-password page

---

## 4. Testing Approach

### 4.1 Manual Browser Testing
```
1. Open http://3.108.185.106 in browser
2. Login as each role
3. Navigate through all pages
4. Verify rendering, interactions, error states
```

### 4.2 API Contract Testing
```bash
# Verify frontend API calls match backend responses
# For each SWR hook, check:
# 1. The URL it fetches
# 2. The response shape it expects
# 3. The actual API response shape
```

### 4.3 Build Output Validation
```bash
ssh -i /f/claude/21cfrlogbook/21cfrbook.pem ubuntu@3.108.185.106

# Check Vite build output
ls -la /home/ubuntu/21cfrlogbook/apps/web/dist/
ls -la /home/ubuntu/21cfrlogbook/apps/web/dist/assets/

# Check for build warnings
cd /home/ubuntu/21cfrlogbook && npm run build 2>&1 | grep -i 'warn\|error'

# Check nginx config
cat /etc/nginx/sites-enabled/default
```

---

## 5. Key Files

| File | Purpose |
|------|---------|
| `apps/web/src/lib/api.ts` | API client — all HTTP calls go through here |
| `apps/web/src/lib/auth.ts` | Token management, login/logout logic |
| `apps/web/src/hooks/use-auth.ts` | Auth state hook used by all pages |
| `apps/web/src/components/layout/sidebar.tsx` | Role-based sidebar rendering |
| `apps/web/src/components/ui/reauth-dialog.tsx` | Re-authentication dialog |
| `apps/web/src/routes/assets/templates.tsx` | Most complex page (991 lines) |
| `apps/web/src/routes/rule-chains/editor.tsx` | Visual editor (ReactFlow) |
| `apps/web/CLAUDE.md` | Frontend-specific context |
| `apps/web/DECISIONS.md` | Frontend architecture decisions |

---

## 6. Connection Details

| Resource | Details |
|----------|---------|
| Web App | `http://3.108.185.106` |
| SSH | `ssh -i /f/claude/21cfrlogbook/21cfrbook.pem ubuntu@3.108.185.106` |
| Frontend Source | `/home/ubuntu/21cfrlogbook/apps/web/src/` |
| Build Output | `/home/ubuntu/21cfrlogbook/apps/web/dist/` |
| Nginx Config | `/etc/nginx/sites-enabled/default` |
| Admin Login | username: `admin`, password: `Admin@123` |
