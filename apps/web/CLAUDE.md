# DigiLog Web — Frontend

## Stack
React 19, Vite, TypeScript, Tailwind CSS 4, SWR, React Router 7, React Hook Form, Zod

## Directory Structure
- `src/main.tsx` — Entry point + router setup
- `src/components/ui/` — Reusable UI components (button, input, card, table, dialog, badge, select, dropdown-menu)
- `src/components/layout/` — App layout (sidebar, header, app-layout)
- `src/components/` — Shared components (error-boundary, reauth-dialog, require-role)
- `src/hooks/` — Custom hooks (use-auth, use-session, use-reauth, use-field-labels, use-branding, use-datetime-format)
- `src/lib/` — Utilities (api-client, swr-config, cn)
- `src/routes/` — Page components organized by feature:
  - `auth/` — Login, forgot password, change password
  - `dashboard.tsx` — Main dashboard
  - `users/` — User list, create, edit, reset requests
  - `config/` — All configuration pages (password-policy, datetime, branding, roles, role-privileges, sidebar, field-ids, user-id, backup, action-reauth, audit-templates, pagination)
  - `assets/` — Entity Explorer (`index.tsx`), Entity Template Manager (`templates.tsx`)
  - `audit/` — Audit trail
  - `notifications/` — Notifications
  - `profile/` — User profile

## Running
```bash
npm run dev          # Vite dev server on port 5173
npm run build        # Production build
```

## API Proxy
Vite proxies `/api` and `/uploads` requests to `http://localhost:3000` in development.

## Auth
JWT stored in localStorage. SWR fetches `/api/auth/me` to get current user. 401 responses redirect to `/login`.

## Password Fields
All password inputs use `secureField` prop to disable copy/paste/cut/drag/context-menu per 21 CFR Part 11 requirements. The `reauth-dialog` component includes a show/hide toggle button for the password field.

## Reauth Dialog
`src/components/reauth-dialog.tsx` — Modal for re-authentication before sensitive actions. Features show/hide password toggle with eye icon, auto-resets visibility state when dialog closes. Pattern: `reauth.execute('ACTION_NAME', callback, { onSuccess, onError })`.

**Important:** The `useReauth` hook (`src/hooks/use-reauth.ts`) fetches `/api/config/action-reauth/my-actions` via SWR (30s dedup). If the action is NOT configured for reauth, it calls the callback directly (no dialog). All `reauth.execute` calls MUST be `await`-ed to prevent saving state race conditions.

## Configuration Pages
All config pages under `src/routes/config/` import their data definitions from `@digilog/shared`:
- `roles.tsx` — imports `PERMISSION_CATEGORIES` (no hardcoded permission lists)
- `role-privileges.tsx` — imports `FEATURE_PRIVILEGES`, `FEATURE_PRIVILEGE_CATEGORIES`. Has `CATEGORY_COLORS` map with entries for all 3 categories: User Management (blue), System (purple), Entity Management (teal). New categories added to `FEATURE_PRIVILEGES` must also be added to `CATEGORY_COLORS` or the page will crash.
- `sidebar.tsx` — imports `SIDEBAR_ITEMS`
- `action-reauth.tsx` — imports `REAUTH_ACTIONS`, `REAUTH_ACTION_CATEGORIES`
- `audit-templates.tsx` — imports `AUDIT_TEMPLATE_DEFAULTS`, `AUDIT_TEMPLATE_CATEGORIES`
- `field-ids.tsx` — fully dynamic, fetches from `/api/config/field-ids`
To add new items to any config page, update the shared package — not the frontend component.

## Entity Pages
- **Entity Explorer** (`/assets`, `src/routes/assets/index.tsx`): Split panel with fixed-width tree (320px) on left + detail panel on right. Tree/list view toggle. 4-step Add Entity wizard (select template -> basic info -> fill attributes -> review). Template selector fetches ALL templates (no `isActive` filter) so entity instances can be created from any template. Step 3 dynamically renders type-aware inputs based on template's attributeSchema (number inputs for INTEGER/FLOAT with constraints, date pickers for DATE/DATETIME, dropdowns for DROPDOWN, toggles for BOOLEAN). Link Entities dialog for relationships (bidirectional with auto-inverse, all relationship types freely available). Entity detail panel with 5 tabs (Overview, Attributes, Relationships, Identifiers, Audit History). Edit and delete dialogs with reauth. Cascade soft-delete for parent entities.
- **Entity Template Manager** (`/assets/templates`, `src/routes/assets/templates.tsx`, ~1410 lines): CRUD for entity templates. 6-section editor (Basic Info, Attributes, Telemetry, Identifiers, Relationships, Status Lifecycle). Numeric constraints panel for INTEGER/FLOAT with min/max/resolution and valid values preview. Attribute data types: TEXT, INTEGER, FLOAT, DATE, DATETIME, BOOLEAN, DROPDOWN, URL, FILE. Telemetry data types: INTEGER, FLOAT, BOOLEAN, STRING, ENUM. Alarm rules with types (HIGH, LOW, HIGH_HIGH, LOW_LOW, RATE_OF_CHANGE, BOOLEAN_STATE, CUSTOM) and severities (WARNING, ALARM, CRITICAL). Template versioning indicator shows current version.
### Dynamic Tree Diagram (Entity Explorer, Relationships Tab)
Interactive hierarchical tree diagram showing CONTAINS relationship hierarchy:
- **Sidebar Tree Nodes** — 3 hover action buttons:
  - Green "+" → Create new child entity (opens Add Entity wizard with parentId pre-set)
  - Blue link icon → Attach existing entity as child (opens search dialog, creates CONTAINS relationship)
  - Red "x" → Unlink from parent (sets parentId to null, only shows if node has parentId)
- **Diagram Tree Nodes** — 3 hover action buttons:
  - Green circle → Create new child (via `onAddChild`)
  - Blue circle → Attach existing entity (via `onAttachExisting`, creates CONTAINS relationship)
  - Red circle → Remove from tree (via `onRemoveFromDiagram`, deletes CONTAINS relationship — does NOT delete entity)
- **Link Entities Dialog** — Shows radio buttons for each relationship type, all freely available

### Attach Existing Entity Dialog
Full modal dialog for attaching an existing entity as a child node:
- Search input with debounce
- Radio-button entity list with template badge
- Preview of selected entity
- Creates CONTAINS relationship on confirm
- Reauth-protected via `CREATE_ASSET_RELATIONSHIP`

### Toast Notification System
Global toast system using React Context. Components:
- `src/components/ui/toast.tsx` — Toast container with 4 variants (success/error/warning/info), auto-dismiss
- `src/hooks/use-toast.ts` — `useToast()` hook providing `toast.success()`, `.error()`, `.warning()`, `.info()`
- `src/components/toast-provider.tsx` — Provider wrapping the app
Applied to relationship operations (create, delete, attach, remove from tree).

### Entity Template View Dialog
Read-only detail view in Entity Template Manager (`/assets/templates`):
- Eye icon button in table actions column
- Shows: Basic Info, Attributes table, Telemetry table, Expected Identifiers, Alarm Rules
- "Edit Template" button transitions to edit dialog

### Connection Status Cards
Overview tab in Entity Explorer shows 4 connection cards:
- Connections Allowed / Connections Used (from template's `maxConnections`)
- Parent Connections Allowed / Parent Connections Used (from template's `maxParentConnections`)
Cards include progress bars with green/red color coding.

## API Response Handling
Paginated API responses return `{ data: [], total, page, limit, totalPages }`. SWR types must match:
```tsx
// CORRECT — unwrap the data array
const { data: res } = useSWR<{ data: Item[] }>('/api/items');
const items = res?.data ?? [];

// WRONG — causes "o.filter is not a function" at runtime
const { data: items } = useSWR<Item[]>('/api/items');
```
Tree endpoints return plain arrays (no wrapper object).

## Sidebar Navigation
Sidebar items defined in `src/components/layout/sidebar.tsx` with matching IDs in `packages/shared/src/types/sidebar-items.ts`. Items: dashboard, users, assets ("Entities"), asset-templates ("Entity Templates"), configuration, notifications, audit. Active state uses exact match for `/assets` (not startsWith) to avoid highlighting "Entities" when on `/assets/templates` ("Entity Templates").

## Performance Patterns
- **Search inputs**: Always debounce with 300ms delay to prevent excessive API calls
- **SWR loading states**: Always check `isLoading` before showing "no data" messages
- **Bundle splitting**: Vendor and SWR chunks are split via `vite.config.ts` manualChunks
- **Memoization**: Use `useMemo`/`useCallback` for expensive computations in list views
- **useRef**: Always pass initial value `useRef<T>(undefined)` — newer TypeScript/React requires it
