# Hello World — Quick Start

## 1. Login
Navigate to your DigiLog instance and login:
- **Username:** superadmin
- **Password:** Admin@123

## 2. Create an Entity Template
1. Go to **Assets > Templates**
2. Click **Create Template**
3. Name: "Temperature Sensor", Category: "Sensor"
4. Add an attribute: key=location, type=string, required=true
5. Add an alarm rule: name="High Temp", type=THRESHOLD, field=temperature, condition=> 100, severity=CRITICAL
6. Save

## 3. Create an Entity Instance
1. Go to **Assets**
2. Click **Create Entity**
3. Select template "Temperature Sensor"
4. Name: "Sensor-01", fill location attribute
5. Save

## 4. Provision Connectivity
1. Open Sensor-01 > **Connectivity** tab
2. Click **Provision Credential**
3. Copy the access token

## 5. Send Telemetry


## 6. Verify
- Check entity > **Telemetry** tab for the data
- Send temperature > 100 to trigger the alarm
- Check **Alarms** dashboard
