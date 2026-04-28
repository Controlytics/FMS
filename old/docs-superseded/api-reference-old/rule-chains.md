# API Reference: Rule Chains

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/rule-chains | Create rule chain (requires reauth) |
| GET | /api/rule-chains | List rule chains |
| GET | /api/rule-chains/:id | Get rule chain with nodes and connections |
| PUT | /api/rule-chains/:id | Update rule chain (creates version, requires reauth) |
| DELETE | /api/rule-chains/:id | Soft delete (fails if referenced by template) |
| POST | /api/rule-chains/:id/test | Test with sample message (dry-run) |
| GET | /api/rule-chains/:id/versions | List version history |
| GET | /api/rule-chains/:id/versions/:versionId | Get specific version |
| POST | /api/rule-chains/:id/versions/:versionId/restore | Restore version |
| GET | /api/rule-chains/:id/debug | Get debug buffer |
| PUT | /api/rule-chains/:id/debug | Toggle debug mode |
| POST | /api/rule-chains/:id/export | Export as JSON |
| POST | /api/rule-chains/import | Import from JSON |

## 77 Node Types across 8 Categories
- **INPUT** (1): Entry point
- **FILTER** (12): Message Type, Script Filter, Switch, Check Relation, Check Alarm, etc.
- **ENRICHMENT** (10): Entity Attributes/Details, Related/Parent data, Calculate Delta, etc.
- **TRANSFORM** (9): Script Transform, Rename/Copy/Delete Keys, Unit Conversion, etc.
- **ACTION** (15+): Save Timeseries/Attributes, Create/Clear Alarm, Send Email/SMS, etc.
- **EXTERNAL** (9+): REST API Call, MQTT Publish, Kafka, AWS SNS/SQS/Lambda, Slack, AI Request
- **FLOW** (6): Delay, Checkpoint, Sub-chain delegation, Generator, Deduplication
- **ANALYTICS** (4): Aggregate Latest/Stream, Alarms Count, Entity Count

## Scripting
Custom JavaScript in sandboxed VM (isolated-vm, configurable timeout). Available context: msg, metadata, msgType, log().

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
