# Phase D: Rule Chain Engine (5-7 days)

## Prompt for Claude Code

```
You are implementing Phase D (Rule Chain Engine) of DigiLog's Data Ingestion & Integration Layer.

Phases A-C are complete. Messages arrive, get enqueued, and the pipeline processes Stages 1-6 and 9-11. Currently Stage 7-8 (rule chain) are skipped — messages go straight to persistence. Now you build the rule chain engine that sits at Stage 7-8 and transforms, filters, enriches, and routes data before persistence.

The rule chain is a visual node-based processing graph (like Node-RED). Each entity's template has a root rule chain. Messages enter at the INPUT node and flow through connected nodes. Nodes have outputs (Success, Failure, True, False, custom) that connect to other nodes.

IMPORTANT RULES:
- Master spec: DATA_INGESTION_REQUIREMENTS_v3.md
- Script nodes run in isolated-vm sandbox (NOT Node.js vm module)
- Max chain depth: read from SystemConfig `rule_engine.max_chain_depth` (default 10)
- Script timeout: read from SystemConfig `rule_engine.script_timeout_ms` (default 1000ms)
- Rule chains are versioned — every save creates a RuleChainVersion snapshot
- Debug recording is a ring buffer per chain (max 100 messages, configurable)
- Default chains are auto-created when templates are created

WHAT TO BUILD:

1. RULE ENGINE CORE (apps/api/src/modules/rule-chain/rule-engine.ts):
   - execute(message: IngestionMessage, ruleChainId: string): Promise<RuleEngineResult>
   - Load rule chain graph (nodes + connections) from cache (or DB)
   - Start at INPUT node → process → follow output connections → next node → repeat
   - Max chain depth protection (prevent infinite loops via chain references)
   - Error in any node → route to that node's "Failure" output
   - If no Failure connection → bubble up to chain-level error handler
   - If no chain error handler → save raw data (fail-safe)
   - Return: modified message, alarms to create, notifications to send, metadata changes

2. SCRIPT SANDBOX (apps/api/src/modules/rule-chain/script-sandbox.ts):
   - Use isolated-vm (NOT Node.js vm)
   - Create isolate with memory limit from SystemConfig `rule_engine.sandbox_memory_mb` (default 8MB)
   - Compile and cache scripts (key: script hash)
   - Execute with timeout from SystemConfig `rule_engine.script_timeout_ms`
   - Available API inside sandbox:
     msg — the message object (mutable)
     metadata — message metadata (mutable)
     msgType — message type string
     log(text) — append to debug log (max 1000 chars)
     return: true/false for filter scripts, msg for transform scripts
   - NO access to: require, process, fs, network, setTimeout, setInterval, Date.now
   - On timeout: kill isolate, return Failure output with ERR_SCRIPT_TIMEOUT
   - On memory exceeded: kill isolate, return Failure with ERR_SCRIPT_MEMORY

3. NODE IMPLEMENTATIONS (apps/api/src/modules/rule-chain/nodes/):
   Each node type has: type, configSchema (Zod), execute(msg, config, ctx) → {output, msg}

   INPUT NODES:
   - input: Entry point, passes message through

   FILTER NODES:
   - msg-type-filter: Route by message type (True if matches configured types)
   - script-filter: Custom JS filter (return true → True output, false → False output)
   - check-relation: Check if entity has specific relation
   - originator-type-filter: Filter by entity template type
   - check-alarm-status: Check if alarm exists with specific status

   ENRICHMENT NODES:
   - entity-attributes: Attach entity attributes to metadata
   - entity-details: Attach entity name, template, parent info
   - related-attributes: Fetch attributes from related entities
   - tenant-attributes: Attach tenant-level settings

   TRANSFORM NODES:
   - script-transform: Custom JS to modify message (return modified msg)
   - rename-keys: Map telemetry key names (e.g. "temp" → "temperature_celsius")
   - change-originator: Switch message entity (for forwarding to parent)
   - to-email: Transform message into email notification format
   - unit-conversion: Apply formula-based unit conversion

   ACTION NODES:
   - save-timeseries: Save to ts_telemetry (default action)
   - save-attributes: Save to entity attributes
   - create-alarm: Create/update Alarm with severity, type, details
   - clear-alarm: Clear existing alarm by type
   - send-notification: Enqueue to "notification" queue
   - assign-to-user: Set alarm assignee
   - log: Write to server log (debug only)
   - rpc-call-reply: Send RPC response back to device

   EXTERNAL NODES:
   - rest-api-call: HTTP request to external service (timeout from SystemConfig)
   - send-email: Format and enqueue email
   - mqtt-publish: Publish to custom MQTT topic
   - push-to-uns: Publish to UNS path

   FLOW NODES:
   - rule-chain-input: Enter another rule chain (increment depth counter)
   - checkpoint: Force-save current state before continuing
   - delay: Wait N ms then continue (max from SystemConfig)
   - acknowledge: Mark message as acknowledged (stop further processing)

4. DEBUG RECORDER (apps/api/src/modules/rule-chain/debug-recorder.ts):
   - Per-chain ring buffer (in-memory Map, max size from SystemConfig `rule_engine.debug_buffer_size`)
   - Record when debug is enabled on a node OR chain-level debug is on
   - Each record: {nodeId, nodeType, inputMsg, outputMsg, output, durationMs, timestamp, error?}
   - Stream to Redis pub/sub `debug:rulechain:{chainId}` for real-time debug panel
   - Oldest entries evicted when buffer full

5. DEFAULT CHAIN BUILDER (apps/api/src/modules/rule-chain/default-chain-builder.ts):
   - Called when a new AssetTemplate is created
   - Creates a rule chain with:
     INPUT → msg-type-filter (TELEMETRY → save-timeseries, ATTRIBUTES → save-attributes)
   - Links to template's defaultRuleChainId
   - Also creates: alarm rule stubs if template has alarm thresholds defined

6. RULE CHAIN CRUD API (apps/api/src/modules/rule-chain/routes.ts):
   POST   /api/rule-chains              — Create (requires reauth, audit trail)
   GET    /api/rule-chains              — List (SUPER_ADMIN sees all)
   GET    /api/rule-chains/:id          — Get with nodes and connections
   PUT    /api/rule-chains/:id          — Update (creates version snapshot, requires reauth)
   DELETE /api/rule-chains/:id          — Soft delete (if not referenced by any template)
   POST   /api/rule-chains/:id/test     — Test with sample message (runs pipeline in dry-run mode)
   GET    /api/rule-chains/:id/versions — List version history
   GET    /api/rule-chains/:id/versions/:versionId — Get specific version
   POST   /api/rule-chains/:id/versions/:versionId/restore — Restore (creates new version)
   GET    /api/rule-chains/:id/debug    — Get debug buffer (latest N messages)
   PUT    /api/rule-chains/:id/debug    — Toggle debug mode on/off
   POST   /api/rule-chains/:id/export   — Export as JSON
   POST   /api/rule-chains/import       — Import from JSON

   Version snapshot: full deep copy of all nodes + connections stored as JSONB in RuleChainVersion

7. INTEGRATE WITH PIPELINE:
   Update ingestion.service.ts Stage 7-8:
   - Stage 7: Resolve rule chain (entity → template → defaultRuleChainId)
   - Stage 8: Execute rule chain (call rule-engine.execute)
   - Collect results: modified message, alarms, notifications
   - Pass modified message to Stage 9 (persistence)
   - Create alarms from Stage 8 results
   - Enqueue notifications from Stage 8 results

VERIFICATION:
- Create template → default rule chain auto-created with save-timeseries node
- Send telemetry → flows through rule chain → saved to ts_telemetry
- Add script-filter node (temp > 100 → create-alarm) → send temp=105 → alarm created
- Script with infinite loop → killed after timeout → Failure output routed
- Test endpoint with sample message → dry-run result (no persistence)
- Update rule chain → version history has previous snapshot
- Debug enabled → send message → debug buffer contains node-by-node trace
```

## Relevant Spec Sections

- **Section 7**: Rule chain engine (execution model, error handling, message routing)
- **Section 7.1**: Node types table (all 30+ nodes with inputs/outputs/config)
- **Section 7.2**: Script sandbox (isolated-vm, API, limits)
- **Section 7.3**: Default chain builder (auto-creation logic)
- **Section 7.4**: Debug mode (ring buffer, real-time streaming)
- **Section 7.5**: Version management (snapshot, restore, export/import)
- **Section 11.4**: Rule chain CRUD endpoints (13 routes)
- **Section 12.2**: RuleChain, RuleChainVersion, RuleNode, RuleNodeConnection Prisma models
