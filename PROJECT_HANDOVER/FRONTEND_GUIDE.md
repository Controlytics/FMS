# Frontend Guide

## Folder Structure

```
apps/web/src/
+-- main.tsx                  # App entry, routing, lazy loading
+-- lib/
|   +-- api-client.ts        # HTTP client (fetch wrapper with auth headers)
|   +-- cn.ts                # Tailwind class merge utility
|   +-- swr-config.ts        # SWR global configuration
|   +-- password-utils.ts    # Password generation for admin forms
+-- hooks/
|   +-- use-auth.ts          # Auth state, login/logout, token refresh
|   +-- use-session.ts       # Session timeout warning
|   +-- use-reauth.ts        # Re-authentication dialog trigger
|   +-- use-branding.ts      # Organization branding (logo, colors)
|   +-- use-datetime-format.ts # Locale-aware formatting
|   +-- use-field-labels.ts  # Custom field labels from config
|   +-- use-role-colors.ts   # Role badge colors
|   +-- use-pagination-config.ts # Rows per page config
|   +-- use-entity-websocket.ts  # Real-time entity updates
|   +-- use-single-tab.ts   # Single-tab enforcement
|   +-- use-toast.ts         # Toast notifications
+-- components/
|   +-- layout/
|   |   +-- app-layout.tsx   # Main layout (header + sidebar + content)
|   |   +-- header.tsx       # Top bar with user menu, notifications
|   |   +-- sidebar.tsx      # Navigation (role-based item filtering)
|   +-- ui/                  # Primitive components (button, input, dialog, etc.)
|   +-- reauth-dialog.tsx    # Password re-entry modal
|   +-- require-role.tsx     # Route guard component
|   +-- error-boundary.tsx   # React error boundary
+-- routes/
    +-- admin-requests/      # Password reset approvals
    +-- alarms/              # Alarm list, acknowledge, clear
    +-- assets/              # Entity tree, templates, dialogs, tabs, hooks
    +-- audit/               # Audit trail viewer with export
    +-- auth/
    |   +-- login.tsx        # Login page with session conflict handling
    |   +-- forgot-password.tsx
    |   +-- change-password.tsx
    +-- checklist/           # Checklist execution
    +-- checklists/          # Checklist profile management
    +-- cleaning-cycles/     # History and timeline views
    +-- config/
    |   +-- index.tsx        # Config category cards
    |   +-- branding/        # Organization branding settings
    |   +-- notification-rules/ # Notification rule management
    |   +-- notification-settings/ # Email/SMS/channel settings
    |   +-- roles/           # Role and permission management
    |   +-- ldap.tsx         # LDAP configuration
    |   +-- password-policy.tsx
    |   +-- [20+ config pages]
    +-- dashboard/           # Dashboard with widgets
    +-- debug/               # Pipeline execution debugging
    +-- filter-management/   # Phase 2 filter pages
    |   +-- operations/      # Start/advance/bypass/checklist
    |   +-- profiles/        # Filter profile management
    |   +-- status/          # Current filter status view
    |   +-- scan/            # QR/barcode scanning
    |   +-- traceability/    # Full filter history timeline
    |   +-- AHU-dashboard/   # Equipment group overview
    |   +-- cleaning-profile-editor/ # Visual pipeline builder
    |   +-- retirement/      # Filter retirement workflow
    |   +-- replacement/     # Filter replacement workflow
    |   +-- bulk-upload/     # CSV/Excel bulk import
    |   +-- equipment/       # Equipment group management
    +-- mobile/              # Mobile-optimized views
    +-- notifications/       # Notification list
    +-- organizations/
    |   +-- index.tsx        # Organization management
    |   +-- org-detail.tsx   # Org detail (users, entities, templates)
    +-- pm-schedules/        # PM schedule management
    +-- profile/             # User profile
    +-- rule-chains/
    |   +-- index.tsx        # Rule chain list
    |   +-- editor.tsx       # Visual ReactFlow editor
    +-- system-health/       # API metrics
    +-- tenant/              # Organization management (admin view)
    +-- users/
        +-- list.tsx         # User list with filters, bulk actions
        +-- create.tsx       # Create user form
        +-- edit.tsx         # Edit user with org assignment
        +-- reset-requests.tsx
```

## Theme
All pages use a unified **light theme** -- no dark theme anywhere:
- **Cards:** bg-white with border-slate-200
- **Sections:** bg-slate-50
- **Primary text:** text-slate-800
- **Secondary text:** text-slate-600
- **Borders:** border-slate-200
- **Dialog headers:** Gradient headers acceptable

## Routing

All routes defined in `main.tsx` using React Router v7:
- **Public routes:** `/login`, `/forgot-password`, `/change-password`
- **Protected routes:** Wrapped in `<AppLayout>` which checks auth
- **Permission-guarded:** `<RequireRole permissions={[PERMISSIONS.X]}>` component
- **Lazy-loaded:** Heavy pages use `React.lazy()` with `<Suspense>`

## State Management

| Type | Tool | Usage |
|------|------|-------|
| Server state | SWR | API data fetching with caching |
| UI state | useState | Component-local state |
| Auth token | sessionStorage | JWT token persistence |
| User prefs | localStorage | Tab ID, heartbeat |
| URL state | Query params | Filters, pagination (shareable) |

## API Integration

**Client:** `lib/api-client.ts`

```typescript
const api = new ApiClient();
api.get('/api/users');
api.post('/api/users', body);
api.put('/api/users/123', body);
api.delete('/api/users/123');
api.postWithReauth('/api/users', body, password);  // For sensitive actions
```

- Auto-attaches `Authorization: Bearer <token>` header
- Handles 401 -> redirect to login
- Handles `FORCE_PASSWORD_CHANGE` -> redirect to change-password
- Handles `REAUTH_REQUIRED` -> show re-auth dialog

## Key UI Flows

### Login
1. Enter username/password -> `POST /api/auth/login`
2. On success -> store token in sessionStorage, redirect to `/`
3. On session conflict -> show dialog (force login or cancel)
4. On force password change -> redirect to `/change-password`
5. Token refreshed every 30 minutes via `/api/auth/refresh`

### Create User
1. Form with username, name, email, role dropdown, auto-generated password
2. Role list fetched from `/api/roles/{currentRole}/creatable`
3. SUPER_ADMIN: can create ADMIN and below
4. Organization dropdown from `/api/organizations`
5. Submit with re-auth -> `POST /api/users`

### Rule Chain Editor
1. Visual canvas using ReactFlow library
2. Drag nodes from palette -> drop on canvas
3. Connect nodes by dragging edges between ports
4. Configure each node via side panel
5. Save -> `PUT /api/rule-chains/:id` with nodes + connections
6. Debug mode shows execution trace per node

### Filter Cleaning Operations (Phase 2)
1. Select filter from operations page -> view current state
2. Start cycle -> `POST /api/filters/:id/start-cycle`
3. System loads pipeline from assigned cleaning profile
4. For each stage:
   - If CHECKLIST gate: form appears with questions -> submit answers
   - If STAGE: click Advance -> `POST /api/filters/:id/advance`
   - If blocked: shows reason (e.g., "Checklist pending")
   - If bypass needed: click Bypass (requires authorization)
5. When pipeline reaches END: cycle marked COMPLETED
6. Full timeline visible in traceability view

### Cleaning Profile Editor (Phase 2)
1. Visual drag-and-drop pipeline builder
2. Add START, stage nodes (WASH_IN/OUT, DRY_IN/OUT, STORAGE_IN/OUT), CHECKLIST, END
3. Connect nodes to define flow order
4. Configure checklist questions per CHECKLIST node
5. Save profile -> `POST/PUT /api/cleaning-profiles`

### AHU Dashboard (Phase 2)
1. Overview of equipment groups with filter status
2. Shows active cycles, pending checklists, PM due dates
3. Links to individual filter operations
