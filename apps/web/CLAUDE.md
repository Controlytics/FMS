# DigiLog Web — Frontend

## Stack
React 19, Vite, TypeScript, Tailwind CSS 4, SWR, React Router 7, React Hook Form, Zod

## Directory Structure
- `src/main.tsx` — Entry point + router setup
- `src/components/ui/` — Reusable UI components (button, input, card, table, dialog, badge, select)
- `src/components/layout/` — App layout (sidebar, header, app-layout)
- `src/components/` — Shared components (error-boundary, reauth-dialog, require-role)
- `src/hooks/` — Custom hooks (use-auth, use-session, use-reauth, use-field-labels)
- `src/lib/` — Utilities (api-client, swr-config, cn)
- `src/routes/` — Page components organized by feature

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
`src/components/reauth-dialog.tsx` — Modal for re-authentication before sensitive actions. Features show/hide password toggle with eye icon, auto-resets visibility state when dialog closes.

## Configuration Pages
All config pages under `src/routes/config/` import their data definitions from `@digilog/shared`:
- `roles.tsx` — imports `PERMISSION_CATEGORIES` (no hardcoded permission lists)
- `role-privileges.tsx` — imports `FEATURE_PRIVILEGES`, `FEATURE_PRIVILEGE_CATEGORIES`
- `sidebar.tsx` — imports `SIDEBAR_ITEMS`
- `action-reauth.tsx` — imports `REAUTH_ACTIONS`, `REAUTH_ACTION_CATEGORIES`
- `audit-templates.tsx` — imports `AUDIT_TEMPLATE_DEFAULTS`, `AUDIT_TEMPLATE_CATEGORIES`
- `field-ids.tsx` — fully dynamic, fetches from `/api/config/field-ids`

To add new items to any config page, update the shared package — not the frontend component.

## Performance Patterns
- **Search inputs**: Always debounce with 300ms delay to prevent excessive API calls
- **SWR loading states**: Always check `isLoading` before showing "no data" messages
- **Bundle splitting**: Vendor and SWR chunks are split via `vite.config.ts` manualChunks
- **Memoization**: Use `useMemo`/`useCallback` for expensive computations in list views
