# DigiLog Web — Frontend

## Stack
React 19, Vite, TypeScript, Tailwind CSS 4, SWR, React Router 7, React Hook Form, Zod

## Directory Structure
- `src/main.tsx` — Entry point + router setup
- `src/components/ui/` — Reusable UI components (button, input, card, table, dialog, badge, select)
- `src/components/layout/` — App layout (sidebar, header, app-layout)
- `src/hooks/` — Custom hooks (use-auth, use-session)
- `src/lib/` — Utilities (api-client, swr-config, cn)
- `src/routes/` — Page components organized by feature

## Running
```bash
npm run dev          # Vite dev server on port 5173
npm run build        # Production build
```

## API Proxy
Vite proxies `/api` requests to `http://localhost:3000` in development.

## Auth
JWT stored in localStorage. SWR fetches `/api/auth/me` to get current user. 401 responses redirect to `/login`.

## Password Fields
All password inputs use `secureField` prop to disable copy/paste/cut/drag/context-menu per 21 CFR Part 11 requirements.
