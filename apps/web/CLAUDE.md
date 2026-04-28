# DigiLog Web — CLAUDE.md

## Overview
React 19 SPA built with Vite 6. In dev it runs on the Vite dev server (port 5175). For production-style builds it outputs to `apps/web/dist/`, which is also what Capacitor copies into the Android APK.

## Build & Deploy
```bash
# Local Development (Windows)
cd apps/web && npx vite --host         # Dev server on port 5175

# Build (for Nginx serving or APK packaging)
cd apps/web && npx vite build          # Outputs to apps/web/dist/

# Update APK with the latest build
cd apps/android && npx cap copy android
cd apps/android/android && ./gradlew assembleDebug
```

## Key Paths
- Source: `apps/web/src/`
- Entry: `apps/web/src/main.tsx`
- Routes: `apps/web/src/routes/` (20+ page modules)
- Hooks: `apps/web/src/hooks/` (auth, branding, datetime, pagination, reauth, session, single-tab, toast, field-labels)
- Components: `apps/web/src/components/` (layout, UI primitives, dialogs)
- API Client: `apps/web/src/lib/api-client.ts`

## Architecture
- React Router v6 with AppLayout wrapper for auth + session management
- SWR for data fetching with auto-revalidation
- ReactFlow for rule chain visual editor and cleaning profile pipeline editor
- Tailwind CSS (no component library) — unified light theme throughout
- Lazy-loaded heavy pages (assets, rule chains, alarms, UNS, checklists, filter management, etc.)
- Permission-based route guards via `<RequireRole permissions={[PERMISSIONS.*]}>`

## Auth Flow
- Token stored in sessionStorage (not localStorage — for shared workstation security)
- Auto-redirect to `/` (dashboard) after login, or returnUrl from query param
- 30-minute JWT refresh cycle
- Session timeout warning dialog
- Single-tab enforcement per user (BroadcastChannel)
- Force login (`force: true`) to terminate existing sessions

## Key Features
- 26 config pages (auto-discovered from registry)
- Entity tree with drag-and-drop hierarchy
- Rule chain editor with 77 node types across 8 categories
- Alarm dashboard with real-time updates and role-based column visibility
- Mobile-optimized checklist at `/checklist/:entityId` (standalone layout, no sidebar)
- Notification system (email/SMS/Telegram/Slack)
- Debug trace page for pipeline visibility

## Theme
- Unified light theme: bg-white cards, bg-slate-50 sections, border-slate-200
- Gradient dialog headers are acceptable
- No dark theme anywhere in the application

## Frontend Pages
admin-requests, alarms, assets (dialogs/tabs/hooks), audit, auth, checklist, checklists, cleaning-cycles (history/timeline), config (branding/notification-rules/notification-settings/roles), debug, filter-management (operations/profiles/status/scan/traceability/AHU-dashboard/cleaning-profile-editor/retirement/replacement/bulk-upload/equipment), mobile, notifications, pm-schedules, profile, rule-chains, system-health, tenant, users

## Phase 2 Pages
- `routes/filter-management/filter-operations.tsx` — Main operations page (8 stages, scan, checklist dialog, reason selection)
- `routes/filter-management/cleaning-profile-editor.tsx` — Visual pipeline editor (canvas, drag, wire, properties panel)
- `routes/filter-management/cleaning-profile-list.tsx` — Profile list with status badges
- `routes/filter-management/filter-profile-list.tsx` — Filter profile management
- `routes/filter-management/ahu-dashboard.tsx` — AHU filter set view with equipment groups
- `routes/filter-management/filter-traceability.tsx` — Per-filter history with full event timeline
- `routes/filter-management/filter-status.tsx` — Filter status overview
- `routes/filter-management/filter-scan.tsx` — QR/barcode scan for filter identification
- `routes/filter-management/retirement.tsx` — Filter retirement workflow
- `routes/filter-management/replacement.tsx` — Filter replacement workflow
- `routes/filter-management/bulk-upload.tsx` — CSV bulk import for filters
- `routes/filter-management/equipment.tsx` — Equipment group management
- `routes/cleaning-cycles/history.tsx` — Expandable cycle history
- `routes/cleaning-cycles/timeline.tsx` — Cycle event timeline with performer names
- `routes/checklists/list.tsx` — Checklist profile list
- `routes/checklists/detail.tsx` — Checklist detail with questions
- `routes/pm-schedules/` — PM schedule pages with monthly entries
- `routes/config/filter-lifecycle.tsx` — Lifecycle state config
- `routes/config/filter-cleaning-reasons.tsx` — Cleaning reasons config

### Phase 2 Patterns
- All routes wrapped in `<RequireRole permissions={[PERMISSIONS.ASSET_READ]}>` or more specific permissions
- SWR for data fetching with refresh intervals
- Toast notifications for success/error (not alert())
- Checklist dialog: no skip, no backdrop dismiss, mandatory submission
- Pipeline editor uses ReactFlow with custom node types (START, END, STAGE, CHECKLIST)
- Stage types: WASH_IN, WASH_OUT, DRY_IN, DRY_OUT, STORAGE_IN, STORAGE_OUT

---

## Phase 3 Update (2026-04-07)

**RFID & Offline Operations:**
- RFID Scanner Android app (`rfid_scan_app/`) for KC-series UHF readers
- RFID keyboard guard prevents UKB tag input leaking into random fields
- Offline cleaning operations via IndexedDB queue + sync engine
- Cached identifier→filter map for offline RFID lookup
- "Data Synced" indicator in mobile header
- One identifier per entity (backend-enforced)
- Responsive layout with collapsible sidebar
- Error popups replace inline banners
- User creation auto-assigns org for admins
- `/api/roles/active` public endpoint for contact-admin page

See `CHANGELOG.md` for full details.

---

## Phase 4 Update (2026-04-14)

**Configurable Color Themes:**
- 10 presets in `lib/themes.ts`, applied via CSS custom properties
- Theme selector on Branding page, `use-branding` hook applies on load
- Replaced hardcoded cyan/teal with CSS vars on: filter-list, PM schedules, dashboard, approvals, checklists, cleaning profiles

**Granular Permissions:**
- SUPER_ADMIN bypasses all frontend permission checks
- 7 pages have `isSuperAdmin || perms.includes()` pattern
- Feature toggles: Filters Page Controls, Checklist/Cleaning Profile/Equipment Group/PM Page Controls

**Report Settings:**
- `hooks/use-report-config.ts` — fetches report layout settings
- `components/report-page-wrapper.tsx` — wraps report tables with header/footer
- Applied to: Audit Trail, Cleaning Cycle History, Filter Traceability
- Config page: `routes/config/report-settings.tsx`

**Reauth Fixes:**
- Added `useReauth` + `ReauthDialog` to checklists (list + detail) and cleaning profiles (list + editor)
- Reauth dialog: password autofill prevention, focus management on close
