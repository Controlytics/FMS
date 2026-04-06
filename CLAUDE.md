# DigiLog — CLAUDE.md

## Project
DigiLog (21cfrlogbook) — IoT data logging platform with 21 CFR Part 11 compliance.

## Repository
- **Remote:** github.com/pankajexa/21cfrlogbook.git
- **Branch:** DigitalFMS (active development)

## Monorepo Structure
```
apps/api/     — Fastify backend (TypeScript, port 3000, PM2)
apps/web/     — React frontend (Vite SPA, served by Nginx)
packages/shared/ — Shared types, schemas, constants
packages/db/     — TimescaleDB connection pool
packages/queue/  — BullMQ job queue
```

## EC2 Instance
- **IP:** 34.232.224.0 (may change on restart)
- **SSH:** `ssh -i ~/Downloads/21cfrbook.pem ubuntu@34.232.224.0`
- **Services:** Nginx (80/443), Fastify (3000), PostgreSQL (5432), EMQX (1883/18083), Redis (6379)

## Build Commands
```bash
# Backend
cd /home/ubuntu/21cfrlogbook
npx tsc -p apps/api/tsconfig.json && pm2 restart digilog-api

# Frontend
cd apps/web && npx vite build

# Shared packages
npx nx build shared && npx nx build db && npx nx build queue
```

## Default Login
- **Username:** superadmin
- **Password:** Admin@123

## Key URLs
- App: http://34.232.224.0
- Swagger: http://34.232.224.0/docs
- EMQX: http://34.232.224.0:18083

## Important Notes
- Always run `npx tsc` before `pm2 restart` (PM2 runs compiled JS)
- Frontend build output goes to `apps/web/dist/` (served by Nginx)
- TimescaleDB is `digilog_tsdb`, NOT `digilog_db`
- Input sanitization strips HTML from all text fields (lib/sanitize.ts)
- 77 rule chain node types across 8 categories
- 23 config definitions with auto-discovery
- 28 help articles with version history

## Phase 2: Digital Filter Management System

### New Backend Modules
- `cleaning-profiles/` — Pipeline profile CRUD with visual editor support
- `filter-profiles/` — Filter-to-profile assignment
- `filter-operations/` — Core operations: cycle start/advance/bypass/checklist/events
- `pm-schedules/` — Preventive maintenance scheduling
- `checklist-profiles/` — Checklist template management

### Key API Endpoints
```
POST /api/filters/:id/start-cycle    — Start cleaning cycle
POST /api/filters/:id/advance        — Advance to next stage
POST /api/filters/:id/submit-checklist — Submit checklist answers
POST /api/filters/:id/bypass         — Bypass stage (deviation)
GET  /api/filters/:id/current-state  — Get filter state + next actions
GET  /api/filter/cycles              — List cleaning cycles
GET  /api/filter/events              — List filter events
```

### Pipeline Flow
CHECKLIST nodes between STAGE nodes trigger automatic question dialogs.
Server-side enforcement: advance() blocks if pending checklist not completed.
Cycle auto-completes when last STAGE leads to END node.


Workflow Orchestration

1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately – don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

3. Self-Improvement Loop
- After ANY correction from the user: update tasks/lessons.md with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes – don't over-engineer
- Challenge your own work before presenting it

6. Autonomous Bug Fixing
- When given a bug report, just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests – then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

Task Management
- Plan First: Write plan to tasks/todo.md with checkable items
- Verify Plan: Check in before starting implementation
- Track Progress: Mark items complete as you go
- Explain Changes: High-level summary at each step
- Document Results: Add review section to tasks/todo.md
- Capture Lessons: Update tasks/lessons.md after corrections

Core Principles
- Simplicity First: Make every change as simple as possible. Impact minimal code.
- No Laziness: Find root causes. No temporary fixes. Senior developer standards.
- Minimal Impact: Changes should only touch what's necessary. Avoid introducing bugs.