# Frontend Guide

## Folder Structure

```
apps/web/src/
├── main.tsx                  # App entry, routing, lazy loading
├── lib/
│   ├── api-client.ts        # HTTP client (fetch wrapper with auth headers)
│   ├── cn.ts                # Tailwind class merge utility
│   ├── swr-config.ts        # SWR global configuration
│   └── password-utils.ts    # Password generation for admin forms
├── hooks/
│   ├── use-auth.ts          # Auth state, login/logout, token refresh
│   ├── use-session.ts       # Session timeout warning
│   ├── use-reauth.ts        # Re-authentication dialog trigger
│   ├── use-branding.ts      # Organization branding (logo, colors)
│   ├── use-datetime-format.ts # Locale-aware formatting
│   ├── use-field-labels.ts  # Custom field labels from config
│   ├── use-role-colors.ts   # Role badge colors
│   ├── use-pagination-config.ts # Rows per page config
│   ├── use-entity-websocket.ts  # Real-time entity updates
│   ├── use-single-tab.ts   # Single-tab enforcement
│   └── use-toast.ts         # Toast notifications
├── components/
│   ├── layout/
│   │   ├── app-layout.tsx   # Main layout (header + sidebar + content)
│   │   ├── header.tsx       # Top bar with user menu, notifications
│   │   └── sidebar.tsx      # Navigation (role-based item filtering)
│   ├── ui/                  # Primitive components (button, input, dialog, etc.)
│   ├── reauth-dialog.tsx    # Password re-entry modal
│   ├── require-role.tsx     # Route guard component
│   └── error-boundary.tsx   # React error boundary
├── routes/
│   ├── auth/
│   │   ├── login.tsx        # Login page with session conflict handling
│   │   ├── forgot-password.tsx
│   │   └── change-password.tsx
│   ├── dashboard/
│   │   └── index.tsx        # Dashboard with widgets
│   ├── users/
│   │   ├── list.tsx         # User list with filters, bulk actions
│   │   ├── create.tsx       # Create user form
│   │   ├── edit.tsx         # Edit user with org assignment
│   │   └── reset-requests.tsx
│   ├── organizations/
│   │   ├── index.tsx        # Organization management
│   │   └── org-detail.tsx   # Org detail (users, entities, templates, assignments)
│   ├── assets/              # (Lazy loaded)
│   │   ├── index.tsx        # Entity tree view
│   │   ├── templates.tsx    # Template management
│   │   └── components/      # Sub-components
│   ├── rule-chains/         # (Lazy loaded)
│   │   ├── index.tsx        # Rule chain list
│   │   └── editor.tsx       # Visual ReactFlow editor
│   ├── config/
│   │   ├── index.tsx        # Config category cards
│   │   ├── password-policy.tsx
│   │   ├── ldap.tsx         # LDAP configuration
│   │   └── [20+ config pages]
│   └── [alarms, audit, debug, system-health, etc.]
```

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
api.get(/api/users);
api.post(/api/users, body);
api.put(/api/users/123, body);
api.delete(/api/users/123);
api.postWithReauth(/api/users, body, password);  // For sensitive actions
```

- Auto-attaches `Authorization: Bearer <token>` header
- Handles 401 → redirect to login
- Handles `FORCE_PASSWORD_CHANGE` → redirect to change-password
- Handles `REAUTH_REQUIRED` → show re-auth dialog

## Key UI Flows

### Login
1. Enter username/password → `POST /api/auth/login`
2. On success → store token in sessionStorage, redirect to `/`
3. On session conflict → show dialog (force login or cancel)
4. On force password change → redirect to `/change-password`
5. Token refreshed every 30 minutes via `/api/auth/refresh`

### Create User
1. Form with username, name, email, role dropdown, auto-generated password
2. Role list fetched from `/api/roles/{currentRole}/creatable`
3. SUPER_ADMIN: can create ADMIN and below
4. Organization dropdown from `/api/organizations`
5. Submit with re-auth → `POST /api/users`

### Rule Chain Editor
1. Visual canvas using ReactFlow library
2. Drag nodes from palette → drop on canvas
3. Connect nodes by dragging edges between ports
4. Configure each node via side panel
5. Save → `PUT /api/rule-chains/:id` with nodes + connections
6. Debug mode shows execution trace per node
