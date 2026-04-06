# Alarms

Real-time monitoring with lifecycle management and electronic signatures.

## Alarm Types
- **Threshold**: Value exceeds limit (e.g., temperature > 100)
- **Rate of Change**: Value changes too rapidly within a time window
- **Absence**: Expected data stops arriving within timeout period

## Lifecycle
ACTIVE -> ACKNOWLEDGED -> CLEARED (or MANUALLY_CLEARED)

## Severity
WARNING, ALARM, CRITICAL

## Management
- Auto-created by rule chains (Create Alarm node) based on telemetry evaluation
- Auto-cleared when condition resolves (Clear Alarm node)
- Manual acknowledge/clear with electronic signature (21 CFR Part 11 compliant)
- Alarm deduplication prevents duplicate alarms for same condition
- MANUALLY_CLEARED status for operator-initiated clearing
- Dashboard with filtering by severity, status, entity, type, date range
- Role-based column visibility (configurable via Alarm Columns config)

## Rule Chain Integration
The 77-node rule chain engine (8 categories) processes incoming telemetry and generates alarms:
1. INPUT node receives telemetry
2. FILTER nodes evaluate conditions (threshold, script, switch)
3. ACTION nodes create/clear alarms with severity and type
4. EXTERNAL nodes send notifications (email, SMS, Telegram, Slack)

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/queries/alarms` | List alarms with pagination and filters |
| GET | `/api/queries/alarms/:entityId` | List alarms for specific entity |
| POST | `/api/queries/alarms/:id/acknowledge` | Acknowledge alarm (e-signature) |
| POST | `/api/queries/alarms/:id/clear` | Clear alarm (e-signature) |
| POST | `/api/queries/alarms/:id/manual-clear` | Manually clear alarm |

## Phase 2: Filter-Related Alarms
Filter management events can trigger alarms through the rule chain engine:
- PM schedule overdue alerts
- Cleaning cycle duration warnings
- Checklist completion timeout alerts
- Filter lifecycle state change notifications
