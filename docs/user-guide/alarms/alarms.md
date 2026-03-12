# Alarms

Alarms are triggered alerts that notify operators of abnormal conditions, threshold violations, or critical events. DigiLog's alarm system supports multiple severity levels, requires electronic signatures for acknowledgment (21 CFR Part 11), and propagates through the entity hierarchy.

---

## Alarm Concepts

### What is an Alarm?

An alarm is a notification record associated with an entity that indicates something requires attention. Each alarm has:

| Property | Description |
|----------|-------------|
| **Originator** | The entity that triggered the alarm |
| **Type** | Alarm classification (e.g., `HIGH_TEMPERATURE`, `DEVICE_OFFLINE`) |
| **Severity** | Urgency level: WARNING, ALARM, or CRITICAL |
| **Status** | Current state: ACTIVE, ACKNOWLEDGED, CLEARED, or MANUALLY_CLEARED |
| **Acknowledgment** | Whether an operator has acknowledged the alarm |
| **Timestamp** | When the alarm was created |
| **Details** | Additional context (threshold value, actual value, etc.) |

### Alarm Lifecycle

```
Triggered → ACTIVE → ACKNOWLEDGED → MANUALLY_CLEARED (via e-signature)
                                      ↗
              ACTIVE → MANUALLY_CLEARED (direct clear via e-signature)

              ACTIVE/ACKNOWLEDGED → CLEARED (auto-clear by rule engine)
```

1. **Triggered** — A rule chain or system event creates the alarm.
2. **ACTIVE** — Alarm is visible but no operator has responded.
3. **ACKNOWLEDGED** — An operator has acknowledged the alarm with an electronic signature.
4. **MANUALLY_CLEARED** — An operator has cleared the alarm with an electronic signature and clear details.
5. **CLEARED** — The rule engine's `clear-alarm` node has automatically cleared the alarm.

---

## Severity Levels

| Level | Color | Use Case |
|-------|-------|----------|
| **CRITICAL** | Red | Immediate danger, safety hazard, production stoppage |
| **ALARM** | Orange | Significant issue requiring prompt attention |
| **WARNING** | Yellow | Early indication of potential issue |

## Alarm Rule Types

DigiLog supports 7 alarm rule types that can be defined in entity templates:

| Rule Type | Description |
|-----------|-------------|
| **HIGH** | Triggers when a value exceeds an upper threshold |
| **LOW** | Triggers when a value drops below a lower threshold |
| **HIGH_HIGH** | Critical upper threshold (more severe than HIGH) |
| **LOW_LOW** | Critical lower threshold (more severe than LOW) |
| **RATE_OF_CHANGE** | Triggers when value changes faster than a defined rate |
| **BOOLEAN_STATE** | Triggers on a boolean state transition |
| **CUSTOM** | Custom condition evaluated via script expression |

---

## Creating Alarms

### From Rule Chains

The primary way to create alarms is through the Rule Engine using the **Create Alarm** action node:

1. Add a **Script Filter** node to check a condition (e.g., `msg.temperature > 40`).
2. Connect the `True` output to a **Create Alarm** node.
3. Configure the alarm type, severity, and detail template.
4. Optionally connect a **Clear Alarm** node to the `False` output.

### Alarm Details Template

The Create Alarm node supports template variables in the details field:

```json
{
  "threshold": 40,
  "actualValue": "${temperature}",
  "entityName": "${entityName}",
  "message": "Temperature exceeded threshold: ${temperature}°C > 40°C"
}
```

---

## Alarm Dashboard

The Alarm Dashboard provides a centralized view of all alarms across the system.

### Dashboard Features

| Feature | Description |
|---------|-------------|
| **Filter by severity** | Show only Critical, Major, etc. |
| **Filter by status** | Active, Acknowledged, Cleared |
| **Filter by entity** | Alarms for a specific entity or hierarchy branch |
| **Sort by time** | Most recent alarms first |
| **Bulk operations** | Acknowledge or clear multiple alarms |

### Accessing the Dashboard

Navigate to **Alarms** from the left sidebar. The dashboard shows a table of alarms with columns for severity, type, originator entity, status, and timestamp.

---

## Acknowledging Alarms

Acknowledging an alarm confirms that an operator has seen and is aware of the issue. This action requires an **electronic signature** per 21 CFR Part 11 requirements.

### Steps to Acknowledge

1. Click on an alarm in the Alarm Dashboard.
2. Click **Acknowledge**.
3. Enter your password to provide an electronic signature.
4. Optionally add a comment explaining your response.
5. The alarm status changes to **Acknowledged**.

### Audit Record

The acknowledgment is recorded in the audit trail with:
- Signer's full name and username
- Timestamp of acknowledgment
- Signature meaning: "Alarm acknowledged by operator"
- IP address and user agent

---

## Clearing Alarms

Clearing an alarm indicates the condition has been resolved. This also requires an electronic signature.

### Steps to Clear

1. Click on an acknowledged alarm.
2. Click **Clear Alarm**.
3. Enter your password for electronic signature.
4. Add a resolution comment.
5. The alarm status changes to **Cleared**.

### Auto-Clear

Alarms can be automatically cleared by the Rule Engine when the triggering condition resolves. Configure a **Clear Alarm** node in your rule chain connected to the `False` output of the condition filter.

---

## Alarm Propagation

Alarms propagate through the entity hierarchy for centralized visibility:

- An alarm on a sensor entity is visible on its parent equipment entity.
- An alarm on an equipment entity is visible on its parent line entity.
- This continues up to the enterprise level.

This allows supervisors to see all alarms in their area without navigating to individual entities.

---

## Alarm Notifications

When an alarm is created, DigiLog can send notifications through multiple channels:

| Channel | Configuration |
|---------|--------------|
| **In-app** | Notification bell in the top navigation bar |
| **Email** | Configured via Rule Chain external nodes |
| **MQTT** | Published to the entity's alarm topic |

---

## Next Steps

- [Rule Engine](../rule-engine/overview.md) — Build alarm rules with the visual editor
- [Audit Trail](../../administration/audit/audit-trail.md) — View alarm acknowledgment history
- [21 CFR Part 11](../../compliance/21-cfr-part-11.md) — Electronic signature compliance
