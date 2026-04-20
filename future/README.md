# future/ — Onboarding Pack

This folder is the single source of truth for anyone joining the project — developers, QA, testers, or business stakeholders. Everything here was written by inspecting the actual code in this repository (not by relying on older design documents), so if something in this pack contradicts an older `.md` file, trust this pack.

## What's inside

| Folder | For | Read first |
|---|---|---|
| `overview/` | Everyone | `CODEBASE_SUMMARY.md` |
| `frontend/` | React / UI devs | `frontend/README.md` |
| `backend/` | Fastify / API devs | `backend/README.md` |
| `testing/` | SDETs, automation | `testing/README.md` |
| `qa/` | Manual QA, product | `qa/README.md` |

## Reading order

1. **`overview/CODEBASE_SUMMARY.md`** — what the product is, monorepo layout, tech stack, where to start a dev server.
2. **`overview/CURRENT_STATUS.md`** — what's done as of 2026-04-20 (end of RFID branch work), what's in flight.
3. **`overview/API_LIST.md`** — every HTTP endpoint, grouped by module, with prefix and verb.
4. Role-specific folders.

## Live root docs (kept at repo root on purpose)

These are still accurate and are kept at the repo root so existing links don't break:

- `CLAUDE.md` — project rules for AI contributors (authoritative)
- `README.md` — quick-start
- `CHANGELOG.md` — version history
- `API_REFERENCE.md`, `ARCHITECTURE.md`, `BACKEND_GUIDE.md`, `FRONTEND_GUIDE.md`
- `OFFLINE_SYNC_ARCHITECTURE.md`, `PROJECT_ARCHITECTURE.md`, `PROJECT_SUMMARY.md`
- `DEPLOY-WINDOWS.md`, `DEPLOYMENT.md`, `LOCAL_SETUP_WINDOWS.md`
- `PROJECT_HANDOVER/APPLICATION_FLOW.md` — April-20 handover doc with diagrams

The pack under `future/` is meant to **complement** those, not replace them. It is written one abstraction level higher — where to look, not how every detail works.

## Superseded / historical material

Everything under `old/` has been archived because it was either:
- Replaced by a newer doc (`old/docs-superseded/`)
- A point-in-time artifact — screenshots, Playwright traces, DB snapshots, old APKs (`old/screenshots/`, `old/playwright-artifacts/`, `old/db-backups/`, `old/apks/`)
- A completed phase's planning folder (`old/tasks/`, `old/reports-specs/`, `old/legacy-documentation/`)

Do not delete `old/` — it's the audit trail of how the project got here.
