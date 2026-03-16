# DigiLog Web — CLAUDE.md

## Overview
React SPA built with Vite, served by Nginx from `apps/web/dist/`.

## Build & Deploy
```bash
cd /home/ubuntu/21cfrlogbook/apps/web
npx vite build   # Output to dist/
# Nginx serves dist/ automatically
```

## Key Paths
- Source: `apps/web/src/`
- Entry: `apps/web/src/main.tsx`
- Routes: `apps/web/src/routes/` (20+ page modules)
- Hooks: `apps/web/src/hooks/` (auth, branding, datetime, pagination, reauth, session, single-tab, toast)
- Components: `apps/web/src/components/` (layout, UI primitives, dialogs)

## Architecture
- React Router v6 with AppLayout wrapper for auth + session management
- SWR for data fetching with auto-revalidation
- ReactFlow for rule chain visual editor
- Tailwind CSS (no component library)
- Lazy-loaded heavy pages (assets, rule chains, alarms, UNS, checklists, etc.)

## Auth Flow
- Token stored in sessionStorage
- Auto-redirect to `/` (dashboard) after login
- 30-minute JWT refresh cycle
- Session timeout warning dialog
- Single-tab enforcement per user

## Key Features
- 23 config pages (auto-discovered from registry)
- Entity tree with drag-and-drop hierarchy
- Rule chain editor with 77 node types
- Alarm dashboard with real-time updates
- Mobile-optimized checklist at `/checklist/:entityId`
