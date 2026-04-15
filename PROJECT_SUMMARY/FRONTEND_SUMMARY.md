# DigiLog Frontend Summary

**Path:** `apps/web/`
**Framework:** React 19 + TypeScript 5.7
**Build:** Vite 6.1 + Tailwind CSS 4.0
**Router:** React Router 7.1
**Data Fetching:** SWR 2.3
**Visual Editor:** ReactFlow 11.11
**Entry:** `apps/web/src/main.tsx`

---

## Scale

| Metric | Count |
|--------|-------|
| Route Pages (TSX) | 69 |
| Route Directories | 19 |
| React Router Routes | 70 |
| UI Components | 20 |
| Custom Hooks | 12 |
| Lib Files | 8 |
| Type Files | 1 |
| Config Pages | 29 |
| Filter Management Pages | 13 |
| Runtime Dependencies | 20 |
| Dev Dependencies | 9 |
| Protected Routes | 60+ |
| Public Routes | 4 |
| Mobile Routes | 2 |

---

## 19 Route Directories

| Directory | Pages | Purpose |
|-----------|-------|---------|
| admin-requests/ | 1 | User/admin request management |
| alarms/ | 1 | Real-time alarm dashboard |
| assets/ | 26 | Entity tree, templates, dialogs, tabs, hooks |
| audit/ | 6 | Audit trail with filters, detail modal, pagination |
| auth/ | 4 | Login, forgot password, change password, contact admin |
| checklist/ | 1 | Standalone checklist (no sidebar, mobile-friendly) |
| checklists/ | 2 | Checklist profile list + detail |
| cleaning-cycles/ | 2 | Cycle history + event timeline |
| config/ | 29 | All configuration pages (27 configs + roles + branding) |
| debug/ | 1 | Pipeline debug traces |
| filter-management/ | 13 | Operations, profiles, status, scan, traceability, editor, retirement, replacement, bulk-upload, AHU dashboard |
| mobile/ | 2 | Mobile login + mobile operations |
| notifications/ | 1 | Notification center |
| pm-schedules/ | 2 | PM schedule list + detail |
| profile/ | 1 | User profile settings |
| rule-chains/ | 2 | Rule chain list + visual editor (ReactFlow) |
| system-health/ | 1 | System health dashboard |
| tenant/ | 2 | Organizations list + org detail |
| users/ | 7 | User CRUD + reset requests + components |

---

## 20 UI Components

### Layout (3)
- `app-layout.tsx` — Main protected layout (auth, session, single-tab enforcement)
- `header.tsx` — Top nav with branding, notifications, user menu
- `sidebar.tsx` — Main navigation menu

### UI Primitives (12)
- button, input, select, dialog, card, badge, table, toast
- alarm-badge, connectivity-indicator, help-button, code-snippet

### System (5)
- `error-boundary.tsx` — Global error handler with componentDidCatch
- `route-error-boundary.tsx` — Route-level error handler
- `require-role.tsx` — Permission-based route guard
- `reauth-dialog.tsx` — Re-authentication modal
- `toast-provider.tsx` — Toast notification context

---

## 12 Custom Hooks

| Hook | Purpose |
|------|---------|
| use-auth | Login, logout, JWT refresh, user session |
| use-session | Idle timeout warning, auto-logout |
| use-single-tab | BroadcastChannel duplicate tab detection |
| use-toast | Toast notification triggers |
| use-branding | Custom theme colors from config |
| use-role-colors | Role-based color assignments |
| use-datetime-format | Date/time localization |
| use-field-labels | Field label translations |
| use-pagination-config | Pagination limits from config |
| use-reauth | Re-authentication flow for sensitive actions |
| use-offline | Offline mode detection, sync engine |
| use-entity-websocket | WebSocket entity updates |

---

## Authentication Flow

1. Login at `/login` → `POST /api/auth/login`
2. Token stored in sessionStorage (shared workstation security)
3. Auto-refresh JWT every 30 minutes
4. Session timeout: 15 min idle with 2-min warning dialog
5. Single-tab enforcement via BroadcastChannel
6. Force password change redirect on first login / expired password
7. 401 → auto-redirect to login with returnUrl
8. Re-auth required for destructive operations (password in header)

---

## Theme & Styling

- **Unified light theme** — no dark mode
- **Tailwind CSS 4.0** — utility-first, custom theme variables
- **Colors:** bg-white cards, bg-slate-50 sections, border-slate-200
- **Gradient dialog headers** — acceptable per design system
- **Custom-built UI** — no component library (no shadcn, Material-UI)
- **Icons:** lucide-react (1000+ SVG icons)
- **Charts:** recharts for dashboards
- **Visual editors:** ReactFlow for rule chains + cleaning profile pipelines

---

## PWA Support

- **Manifest:** "DigiLog - Filter Management", standalone display
- **Service worker:** Auto-update registration
- **Offline:** IndexedDB storage + sync engine
- **Start URL:** `/m` (mobile operations)
- **Icons:** 192x192 + 512x512 (PNG, maskable)
- **Workbox caching:** Static assets (cache-first), API (network-first, 5min expiry)

---

## Code Splitting

| Chunk | Contents |
|-------|----------|
| vendor | react, react-dom, react-router-dom |
| swr | swr |
| reactflow | reactflow |
| monaco | @monaco-editor/react |
| charts | recharts |
| qrcode | qrcode.react |

All heavy pages lazy-loaded with `React.lazy()` + `Suspense`.

---

## Phase 2 Filter Management Pages (13)

| Page | Route | Purpose |
|------|-------|---------|
| filter-operations | /filters | Main ops — 6 cleaning stages, scan, checklist, reason dialogs |
| cleaning-profile-list | /filter-cleaning-profiles | List profiles with status badges |
| cleaning-profile-editor | /filter-cleaning-profiles/:id/edit | Visual pipeline editor (ReactFlow canvas) |
| filter-list | /filter-list | Block → filter table with status, actions |
| filter-profile-list | /filter-profiles | Filter-to-profile assignments |
| filter-status | /filters (tab) | Filter status overview grid |
| filter-scan | /filters/:id/operate | QR/barcode scan for filter identification |
| filter-traceability | /filters/:id/trace | Per-filter event history timeline |
| retirement-list | /filter-retirements | Retired filters list |
| replacement-list | /filter-replacements | Replacement tracking |
| ahu-dashboard | /ahus/:id | AHU equipment group overview |
| + 5 dialog components | — | bulk-upload, checklist, cleaning-reason, equipment, stage-scan |

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

**Theme System:**
- `themes.ts` — 10 preset color themes (cyan, teal, blue, indigo, etc.) with CSS variable mappings
- CSS variables drive all theme colors (primary, accent, sidebar, header)
- `use-branding` hook reads branding config and applies selected theme globally

**Report Infrastructure:**
- `report-page-wrapper.tsx` — shared wrapper for all report/print pages with consistent header, footer, and layout
- `use-report-config` hook — reads report settings (logo, title, footer text) from `/api/config/report-settings/current`

**Granular Permission Checks:**
- 95 permission constants used for route guards and UI element visibility
- SUPER_ADMIN role bypasses all permission checks automatically
- 82 toggleable permission checkboxes in role editing UI

**Re-authentication:**
- Re-auth required on checklist profile edits and cleaning profile modifications
- 69 total re-authentication actions configured via action-reauth config

**Report Settings Config Page:**
- New config page for report settings (logo, company name, header/footer text)
- Accessible via Configuration sidebar menu
