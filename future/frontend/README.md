# Frontend — Quick Tour

**Location:** `apps/web/`
**Tech:** React 19 + Vite 6 + TailwindCSS 4 + SWR + React Router 7 + react-hook-form + zod.
**Entry:** `apps/web/src/main.tsx`
**Dev:** `cd apps/web && npm run dev` → Vite on port 5173
**Build:** `npm run build` (tsc -b + vite build) → output to `apps/web/dist/` (served by Nginx in prod; packaged into the APK by Capacitor)

## Directory map

```
apps/web/src/
├── main.tsx            Router, global providers (ErrorBoundary, ToastProvider, SWRConfig, BrowserRouter), 70+ routes
├── app.css             Tailwind entry
├── components/
│   ├── layout/          app-layout, header, sidebar (hamburger <lg)
│   ├── ui/              alarm-badge, badge, button, card, code-snippet, connectivity-indicator, dialog, error-popup, help-button, input, select, table, toast
│   ├── error-boundary.tsx, route-error-boundary.tsx
│   ├── reauth-dialog.tsx           21 CFR reauth
│   ├── report-page-wrapper.tsx     Consistent report header/footer/pagination driven by report settings
│   ├── require-role.tsx            Route permission + role gate
│   └── toast-provider.tsx
├── hooks/
│   ├── use-auth.ts                  Current user + login/logout
│   ├── use-branding.ts              Applies theme CSS variables to :root
│   ├── use-datetime-format.ts       User-configured date formatting
│   ├── use-entity-websocket.ts      Subscribes to /api/ws for per-entity updates
│   ├── use-field-labels.ts          Config-driven field label overrides
│   ├── use-offline.ts               `executeOrQueue()` + online/pending/syncing state
│   ├── use-pagination-config.ts
│   ├── use-reauth.ts                Wraps actions in reauth-dialog flow
│   ├── use-report-config.ts
│   ├── use-rfid-guard.ts            Global keydown interceptor, blocks RFID UKB bursts outside data-rfid fields
│   ├── use-role-colors.ts
│   ├── use-session.ts
│   ├── use-single-tab.ts            Disables duplicate tabs for auditability
│   └── use-toast.ts
├── lib/
│   ├── api-client.ts                fetch wrapper, Authorization header, maps `details` → `connectionInfo`
│   ├── cn.ts                        `clsx` + `tailwind-merge`
│   ├── offline-store.ts             IndexedDB: operations queue, cache, filters
│   ├── offline-sync-service.ts      Batched offline sync orchestration
│   ├── sync-engine.ts               auto-sync on reconnect, FIFO replay
│   ├── swr-config.ts                Default fetcher + revalidation policy
│   ├── themes.ts                    10 preset themes
│   ├── theme-styles.ts
│   ├── pdf-report.ts                Client-side PDF helpers
│   ├── password-utils.ts, filter-constants.ts, format-by-least-count.ts, url-utils.ts
├── routes/
│   ├── auth/                        login, forgot-password, change-password, contact-admin
│   ├── mobile/                      mobile-login, mobile-wrapper, mobile-operations
│   ├── dashboard.tsx
│   ├── profile/, users/, admin-requests/, approvals/
│   ├── assets/, filter-management/, cleaning-cycles/, my-tasks/, pm-schedules/
│   ├── checklist/, checklists/, rule-chains/, report-templates/, reports/
│   ├── alarms/, audit/, notifications/, system-health/, debug/
│   ├── tenant/                      super-admin org management
│   └── config/                      30+ config pages (branding, roles, field-ids, reauth, audit-templates, etc.)
└── types/                           Ambient typings
```

## Routing model

- Single top-level `<BrowserRouter>` in `main.tsx`.
- Public routes: `/login`, `/forgot-password`, `/change-password`, `/contact-admin`.
- Mobile routes: `/m/login`, `/m` (wrapper → operations). Deliberately separate so the APK can land on `/m` without sidebar chrome.
- Authenticated routes: nested inside an `<AppLayout>` wrapper (sidebar + header + reauth dialog + toast). Each route is wrapped with `<RequireRole permissions={[…]} roles={[…]}>` — permissions from `@digilog/shared`'s `PERMISSIONS` constants.
- Heavy routes are lazy-loaded with `React.lazy` + `<Suspense fallback={<LazyFallback />}>` to keep the initial bundle small.
- Standalone checklist form (`/checklist/:entityId`) mounts **outside** `AppLayout` so devices can use it without the admin UI.

## Permissions model

- `RequireRole` reads `useAuth()` and checks two things: is the user a `SUPER_ADMIN` (always allowed), or do their permissions include any of the listed permissions / does their role match any of the listed roles.
- `SUPER_ADMIN` bypass is intentional and matches backend behaviour.
- Frontend visibility gating is defense-in-depth — the backend still enforces permission on every protected route.
- Memory rule: feature toggles **must** map to both the frontend visibility permission **and** the backend route permission in `FEATURE_TO_PERMISSION_MAP`.

## Offline model (short version)

1. `offline-store.ts` opens an IndexedDB (`digilog-offline`) with stores for operations, cache, and filters.
2. Pages use `useOffline()` to get `online`, `pendingCount`, `syncing` — and to call `executeOrQueue(fn, fallback)`.
3. When offline, mutations are validated against the cached pipeline graph and queued with an `offlinePerformedAt` timestamp.
4. On reconnect, `sync-engine.ts` replays the queue FIFO; the backend accepts an `x-offline-replay: true` header and uses `offlinePerformedAt` for the event time.
5. Conflicts (e.g., server state has diverged) are skipped, surfaced in the UI, and logged.
6. `navigator.onLine` is **unreliable** on Capacitor WebViews — use the `/api/health` poll every 15 s + `visibilitychange` (already implemented in `use-offline.ts`).

Full architecture: `OFFLINE_SYNC_ARCHITECTURE.md` at repo root.

## Theme model (short version)

- 10 presets defined in `lib/themes.ts` (Ocean, Sapphire, Emerald, Amethyst, Sunset, Slate, Ruby, Forest, Midnight, Coral).
- `applyTheme(name)` sets CSS variables on `:root`: `--theme-primary`, `--theme-gradient-from`, `--theme-gradient-to`, `--theme-focus-ring`.
- `use-branding.ts` runs on app boot, reads `/api/config/branding`, and calls `applyTheme()`.
- All pages share the same theme — **do not** use per-page colors (user memory rule: "unified cyan/teal theme, no different colors per page" applies — pick the active preset and stick with it).

## RFID model

- Global `useRfidGuard()` is wired in `AppLayout`.
- Fields that should accept RFID input must have `data-rfid="true"`. The guard discards keyboard bursts targeted at other fields.
- Scan dialogs (filter scan, RFID assign) debounce scans at 300 ms and dedup repeated tags.
- Offline tag lookup works via the cached identifier map (`identifier-map` in offline-store).

## Testing locally against the APK

The APK bakes in `https://192.168.1.22:3000`. Adjust your dev box IP or rebuild if you want to hit a different host. For pure-web testing, `http://localhost:5173` with `cd apps/web && npm run dev`.

## Where to read next

- `KEY_FILES.md` — annotated pointer to every non-obvious frontend file.
- `PATTERNS.md` — how to write new pages that fit the existing patterns (offline, permissions, themes, errors).
