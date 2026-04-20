# Frontend — Key Files

An annotated pointer to the files that a new contributor must know about. Everything else follows the conventions these establish.

## Bootstrap & global wiring

| File | Why it matters |
|---|---|
| `src/main.tsx` | The only router. Registers 70+ routes. `<ErrorBoundary>` → `<ToastProvider>` → `<SWRConfig>` → `<BrowserRouter>`. Lazy-loads every heavy route. |
| `src/app.css` | Tailwind entry. |
| `src/components/layout/app-layout.tsx` | Sidebar + header + outlet. Mounts `useRfidGuard()`, `use-branding`, `use-session`, single-tab check. |
| `src/components/layout/sidebar.tsx` | Permission-filtered sidebar. Reads `SIDEBAR_ITEMS` from `@digilog/shared` and filters by `SIDEBAR_PRIVILEGE_MAP`. Collapses to hamburger below `lg`. |
| `src/components/layout/header.tsx` | Notifications bell, unread count, connectivity/offline indicator, user menu. |
| `src/components/require-role.tsx` | Route gate. Reads `useAuth()`; super-admin bypass + any-of permissions + any-of roles. |
| `src/components/route-error-boundary.tsx` | Per-route error isolation so one page crashing doesn't take down the shell. |
| `src/components/reauth-dialog.tsx` | 21 CFR e-sig reauth popup. Wired via `use-reauth.ts`. |
| `src/components/report-page-wrapper.tsx` | Wraps printable pages (audit, cycles, traceability) with the configured header/footer/pagination. |
| `src/components/toast-provider.tsx` + `ui/toast.tsx` | Global toast. |
| `src/components/error-boundary.tsx` | Outer error boundary. |

## API client + data

| File | Why it matters |
|---|---|
| `src/lib/api-client.ts` | fetch wrapper. Adds `Authorization`, parses JSON, normalizes errors. **Maps backend's `details` → `connectionInfo` on errors** (required; backend convention). Exposes `.status` on errors so SWR can suppress 403s. |
| `src/lib/swr-config.ts` | Default fetcher, revalidate-on-focus rules, dedup interval. |

## Auth + session

| File | Why it matters |
|---|---|
| `src/hooks/use-auth.ts` | Main auth hook. `login`, `logout`, `user`, `permissions`, `isSuperAdmin`. |
| `src/hooks/use-session.ts` | Session lifecycle — auto-logout on session expiry, refresh handling. |
| `src/hooks/use-reauth.ts` | Wraps mutating actions with the reauth-dialog flow when the action is in the reauth-required list. |
| `src/hooks/use-single-tab.ts` | Enforces one-tab-per-session via BroadcastChannel for auditability. |
| `src/routes/auth/login.tsx` | Desktop login. Handles lockout, policy enforcement. |
| `src/routes/auth/contact-admin.tsx` | Public page that lists active roles via `/api/roles/active`. |

## Offline + RFID

| File | Why it matters |
|---|---|
| `src/lib/offline-store.ts` | IndexedDB wrapper. Stores: operations queue, filter cache, generic cache. |
| `src/lib/sync-engine.ts` | Auto-sync on reconnect, FIFO replay, event emitter. |
| `src/lib/offline-sync-service.ts` | Higher-level batching/state transitions for offline cycles. |
| `src/hooks/use-offline.ts` | Page-facing API: `online`, `pendingCount`, `syncing`, `executeOrQueue`. |
| `src/hooks/use-rfid-guard.ts` | Global keydown interceptor. Any keyboard burst that looks like an RFID read is blocked unless the target element has `data-rfid="true"`. |
| `src/routes/mobile/mobile-operations.tsx` | Tablet operations page. All cleaning actions wrap `executeOrQueue`. Same component serves both tablet and web (unified — do not fork it). |
| `src/routes/mobile/mobile-wrapper.tsx` | Mobile shell + stage cards. |
| `src/routes/mobile/mobile-login.tsx` | Tablet-specific login with cached-auth restore. |

## Theming & branding

| File | Why it matters |
|---|---|
| `src/lib/themes.ts` | 10 preset definitions (Ocean, Sapphire, Emerald, Amethyst, Sunset, Slate, Ruby, Forest, Midnight, Coral). |
| `src/lib/theme-styles.ts` | Helpers that produce class strings based on the active theme. |
| `src/hooks/use-branding.ts` | Applies theme CSS variables to `:root` on app boot. |
| `src/routes/config/branding.tsx` + `branding-components/` | Admin UI to change logo, company name, and theme preset. |

## Filter management (the core Phase-3/4 feature)

| File | Why it matters |
|---|---|
| `src/routes/filter-management/filter-operations.tsx` | Desktop + stage-URL variants share this component. The cycle state machine runs through here. Reauth, error popups, offline queue all wire in. |
| `src/routes/checklist/*` | Standalone checklist form — intentionally outside AppLayout. |
| `src/routes/cleaning-cycles/*` | History + timeline of cycles. |
| `src/routes/config/filter-cleaning-reasons.tsx`, `equipment-groups.tsx`, `cleaning-profile-assignment.tsx`, `ahu-filter-set-config.tsx` | Config pages specific to the filter domain. |
| `src/routes/pm-schedules/*` + `my-tasks/*` | PM schedule list + detail + per-user task views. |

## Admin / governance

| File | Why it matters |
|---|---|
| `src/routes/admin-requests/index.tsx` | Admin request creation + approver view. |
| `src/routes/approvals/index.tsx` | Approvals inbox (block-change + PM). |
| `src/routes/config/backup.tsx` | Dynamic backup/restore UI. |
| `src/routes/config/filter-data-management.tsx` | Super-admin data console (reaches `/api/super-admin/data/*`). |
| `src/routes/tenant/*` | Super-admin org management. |

## Reports

| File | Why it matters |
|---|---|
| `src/routes/reports/*` | List, generate, detail. Calls `/api/reports/*`. |
| `src/routes/report-templates/*` | Template list + editor. |
| `src/lib/pdf-report.ts` | Client-side PDF helpers (mostly for preview — the authoritative PDFs are produced server-side via Puppeteer). |

## Config surface

`src/routes/config/` has 30+ pages, one per config module. The pattern:

1. Each page fetches a `*/current` endpoint with SWR.
2. Renders a form via react-hook-form + zod resolvers (schema usually comes from `@digilog/shared`).
3. Submits a `PUT` that includes **only that tab's fields** — the backend preserves the rest.
4. Uses `useReauth()` if the module is in the reauth-required list.

## Things that are deliberately NOT in a component library

The repo does **not** use shadcn/ui or Radix. UI primitives in `components/ui/` are hand-rolled. If you need a new primitive, add it there — do not install a library.
