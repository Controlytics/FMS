# DigiLog Data Ingestion — Phase-Wise Implementation Guide

> **STATUS: ALL PHASES COMPLETE** -- Phase 1 deployed to production on 2026-03-07. Phase 2 (Digital Filter Management System) completed 2026-03-27.
> 34 API modules, 57 Prisma models, 17 enums, 77 rule chain node types, 23 config definitions, 4 notification channels.

## How to Use These Documents

Each phase document contains:
1. **A ready-to-paste prompt** for Claude Code (in the code block)
2. **Relevant spec section references** pointing to the master requirements doc

### Workflow Per Phase

```
1. Open the phase document (e.g., PHASE_A_INFRASTRUCTURE.md)
2. Copy the prompt inside the code block
3. Paste into Claude Code along with: "The master spec is at DATA_INGESTION_REQUIREMENTS_v3.md"
4. Let Claude Code read the referenced spec sections before coding
5. Verify using the checklist at the bottom of each prompt
6. Move to the next phase only after verification passes
```

### Key Rule for Claude Code

> **Always tell Claude Code:** "Read the relevant spec sections listed at the bottom of this prompt BEFORE writing any code. The spec is the source of truth -- if your implementation differs from the spec, fix the implementation."

---

## Phase Dependency Order

```
Phase A: Infrastructure ──────────────────────────────────┐
    │                                                      │
Phase B: Transport ────────────────────────────────────┐   │
    │                                                  │   │
Phase C: Pipeline ─────────────────────────────────┐   │   │
    │                                              │   │   │
Phase D: Rule Chain Engine ────────────────────┐   │   │   │
    │                                          │   │   │   │
    ├── Phase E: UNS ──────────────────┐       │   │   │   │
    │                                  │       │   │   │   │
    ├── Phase F: Queries & Export ──┐  │       │   │   │   │ ALL BACKEND
    │                              │  │       │   │   │   │ COMPLETE
    │                              │  │       │   │   │   │
    │   ┌──────────────────────────┘  │       │   │   │   │
    │   │   ┌─────────────────────────┘       │   │   │   │
    │   │   │   ┌─────────────────────────────┘   │   │   │
    │   │   │   │   ┌─────────────────────────────┘   │   │
    │   │   │   │   │   ┌─────────────────────────────┘   │
    │   │   │   │   │   │                                 │
Phase G: Rule Chain Editor (UI) ───────────────────────┐  │
    │                                                  │  │
Phase H: Connectivity & QR (UI) ───────────────────┐   │  │  ALL FRONTEND
    │                                              │   │  │  COMPLETE
Phase I: Checklist & Mobile (UI) ──────────────┐   │   │  │
    │                                          │   │   │  │
Phase J: Help, UNS UI, Alarms (UI) ────┐      │   │   │  │
    │                                   │      │   │   │  │
    │   ┌───────────────────────────────┘      │   │   │  │
    │   │   ┌──────────────────────────────────┘   │   │  │
    │   │   │   ┌──────────────────────────────────┘   │  │
    │   │   │   │   ┌──────────────────────────────────┘  │
    │   │   │   │   │   ┌─────────────────────────────────┘
    │   │   │   │   │   │
Phase K: Testing & Documentation ──── PHASE 1 COMPLETE (2026-03-07)
                                      │
                                Phase 2: Digital FMS ──── COMPLETE (2026-03-27)
```

**Strict order: A -> B -> C -> D (then E and F can parallel) -> G/H/I/J (can parallel) -> K -> Phase 2**

---

## Phase Summary

| Phase | Name | Days | Key Deliverables | Status |
|-------|------|------|-----------------|--------|
| **A** | Infrastructure | 3-4 | Docker Compose, Prisma models, BullMQ queues, SystemConfig seed | COMPLETE |
| **B** | Transport | 3-4 | EMQX auth, MQTT handler, HTTP endpoints, WebSocket handler | COMPLETE |
| **C** | Pipeline | 2-3 | BullMQ worker, pipeline stages, batcher, DLQ, tracer, ConfigService | COMPLETE |
| **D** | Rule Chain | 5-7 | Engine, sandbox, 77 node types, debug recorder, CRUD API | COMPLETE |
| **E** | UNS | 2-3 | Path builder, cascade move, UNS API | COMPLETE |
| **F** | Queries & Export | 3-4 | Telemetry/alarm endpoints, CSV/JSON/PDF export | COMPLETE |
| **G** | Rule Chain Editor | 5-7 | React Flow canvas, node palette, Monaco editor, debug panel | COMPLETE |
| **H** | Connectivity & QR | 3-4 | Status indicators, code snippets, QR generation | COMPLETE |
| **I** | Checklist & Mobile | 3-4 | 14 field types, signature pad, 3-tier approval, e-sig dialog | COMPLETE |
| **J** | Help, UNS UI, Alarms | 2-3 | Help system, UNS tree, alarm dashboard, system config UI | COMPLETE |
| **K** | Testing & Docs | 3-4 | 1,344 tests, API docs, deployment guide, compliance matrix | COMPLETE |

**Total Phase 1: 35-47 development days** -- Completed and deployed 2026-03-07.

## Phase 2: Digital Filter Management System

| Module | Description | Status |
|--------|-------------|--------|
| Cleaning Profiles | Visual pipeline editor, multi-stage workflows | COMPLETE |
| Filter Profiles | Filter-to-profile assignment | COMPLETE |
| Filter Operations | Cycle start/advance/bypass/checklist/events | COMPLETE |
| PM Schedules | Preventive maintenance scheduling per AHU | COMPLETE |
| Checklist Profiles | Reusable question templates (10 types) | COMPLETE |
| Equipment Groups | AHU dashboard, dual-set management | COMPLETE |
| Bulk Upload | Filter data import | COMPLETE |
| Retirement/Replacement | Filter lifecycle end tracking | COMPLETE |

**Phase 2 additions:** 6 new backend modules, 52 new privileges, 78 field IDs, 40 help articles, 3 new config definitions (filter-cleaning-reasons, filter-lifecycle-states, filter-pm-schedule).

---

## Files in This Package

```
PHASE_A_INFRASTRUCTURE.md    — Docker, TSDB, Prisma, queues, seeds
PHASE_B_TRANSPORT.md         — MQTT, HTTP, WebSocket, normalization
PHASE_C_PIPELINE.md          — BullMQ worker, pipeline stages, batching, DLQ
PHASE_D_RULE_CHAIN.md        — Engine, sandbox, 77 node types, CRUD API
PHASE_E_UNS.md               — Path builder, cascade, UNS API
PHASE_F_QUERIES_EXPORT.md    — Telemetry queries, alarms, export
PHASE_G_RULE_CHAIN_EDITOR.md — Visual editor (React Flow + Monaco)
PHASE_H_CONNECTIVITY_QR.md   — Device status, snippets, QR codes
PHASE_I_CHECKLIST_MOBILE.md  — Mobile checklist, signatures, approval
PHASE_J_HELP_UNS_ALARMS.md  — Help system, UNS tree, alarm dashboard
PHASE_K_TESTING_DOCS.md      — All tests + documentation

DATA_INGESTION_REQUIREMENTS_v3.md — Master spec (source of truth)
```

---

## Critical Compliance Reminders (Every Phase)

These rules apply ALWAYS -- remind Claude Code if it deviates:

1. **No UPDATE/DELETE on compliance hypertables** -- ts_telemetry, ts_attributes, ts_checklist_responses, ts_device_events, ts_binary_data are append-only
2. **ts_pipeline_traces IS exempt** -- it's debug data with a retention policy
3. **Audit trail on compliance actions** -- every action in Section 12.5 MUST produce an audit entry
4. **Reauth on critical actions** -- every action in Section 12.4 MUST require password re-entry
5. **Electronic signatures** -- 11.50 fields (name, date, meaning) + 11.70 binding (SHA-256 hash)
6. **Batch flush before job ack** -- telemetry batcher MUST flush before BullMQ marks job complete
7. **ConfigService for limits** -- all operational limits come from SystemConfig table (23 definitions), NOT env vars
8. **SUPER_ADMIN operations are NOT auditable** -- system-level operations excluded from compliance logs
9. **Input sanitization** -- all text inputs stripped of HTML tags via lib/sanitize.ts
10. **Organization scoping** -- cross-tenant data isolation enforced on all queries
