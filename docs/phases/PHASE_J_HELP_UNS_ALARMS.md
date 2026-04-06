# Phase J: Help System, UNS UI, Alarm Dashboard (2-3 days)

> **STATUS: COMPLETE** -- Deployed to production on 2026-03-07. Phase 2 Digital FMS completed 2026-03-27.
> Help system (6 endpoints, 28+ articles), UNS configuration page with tree view, alarm dashboard with real-time badge counts (5 endpoints), system config UI (23 config definitions) all operational. Phase 2 added 40 help articles and 4 notification channels (Email, SMS, Telegram, Slack).

## Prompt for Claude Code

```
You are implementing Phase J (Help, UNS UI, Alarms) of DigiLog's Data Ingestion & Integration Layer.

Phases A-I are complete. This phase adds three supporting UI features: the context-sensitive help system, the UNS configuration page, and the alarm dashboard with real-time badge counts.

IMPORTANT RULES:
- Master spec: DATA_INGESTION_REQUIREMENTS_v3.md
- Help articles are seeded (Phase A) and versioned — every edit creates a new HelpArticleVersion
- UNS tree mirrors the ISA-95 hierarchy from the asset tree
- Alarm dashboard is a primary navigation item — operators check it constantly
- Alarm badge count updates in real-time via WebSocket

WHAT TO BUILD:

1. HELP SYSTEM:

   A. HelpButton (apps/web/src/components/ui/help-button.tsx):
   - Small "?" icon button, positioned consistently across all pages
   - Each page/section has a contextKey (e.g. "rule-chain-editor", "checklist-submission")
   - On click → opens HelpPanel with article matching contextKey

   B. HelpPanel (apps/web/src/components/ui/help-panel.tsx):
   - Slide-in panel from right side
   - Displays help article content (rendered Markdown)
   - Table of contents for long articles
   - "Was this helpful?" feedback buttons (thumbs up/down)
   - Search within help articles
   - Link to related articles

   C. Help Article Manager (apps/web/src/routes/config/help.tsx):
   - SUPER_ADMIN only (HELP_MANAGE permission)
   - List all help articles: title, contextKey, last updated, status (published/draft)
   - Create / edit article:
     - Title, contextKey, category, tags
     - Markdown editor (split pane: editor | preview)
     - Save → creates new HelpArticleVersion
   - Version history: view previous versions, restore, diff view
   - Publish/unpublish toggle

   D. Help API (apps/api/src/modules/help/routes.ts):
   GET    /api/help/articles            — List (public, filtered by published)
   GET    /api/help/articles/:contextKey — Get by context key
   POST   /api/help/articles            — Create (HELP_MANAGE)
   PUT    /api/help/articles/:id        — Update (creates version, HELP_MANAGE)
   GET    /api/help/articles/:id/versions — Version history
   DELETE /api/help/articles/:id        — Soft delete (HELP_MANAGE)

2. UNS CONFIGURATION PAGE (apps/web/src/routes/config/uns.tsx):

   A. UNS Tree (apps/web/src/components/uns/uns-tree.tsx):
   - Hierarchical tree view mirroring ISA-95 structure
   - Levels: Enterprise → Site → Area → Line → Cell → Entity
   - Each node shows: name, level, entity count, device count, connectivity summary
   - Expand/collapse nodes
   - Click entity → link to entity detail page
   - Search by path pattern (supports MQTT wildcards + and #)
   - Filter by: connectivity status, site, has devices

   B. Path Override:
   - Select entity in tree → side panel shows current UNS path
   - "Override" button → manual path editor (for non-standard hierarchies)
   - Warning: overriding breaks auto-generation, must be maintained manually

   C. Move Impact Preview:
   - When entity is moved (from entity management UI):
     → UNS service generates impact report
     → Show modal: table of affected entities with old path → new path
     → Affected device count
     → "Confirm Move" or "Cancel"

   D. UNS Statistics:
   - Total entities with UNS mappings
   - Total active devices
   - Entities without mappings (needs attention)
   - Path conflicts (if any)

3. ALARM DASHBOARD (apps/web/src/routes/alarms/index.tsx):

   A. Alarm Table:
   - Columns: severity icon, entity name, alarm type, message, status, created, assignee
   - Sortable by severity, time, status
   - Filterable by: status (ACTIVE/ACKNOWLEDGED/CLEARED), severity, entity, type, assignee
   - Default view: ACTIVE alarms sorted by severity (CRITICAL first)
   - Row click → alarm detail dialog
   - Bulk actions: acknowledge selected, assign selected

   B. Alarm Detail Dialog:
   - Full alarm info: type, severity, entity, message, details (JSON), timestamps
   - Timeline: created → acknowledged (by, at) → cleared (by, at)
   - Electronic signatures shown for acknowledge/clear actions
   - Acknowledge button → electronic signature dialog → API call
   - Clear button → electronic signature dialog → API call
   - Assign to user dropdown

   C. Alarm Badge (apps/web/src/components/ui/alarm-badge.tsx):
   - Shows in main navigation sidebar next to "Alarms" menu item
   - Count of ACTIVE alarms (not acknowledged, not cleared)
   - Color: red if any CRITICAL, orange if MAJOR, yellow if MINOR
   - Real-time updates via WebSocket (subscribe to alarm events)
   - Pulse animation when count increases

   D. Alarm Statistics:
   - Summary cards at top: total active, critical count, unassigned count
   - Chart: alarms over time (last 24h/7d/30d) grouped by severity
   - Top alarm types table

4. SYSTEM CONFIG UI (apps/web/src/routes/config/system.tsx):
   - SUPER_ADMIN only (SYSTEM_CONFIG_MANAGE permission)
   - Grouped by category (from SystemConfig.category field):
     Ingestion, Pipeline, Rule Engine, Export, WebSocket, Telemetry, RPC, Device
   - Each setting: name, description, current value, default, min, max, unit
   - Edit inline → validate against min/max → save → audit trail
   - Cold settings (requiresRestart=true) show warning: "Requires server restart"
   - Reset to default button per setting

VERIFICATION:
- Click "?" on rule chain editor → help panel opens with relevant article
- SUPER_ADMIN edits help article → new version created → old version in history
- UNS tree shows full hierarchy → click entity → navigates to entity detail
- Move entity → impact modal shows all affected paths → confirm → paths updated
- Alarm created by rule chain → badge count increments in real-time → dashboard shows new alarm
- Acknowledge alarm → e-sig dialog → alarm status updates → badge count decrements
- System config: change batch size → value saved → audit trail shows old/new values
```

## Relevant Spec Sections

- **Section 8.5**: Alarm lifecycle and states
- **Section 11.3**: Alarm API endpoints
- **Section 11.7**: UNS API endpoints
- **Section 11.9**: Help article API endpoints
- **Section 13.8**: Help system UI spec (HelpButton, HelpPanel, article manager)
- **Section 13.9**: UNS tree UI spec
- **Section 13.10**: Alarm dashboard UI spec
- **Section 20.1**: System config UI spec
- **Section 20.3**: All configurable settings with categories
- **Section 14.2**: Frontend file structure
- **Appendix B**: Default help article seed data


> **Update (2026-03-27):** Phase 2 Digital FMS completed. Added 40 help articles for filter management. Notification channels expanded to 4 (Email, SMS, Telegram, Slack) with Slack and Telegram config definitions. System config UI manages 23 config definitions including 3 filter-specific ones. All UI uses unified light theme (bg-white, text-slate-800).

