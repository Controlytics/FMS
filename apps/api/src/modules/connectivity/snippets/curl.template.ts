import type { SnippetContext, Transport } from './types.js';

export function renderCurl(transport: Transport, ctx: SnippetContext): string {
  return transport === 'MQTT' ? mqtt(ctx) : http(ctx);
}

function mqtt(ctx: SnippetContext): string {
  return `# Entity: ${ctx.entityName}
# UNS Path: ${ctx.unsPath}
# Requires: mosquitto-clients (apt install mosquitto-clients)

# Send telemetry data
mosquitto_pub -h ${ctx.mqttHost} -p 1883 \\
  -u "${ctx.token}" \\
  -t "${ctx.telemetryTopic}" \\
  -m '{"temperature": 25.5, "humidity": 60}'

# Send attributes
mosquitto_pub -h ${ctx.mqttHost} -p 1883 \\
  -u "${ctx.token}" \\
  -t "${ctx.attributesTopic}" \\
  -m '{"firmware_version": "1.2.3", "model": "SensorX"}'`;
}

function http(ctx: SnippetContext): string {
  return `# Entity: ${ctx.entityName}
# UNS Path: ${ctx.unsPath}

# Send telemetry data
curl -X POST "${ctx.apiUrl}/api/data/telemetry" \\
  -H "Authorization: Bearer ${ctx.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"temperature": 25.5, "humidity": 60}'

# Send attributes
curl -X POST "${ctx.apiUrl}/api/data/attributes" \\
  -H "Authorization: Bearer ${ctx.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"firmware_version": "1.2.3", "model": "SensorX"}'`;
}
