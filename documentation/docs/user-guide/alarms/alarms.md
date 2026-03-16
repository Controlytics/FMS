# Alarms

Real-time monitoring with lifecycle management.

## Alarm Types
- **Threshold**: value exceeds limit (e.g., temperature > 100)
- **Rate of Change**: value changes too rapidly
- **Absence**: expected data stops arriving

## Lifecycle
ACTIVE -> ACKNOWLEDGED -> CLEARED (or MANUALLY_CLEARED)

## Severity
WARNING, ALARM, CRITICAL

## Management
- Auto-created by rule chains (Create Alarm node)
- Auto-cleared when condition resolves (Clear Alarm node)
- Manual acknowledge/clear with electronic signature (21 CFR Part 11)
- Dashboard with filtering by severity, status, entity, type, date range
