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
  - `config/` — All configuration pages (password-policy, datetime, branding, roles, role-privileges, sidebar, field-ids, user-id, backup, action-reauth, audit-templates, pagination, template-linking-rules)
  - `assets/` — Asset Explorer (`index.tsx`), Template Manager (`templates.tsx`)
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
- `roles.tsx` — imports `PERMISSION_CATEGORIES` (no hardcoded permission lists). Includes `allowCrossTemplateLinking` toggle in role create/edit dialogs
- `role-privileges.tsx` — imports `FEATURE_PRIVILEGES`, `FEATURE_PRIVILEGE_CATEGORIES`
- `sidebar.tsx` — imports `SIDEBAR_ITEMS`
- `action-reauth.tsx` — imports `REAUTH_ACTIONS`, `REAUTH_ACTION_CATEGORIES`
- `audit-templates.tsx` — imports `AUDIT_TEMPLATE_DEFAULTS`, `AUDIT_TEMPLATE_CATEGORIES`
- `field-ids.tsx` — fully dynamic, fetches from `/api/config/field-ids`
- `template-linking-rules.tsx` — SUPER_ADMIN page for managing template linking rules (CRUD). Source/target template dropdowns, relationship type multi-select, scope selector (GLOBAL/ROLE/USER), reauth-protected mutations

To add new items to any config page, update the shared package — not the frontend component.

## Asset Pages
- **Asset Explorer** (`/assets`, `src/routes/assets/index.tsx`, ~2993 lines): Split panel with fixed-width tree (320px) on left + detail panel on right. Tree/list view toggle. 4-step Add Asset wizard (select template -> basic info -> fill attributes -> review). Template selector fetches ALL templates (no `isActive` filter) so assets can be created from any template. Step 3 dynamically renders type-aware inputs based on template's attributeSchema (number inputs for INTEGER/FLOAT with constraints, date pickers for DATE/DATETIME, dropdowns for DROPDOWN, toggles for BOOLEAN). Link Assets dialog for relationships (bidirectional with auto-inverse) with linking rule enforcement (disabled types, info banners). Asset detail panel with 5 tabs (Overview, Attributes, Relationships, Identifiers, Audit History). Edit and delete dialogs with reauth. Cascade soft-delete for parent assets.
- **Template Manager** (`/assets/templates`, `src/routes/assets/templates.tsx`, ~1410 lines): CRUD for asset templates. 6-section editor (Basic Info, Attributes, Telemetry, Identifiers, Relationships, Status Lifecycle). Numeric constraints panel for INTEGER/FLOAT with min/max/resolution and valid values preview. Attribute data types: TEXT, INTEGER, FLOAT, DATE, DATETIME, BOOLEAN, DROPDOWN, URL, FILE. Telemetry data types: INTEGER, FLOAT, BOOLEAN, STRING, ENUM. Alarm rules with types (HIGH, LOW, HIGH_HIGH, LOW_LOW, RATE_OF_CHANGE, BOOLEAN_STATE, CUSTOM) and severities (WARNING, ALARM, CRITICAL). Template versioning indicator shows current version.
- **Template Linking Rules** (`/config/template-linking-rules`, `src/routes/config/template-linking-rules.tsx`, ~449 lines): SUPER_ADMIN config page for defining which template types can link together. Table with source/target template names, allowed relationship badges, scope, actions. Add/edit dialog with template dropdowns, relationship checkboxes, scope selector. Reauth-protected create/update/delete.

### Dynamic Tree Diagram (Asset Explorer, Relationships Tab)
Interactive hierarchical tree diagram showing CONTAINS relationship hierarchy:
- **Sidebar Tree Nodes** — 3 hover action buttons:
  - Green "+" → Create new child asset (opens Add Asset wizard with parentId pre-set)
  - Blue link icon → Attach existing asset as child (opens search dialog, creates CONTAINS relationship)
  - Red "x" → Unlink from parent (sets parentId to null, only shows if node has parentId)
- **Diagram Tree Nodes** — 3 hover action buttons:
  - Green circle → Create new child (via `onAddChild`)
  - Blue circle → Attach existing asset (via `onAttachExisting`, creates CONTAINS relationship)
  - Red circle → Remove from tree (via `onRemoveFromDiagram`, deletes CONTAINS relationship — does NOT delete asset)
- **Link Assets Dialog** — Relationship type enforcement:
  - Fetches linking rules via `/api/assets/linking-rules/validate`
  - Shows radio buttons for each forward relationship type
  - Disabled styling + lock icon for types blocked by rules
  - Info banners when rules apply or role bypasses rules
  - Auto-switch effect when current selection becomes disallowed

### Attach Existing Asset Dialog
Full modal dialog for attaching an existing asset as a child node:
- Search input with debounce
- Radio-button asset list with template badge
- Preview of selected asset
- Creates CONTAINS relationship on confirm
- Reauth-protected via `CREATE_ASSET_RELATIONSHIP`

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
Sidebar items defined in `src/components/layout/sidebar.tsx` with matching IDs in `packages/shared/src/types/sidebar-items.ts`. Items: dashboard, users, assets, asset-templates, configuration, notifications, audit. Active state uses exact match for `/assets` (not startsWith) to avoid highlighting when on `/assets/templates`.

## Performance Patterns
- **Search inputs**: Always debounce with 300ms delay to prevent excessive API calls
- **SWR loading states**: Always check `isLoading` before showing "no data" messages
- **Bundle splitting**: Vendor and SWR chunks are split via `vite.config.ts` manualChunks
- **Memoization**: Use `useMemo`/`useCallback` for expensive computations in list views
- **useRef**: Always pass initial value `useRef<T>(undefined)` — newer TypeScript/React requires it
