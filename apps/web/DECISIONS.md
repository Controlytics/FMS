# Frontend Architecture Decisions

## 1. Custom UI Components (not full Shadcn CLI install)
**Decision:** Built lean custom UI components (Button, Input, Card, Table, Dialog, Badge, Select, DropdownMenu) following Shadcn/ui patterns.
**Rationale:** Shadcn CLI requires project initialization and pulls in many dependencies (Radix UI, etc.). For Phase 1, the UI needs are well-defined: forms, tables, cards, dialogs. Custom components using Tailwind CSS give us full control, smaller bundle, and zero external UI deps. Components follow Shadcn patterns (variant props, cn() utility, forwardRef) so migration to full Shadcn is straightforward later.

## 2. SWR for Data Fetching (not React Query)
**Decision:** SWR for server state management.
**Rationale:** Per the Phase 1 tech stack doc. SWR is simpler, smaller, and sufficient for Phase 1. Its `useSWR` hook with a global fetcher config provides automatic caching, deduplication, and revalidation. React Query's extra features (mutations, infinite queries, devtools) aren't needed yet.

## 3. Vite Proxy for API (not CORS in dev)
**Decision:** Vite dev server proxies `/api` to the backend at `localhost:3000`.
**Rationale:** Avoids CORS issues in development entirely. The frontend makes requests to the same origin (e.g., `fetch('/api/users')`), and Vite transparently proxies to the backend. In production, a reverse proxy (nginx) would handle this.

## 4. localStorage for JWT (not httpOnly cookies)
**Decision:** Store JWT access token in `localStorage`.
**Rationale:** Simpler SPA architecture. The token is sent via `Authorization: Bearer` header. HttpOnly cookies would require CSRF protection and complicate the API client. XSS is mitigated by CSP headers and React's built-in escaping. This can be upgraded to httpOnly cookies + refresh token rotation in a later phase.

## 5. Password Field Security via secureField Prop
**Decision:** Custom `secureField` prop on `<Input>` that disables copy/paste/cut/drag/context-menu.
**Rationale:** 21 CFR Part 11 requires that password fields prevent clipboard operations. Rather than wrapping every password input, a single prop handles all security restrictions. Applied on login, create user, change password, and re-auth forms.

## 6. Role-Based Sidebar Navigation
**Decision:** Sidebar nav items are filtered client-side based on `user.role` and server-side sidebar config.
**Rationale:** Each nav item has an optional `defaultRoles` array — if present, only those roles see the item by default. If the user has a custom sidebar config (from `/api/config/my-config`), that takes precedence. Server still enforces permissions on every API call, so this is a UX convenience, not a security boundary.

## 7. Flat Route Structure (not nested feature folders)
**Decision:** Routes are organized as `routes/[feature]/[page].tsx` with a flat router in `main.tsx`.
**Rationale:** With ~20 pages, a flat router in main.tsx is easy to understand. All routes are visible in one place. Nested routing/code-splitting can be added when the app grows.

## 8. React Hook Form + Zod (shared schemas)
**Decision:** Forms use React Hook Form with `@hookform/resolvers/zod` and import schemas from `@digilog/shared`.
**Rationale:** Same Zod schemas validate on both client and server. No duplication. React Hook Form minimizes re-renders and provides built-in dirty/touched/error tracking. The resolver bridges Zod validation into RHF's error system automatically.

## 9. Dynamic Role Data from API (not hardcoded constants)
**Decision:** Pages that display roles (Role Privileges, Action Re-auth, User Create/Edit dropdowns) fetch from `/api/roles/active` instead of importing the hardcoded `ROLES` constant.
**Rationale:** Custom roles created by SUPER_ADMIN must appear in all role-related UI without code changes. Hardcoded role maps (labels, colors, icons) have fallback values for custom roles. The SWR call uses `revalidateOnMount: true` and `dedupingInterval: 0` to ensure freshness.

## 10. SWR Global Cache Invalidation with Filter Functions
**Decision:** When roles/assets are created/updated/deleted, use `useSWRConfig().mutate(key => key.startsWith('/api/...'))` instead of invalidating specific keys.
**Rationale:** Multiple SWR hooks consume data under different keys (e.g., `/api/roles`, `/api/roles/active`, `/api/assets/templates`, `/api/assets/instances/tree`). A filter-based global mutate ensures ALL related caches are invalidated in one call, preventing stale data across the app.

## 11. Paginated API Response Unwrapping
**Decision:** SWR types must match the API response shape. Paginated endpoints return `{ data: [], total, page, limit, totalPages }`, not raw arrays.
**Rationale:** The API wraps paginated results in a standard envelope. The frontend must type SWR calls as `useSWR<{ data: T[] }>('/api/...')` and extract `res?.data`. Using `useSWR<T[]>` directly causes runtime crashes (`o.filter is not a function`) because the response object has no `.filter` method.

## 12. Asset Explorer Split Panel Layout
**Decision:** The Asset Explorer uses a fixed-width tree panel (320px) on the left with a detail panel on the right, plus a toggle for list view.
**Rationale:** Asset hierarchies need visual tree navigation for CONTAINS relationships, but flat list view is essential for search/filter operations across all assets. The split panel gives both options. Detail panel uses 5 tabs (Overview, Attributes, Relationships, Identifiers, Audit) to organize the rich asset data without overwhelming the user.

## 13. Multi-Step Add Asset Wizard
**Decision:** Creating an asset is a 4-step wizard: Select Template -> Basic Info -> Fill Attributes -> Review & Create.
**Rationale:** Asset creation requires multiple decisions (which template, parent, attribute values). A single long form would be overwhelming. The wizard breaks it into digestible steps. Step 3 dynamically renders type-aware inputs (number inputs for INTEGER/FLOAT with constraints, date pickers for DATE/DATETIME, dropdowns for DROPDOWN type, toggles for BOOLEAN) based on the selected template's attribute schema.

## 14. Sidebar Active State: Exact Match for Parent Routes
**Decision:** The `/assets` sidebar item uses exact pathname match (`location.pathname === '/assets'`) instead of `startsWith('/assets')`.
**Rationale:** Without exact matching, navigating to `/assets/templates` would highlight both "Assets" and "Asset Templates" in the sidebar, since both paths start with `/assets`. Exact match for the parent route ensures only the correct item is highlighted.

## 15. Reauth Execute Must Be Awaited
**Decision:** All `reauth.execute()` calls must use `await` (i.e., `await reauth.execute('ACTION', callback, opts)`).
**Rationale:** Without `await`, the code after `reauth.execute` runs immediately, which can cause race conditions where state is saved (e.g., closing a dialog, clearing form data) before the reauth dialog is shown or the callback completes. This was a key bug fix that applies to all asset mutation flows (create, edit, delete, link, status change).

## 16. API Client Methods for Mutations
**Decision:** Frontend uses `apiClient.post()`, `apiClient.put()`, and `apiClient.delete()` for mutations instead of SWR's mutation helpers.
**Rationale:** SWR is designed for data fetching, not mutations. Using the API client directly for POST/PUT/DELETE gives explicit control over request bodies, error handling, and reauth password headers. SWR's `mutate()` is only used for cache invalidation after successful mutations.

## 17. Template Selector Shows All Templates (no isActive filter)
**Decision:** The Add Asset wizard's template selector fetches `/api/assets/templates?limit=100` without filtering by `isActive`.
**Rationale:** Users should be able to create assets from any template regardless of its active/inactive status. The `isActive` flag on templates controls whether the template itself can be edited or is retired, not whether assets can be created from it. Filtering by `isActive=true` would hide templates that still have valid schemas for asset creation.

## 18. Dynamic Tree Diagram with Inline Actions
**Decision:** The Relationships tab diagram tree has hover-action buttons (create child, attach existing, remove from tree) directly on each node, rather than a separate context menu.
**Rationale:** Direct action buttons reduce click count and make the tree interactive without modal overhead. Three distinct actions (green=create new, blue=attach existing, red=remove) use color coding for quick identification. The buttons only appear on hover to keep the tree clean. The "remove" action deletes the CONTAINS relationship (not the asset), with a confirm dialog.

## 19. Attach Existing Asset Dialog (Search + Select)
**Decision:** Attaching an existing asset to the tree uses a modal dialog with search input, radio-button asset list, and preview, rather than drag-and-drop.
**Rationale:** Drag-and-drop is difficult to implement in a nested tree and has poor accessibility. The search dialog allows finding assets by name across the entire system, shows template badge for context, and provides a clear preview before committing. Creates a CONTAINS relationship behind the scenes.

## 20. Linking Rule Enforcement in Link Assets Dialog
**Decision:** The Link Assets dialog fetches `/api/assets/linking-rules/validate` and visually disables disallowed relationship types (grayed out with lock icon) rather than hiding them.
**Rationale:** Showing all types but disabling blocked ones is more informative than hiding options silently. Users can see what's restricted and why (info banner explains "restricted by template linking rules" or "bypassed by role"). An auto-switch effect moves the selection to the first allowed type if the current selection becomes disallowed. This transparency aids compliance understanding.
