# Phase G: Rule Chain Visual Editor (5-7 days)

> **STATUS: COMPLETE** -- Deployed to production on 2026-03-07.
> React Flow canvas, node palette, node config panel, Monaco script editor, debug panel, version history, save/test/export/import flows all operational.

## Prompt for Claude Code

```
You are implementing Phase G (Rule Chain Visual Editor) of DigiLog's Data Ingestion & Integration Layer.

Phases A-F are complete — the entire backend works. Now you build the frontend visual editor that lets SUPER_ADMINs create and edit rule chains using a drag-and-drop node graph (like Node-RED or ThingsBoard).

IMPORTANT RULES:
- Master spec: DATA_INGESTION_REQUIREMENTS_v3.md
- Use React Flow (reactflow@^11.11.0) for the node canvas
- Use Monaco Editor (@monaco-editor/react@^4.6.0) for script editing in script nodes
- SUPER_ADMIN only access (check permission RULE_CHAIN_MANAGE)
- Rule chain save requires reauth (creates version snapshot)
- This is the most complex UI component in DigiLog — take care with UX

WHAT TO BUILD:

1. RULE CHAIN LIST PAGE (apps/web/src/routes/rule-chains/index.tsx):
   - Table: name, description, linked templates count, last modified, status (active/draft)
   - Actions: edit, duplicate, export, delete
   - Create new (blank or from template)
   - Import from JSON file

2. RULE CHAIN EDITOR (apps/web/src/routes/rule-chains/editor.tsx):
   Full-screen editor with:

   A. CANVAS (apps/web/src/components/rule-chain/canvas.tsx):
   - React Flow canvas with custom node components
   - Drag nodes from palette onto canvas
   - Connect nodes by dragging from output handle to input handle
   - Each node shows: icon, type label, name, status indicator
   - Output handles labeled (Success, Failure, True, False, custom)
   - Color-coded by category: green=input, blue=filter, orange=enrichment,
     purple=transform, red=action, gray=external, yellow=flow
   - Mini-map in corner
   - Zoom controls, fit-to-screen
   - Snap to grid

   B. NODE PALETTE (apps/web/src/components/rule-chain/node-palette.tsx):
   - Sidebar with all node types grouped by category
   - Search/filter
   - Drag to add to canvas
   - Tooltip with description for each type
   - Categories: Input, Filter, Enrichment, Transform, Action, External, Flow

   C. NODE CONFIG PANEL (apps/web/src/components/rule-chain/node-config.tsx):
   - Opens when node is selected on canvas
   - Dynamic form based on node type's configSchema
   - Node name (user-editable label)
   - Debug toggle (per-node)
   - Delete node button
   - Per-type config panels (apps/web/src/components/rule-chain/node-types/):
     - script-filter / script-transform: Monaco editor for JavaScript
     - msg-type-filter: multi-select checkboxes for message types
     - create-alarm: severity dropdown, type input, detail template
     - rest-api-call: URL, method, headers, body template
     - save-timeseries / save-attributes: key mapping options
     - rename-keys: key mapping table (old → new)
     - rule-chain-input: chain selector dropdown
     - delay: duration input with unit selector

   D. SCRIPT EDITOR (apps/web/src/components/rule-chain/script-editor.tsx):
   - Monaco Editor with JavaScript syntax highlighting
   - Autocomplete for: msg, metadata, msgType, log()
   - Pre-filled template based on node type:
     Filter: `// Return true to route to True output, false for False\nreturn msg.temperature > 100;`
     Transform: `// Modify and return the message\nmsg.temperatureF = msg.temperatureC * 9/5 + 32;\nreturn msg;`
   - Test button: run script against sample message, show result inline

   E. DEBUG PANEL (apps/web/src/components/rule-chain/debug-panel.tsx):
   - Bottom drawer (collapsible)
   - Real-time stream via WebSocket (subscribe to `debug:rulechain:{chainId}`)
   - Each entry: timestamp, node name, input msg (collapsible JSON), output msg, output port, duration
   - Filter by node, by output type
   - Clear buffer button
   - Pause/resume stream
   - Max 100 entries shown (ring buffer on backend)

   F. VERSION HISTORY (apps/web/src/components/rule-chain/version-history.tsx):
   - Side panel showing version list (version number, date, modified by)
   - Click version → preview (read-only canvas view)
   - Restore button → creates new version from historical snapshot
   - Diff view: highlight nodes added/removed/changed between versions

3. SAVE FLOW:
   - Save button → validate graph (all nodes connected, no orphans, no cycles)
   - If validation fails → highlight problem nodes in red, show error messages
   - If valid → reauth dialog → on success → PUT /api/rule-chains/:id → version created
   - Show success toast with version number

4. TEST MESSAGE FLOW:
   - "Test" button in toolbar
   - Opens dialog: select message type, enter JSON payload
   - POST /api/rule-chains/:id/test
   - Shows result: node-by-node execution trace, final output, any alarms created
   - Highlight path taken on canvas (animate edges)

5. EXPORT / IMPORT:
   - Export: download rule chain as JSON file
   - Import: upload JSON → preview on canvas → confirm → save

VERIFICATION:
- Drag script-filter from palette → canvas → connect INPUT → script-filter → save-timeseries
- Open script-filter config → Monaco editor loads → write JS → save
- Send test message → debug panel shows node-by-node execution
- Save → reauth dialog → confirm → version 2 created
- Open version history → see version 1 and 2 → restore version 1 → version 3 created
- Export → JSON file → Import in new chain → identical graph
```

## Relevant Spec Sections

- **Section 7.1**: Node types (complete catalog with icons, configs, inputs/outputs)
- **Section 7.2**: Script sandbox API (autocomplete targets)
- **Section 7.4**: Debug mode (ring buffer, WebSocket streaming)
- **Section 7.5**: Version management (snapshot, restore, export/import)
- **Section 13.1**: Rule chain editor UI spec (canvas, palette, config, debug)
- **Section 13.2**: Script editor UI spec (Monaco, templates, test)
- **Section 14.2**: Frontend file structure (rule-chain components)


> **Update (2026-03-27):** Phase 2 Digital Filter Management System has been completed. See CHANGELOG.md for full details.

