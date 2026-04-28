# QA — Quick Start

This folder orients a QA or product reviewer who hasn't worked with the project before. Read top to bottom; everything here is grounded in what's actually in the code, not in older design docs.

## Who this product is for

Pharmaceutical plants that need to manage HVAC filters and AHUs under **21 CFR Part 11** audit rules. Users are typically:

- **Engineer / operator** — runs cleaning cycles, responds to PM tasks
- **Supervisor** — approves block changes and PM entries, reviews cycle history
- **QA** — signs off reports, reviews audit trail
- **Admin** — manages users, roles, configs, templates
- **Super-admin** — manages organizations, runs the data management console, handles backups

## How to access the app

| Target | URL | Notes |
|---|---|---|
| Dev (web) | `http://localhost:5173` | Needs `cd apps/web && npm run dev` |
| Dev (API) | `http://localhost:3000` | `cd apps/api && npm run dev` |
| Dev API docs | `http://localhost:3000/docs` | Swagger UI — dev only |
| Prod (EC2) | `http://34.232.224.0` | See `CLAUDE.md` for SSH details |
| Prod MQTT admin | `http://34.232.224.0:18083` | EMQX dashboard |
| Mobile / tablet | launch **DigiLog** APK | APK bakes in `https://192.168.1.22:3000` — adjust for your dev box |

## Default test credentials

- **superadmin** / **Admin@123** (seeded)

Create additional users via `/admin-requests` (recommended) or `/users/create` (direct). For role-specific testing you need an approver, so the admin-request flow requires at least two users.

## What to test first

1. **Sanity:** log in; load `/`; confirm no console errors.
2. **`future/testing/MANUAL_TEST_GUIDE.md`** scenarios — run all 12 golden paths.
3. **`FEATURE_CHECKLIST.md`** (this folder) — tick off every feature area with its verification steps.
4. **`ACCEPTANCE_CRITERIA.md`** — per-feature acceptance bullets grouped by module.
5. **`KNOWN_ISSUES.md`** — things not to be surprised by.

## Exit criteria for a QA pass

- All 12 golden paths in `MANUAL_TEST_GUIDE.md` pass on **two** environments: web + tablet APK.
- All rows in `FEATURE_CHECKLIST.md` marked ✅ by the reviewer.
- No P0/P1 items open in the tracker for the tested branch.
- Audit trail spot-check: random 20 rows pulled from `/audit` — all have user, timestamp, action, entity, and a valid hash-chain link.

## Log access

- Backend logs on EC2: `pm2 logs digilog-api --lines 200`
- Browser DevTools Console for frontend issues
- Tablet WebView logs via `chrome://inspect/#devices` with USB debugging
- EMQX logs via the dashboard

## How to file a bug (suggested template)

```
Title: <Area> — <What broke in one line>

Environment: <web / tablet APK>, user: <role>, commit: <sha>
Steps:
1.
2.
3.

Expected: ...
Actual: ...

Evidence: <logs / screenshots / network traces>
Severity: P0 (blocks shipping) / P1 (major flow broken) / P2 (usability) / P3 (cosmetic)
```

## Where to look next

- `FEATURE_CHECKLIST.md` — every feature + how to verify
- `ACCEPTANCE_CRITERIA.md` — per-feature acceptance
- `KNOWN_ISSUES.md` — open limitations and common gotchas
