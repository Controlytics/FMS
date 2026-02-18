# Frontend Architecture Decisions

## 1. Custom UI Components (not full Shadcn CLI install)
**Decision:** Built lean custom UI components (Button, Input, Card, Table, Dialog, Badge, Select) following Shadcn/ui patterns.
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
**Decision:** Sidebar nav items are filtered client-side based on `user.role`.
**Rationale:** Simple approach for Phase 1's fixed role set. Each nav item has an optional `roles` array — if present, only those roles see the item. Server still enforces permissions on every API call, so this is a UX convenience, not a security boundary.

## 7. Flat Route Structure (not nested feature folders)
**Decision:** Routes are organized as `routes/[feature]/[page].tsx` with a flat router in `main.tsx`.
**Rationale:** With ~15 pages in Phase 1, a flat router in main.tsx is easy to understand. All routes are visible in one place. Nested routing/code-splitting can be added when the app grows.

## 8. React Hook Form + Zod (shared schemas)
**Decision:** Forms use React Hook Form with `@hookform/resolvers/zod` and import schemas from `@digilog/shared`.
**Rationale:** Same Zod schemas validate on both client and server. No duplication. React Hook Form minimizes re-renders and provides built-in dirty/touched/error tracking. The resolver bridges Zod validation into RHF's error system automatically.

## 9. Dynamic Role Data from API (not hardcoded constants)
**Decision:** Pages that display roles (Role Privileges, Action Re-auth, User Create/Edit dropdowns) fetch from `/api/roles/active` instead of importing the hardcoded `ROLES` constant.
**Rationale:** Custom roles created by SUPER_ADMIN must appear in all role-related UI without code changes. Hardcoded role maps (labels, colors, icons) have fallback values for custom roles. The SWR call uses `revalidateOnMount: true` and `dedupingInterval: 0` to ensure freshness.

## 10. SWR Global Cache Invalidation with Filter Functions
**Decision:** When roles are created/updated/deleted, use `useSWRConfig().mutate(key => key.startsWith('/api/roles'))` instead of invalidating specific keys.
**Rationale:** Multiple SWR hooks consume role data under different keys (`/api/roles`, `/api/roles/active`, `/api/roles/:name/creatable`). A filter-based global mutate ensures ALL role-related caches are invalidated in one call, preventing stale data across the app.
