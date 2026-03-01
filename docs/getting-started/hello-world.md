# Hello World — Your First Entity and Telemetry

This tutorial walks you through creating your first entity, connecting a device, and viewing telemetry data in DigiLog. You will complete these steps in under 15 minutes.

---

## Prerequisites

- DigiLog instance running (API + frontend accessible)
- Admin credentials (default: `admin` / `Admin@123`)
- A tool to send HTTP requests (curl, Postman, or Python)

---

## Step 1: Log In

1. Open your DigiLog instance in a browser (e.g., `http://your-server-ip`).
2. Enter your username and password.
3. If this is your first login, you may be prompted to change your password.
4. If an active session exists, click **Continue Here** to terminate the previous session.

> **Note:** The default admin account requires `force: true` when logging in via API due to the single-session policy.

---

## Step 2: Create an Asset Template

Before creating entities, you need a template that defines the entity's structure.

1. Navigate to **Entity Explorer** from the left sidebar.
2. Click the **Templates** tab at the top.
3. Click **Create Template**.
4. Fill in the template details:

| Field | Value |
|-------|-------|
| **Name** | Temperature Sensor |
| **Category** | Sensor |
| **Description** | A basic temperature and humidity sensor |
| **Max Connections** | 10 |
| **Max Parent Connections** | 1 |

5. Under **Attribute Schema**, add attributes:
   - `location` (Type: Text)
   - `firmware_version` (Type: Text)
   - `threshold_celsius` (Type: Number, Default: 40)

6. Under **Telemetry Keys**, add:
   - `temperature`
   - `humidity`

7. Enable **Data Ingestion** and select transport protocol **HTTP**.

8. Click **Save**.

---

## Step 3: Create an Entity

1. Return to the **Entity Explorer** (Entities tab).
2. Click **Create Entity**.
3. Select the **Temperature Sensor** template.
4. Enter a name: `Warehouse-Sensor-01`.
5. Fill in attributes:
   - Location: `Building A, Room 101`
   - Firmware Version: `1.0.0`
6. Click **Create**.

The entity appears in the hierarchy tree. Click on it to open the **Entity Detail Panel**.

---

## Step 4: Get the Device Access Token

1. In the Entity Detail Panel, click the **Connectivity** tab.
2. You will see a device access token was auto-generated.
3. Copy the access token — you'll use it to send data.
4. Note the **Code Snippets** section, which provides ready-to-use examples.

---

## Step 5: Send Telemetry Data

Use any of the following methods to send telemetry:

### Using curl

```bash
curl -X POST "http://your-server-ip/api/data/telemetry" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 25.5, "humidity": 60}'
```

### Using Python

```python
import requests

url = "http://your-server-ip/api/data/telemetry"
headers = {
    "Authorization": "Bearer YOUR_ACCESS_TOKEN",
    "Content-Type": "application/json"
}
data = {"temperature": 25.5, "humidity": 60}

response = requests.post(url, json=data, headers=headers)
print(response.status_code, response.json())
```

### Using Node.js

```javascript
const res = await fetch('http://your-server-ip/api/data/telemetry', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_ACCESS_TOKEN',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ temperature: 25.5, humidity: 60 }),
});
console.log(await res.json());
```

You should receive a `200 OK` response confirming the data was ingested.

---

## Step 6: View Telemetry

1. In the Entity Detail Panel, click the **Telemetry** tab.
2. You will see the latest values for `temperature` and `humidity`.
3. Use the time range selector to view historical data.
4. The **Latest Telemetry** section shows real-time values updated via WebSocket.

---

## Step 7: Send Device Attributes

Attributes are static properties of the device that change infrequently:

```bash
curl -X POST "http://your-server-ip/api/data/attributes" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"firmware_version": "1.2.3", "model": "SensorX-200"}'
```

View attributes in the **Attributes** tab of the Entity Detail Panel.

---

## Step 8: Check Connectivity Status

1. In the **Connectivity** tab, observe the connection status indicator.
2. After sending data, the status changes from `OFFLINE` to `ONLINE`.
3. The **last activity** timestamp updates with each data submission.

---

## What's Next?

You've successfully created an entity, sent telemetry, and viewed data. Here's what to explore next:

- [Asset Templates](../user-guide/templates/asset-templates.md) — Design templates with complex attribute schemas
- [Rule Engine](../user-guide/rule-engine/overview.md) — Automate data processing and trigger alarms
- [Alarms](../user-guide/alarms/alarms.md) — Set up threshold-based alerts with e-signatures
- [MQTT Connectivity](../user-guide/connectivity/mqtt.md) — Connect devices via MQTT for real-time streaming
- [Checklists](../user-guide/checklists/checklists.md) — Create inspection forms with QR code access
