# Entity Reference — Full Details

## Entities with Device Credentials

| Entity | ID | Template | Transport |
|--------|----|----------|-----------|
| Pipeline-Sensor-001 | `f865b8a8-3c6d-4864-bd14-1017ee84b560` | MQTT Pressure Sensor | MQTT |
| FlowMeter-WTP-001 | `e5c629a7-28c6-449f-b182-b0f94bf747fd` | HTTP Flow Meter | HTTP |
| VibSensor-Motor-001 | `f2134b34-a1b0-4bc9-9680-73546a1cc8d6` | WebSocket Vibration Sensor | HTTP* |
| TemperatureSensor | `25f6bcc0-5987-404e-a9d6-07e30c22a000` | Temperature Sensor v2 | MQTT |

*VibSensor-Motor-001 template is "WebSocket" but actual data ingestion uses HTTP (no WS device ingestion endpoint exists).

## Access Tokens

| Entity | Full Access Token |
|--------|-------------------|
| Pipeline-Sensor-001 | `a25a3b98edbcbf3ceb47e5aa318fae8820b9394883dcee21c551e2eb6b1e01df` |
| FlowMeter-WTP-001 | `bdadb00c06fd4e76a2be212d0e833136148e5a99ee2e1fcce8277780593f69e5` |
| VibSensor-Motor-001 | `96a1101195525160a83e761d33a66a041523b36c319b11e43025599092c95f5d` |
| TemperatureSensor | `Welcome@123` |

## UNS Paths (for MQTT topics)

| Entity | UNS Path | Telemetry Topic | Attributes Topic |
|--------|----------|-----------------|------------------|
| Pipeline-Sensor-001 | `digilog/v1/pipeline-sensor-001` | `digilog/v1/pipeline-sensor-001/telemetry` | `digilog/v1/pipeline-sensor-001/attributes` |
| FlowMeter-WTP-001 | `digilog/v1/flowmeter-wtp-001` | `digilog/v1/flowmeter-wtp-001/telemetry` | `digilog/v1/flowmeter-wtp-001/attributes` |
| VibSensor-Motor-001 | `digilog/v1/vibsensor-motor-001` | `digilog/v1/vibsensor-motor-001/telemetry` | `digilog/v1/vibsensor-motor-001/attributes` |
| TemperatureSensor | `digilog/v1/temperaturesensor` | `digilog/v1/temperaturesensor/telemetry` | `digilog/v1/temperaturesensor/attributes` |

## Telemetry Keys (per template schema)

| Entity | Key 1 | Key 2 | Unit 1 | Unit 2 |
|--------|-------|-------|--------|--------|
| Pipeline-Sensor-001 | pressure | temperature | PSI | °C |
| FlowMeter-WTP-001 | flowRate | totalVolume | L/min | - |
| VibSensor-Motor-001 | vibrationX | vibrationY | mm/s | mm/s |
| TemperatureSensor | temperature | humidity | °C | % |

## Attribute Keys (per template schema)

| Entity | Key 1 | Key 2 |
|--------|-------|-------|
| Pipeline-Sensor-001 | serialNumber | maxPressure |
| FlowMeter-WTP-001 | meterModel | calibrationDate |
| VibSensor-Motor-001 | motorId | installDate |
| TemperatureSensor | firmwareVersion | location |


## Phase 2 (2026-03-27)
Digital Filter Management System added with filter operations, cleaning profiles, checklist gates, PM scheduling, and full traceability.

