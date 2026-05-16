import type { SnippetContext, Transport } from './types.js';

export function renderNodejs(transport: Transport, ctx: SnippetContext): string {
  return transport === 'MQTT' ? mqtt(ctx) : http(ctx);
}

function mqtt(ctx: SnippetContext): string {
  return `const mqtt = require('mqtt');

// Entity: ${ctx.entityName}
// UNS Path: ${ctx.unsPath}

const BROKER = 'mqtt://${ctx.mqttHost}:1883';
const TOKEN = '${ctx.token}';
const TELEMETRY_TOPIC = '${ctx.telemetryTopic}';
const ATTRIBUTES_TOPIC = '${ctx.attributesTopic}';

const client = mqtt.connect(BROKER, { username: TOKEN });

client.on('connect', () => {
  // MQTT broker connected

  // Send telemetry data
  const data = { temperature: 25.5, humidity: 60 };
  client.publish(TELEMETRY_TOPIC, JSON.stringify(data));
  // Telemetry sent

  // Send attributes
  const attributes = { firmware_version: '1.2.3', model: 'SensorX' };
  client.publish(ATTRIBUTES_TOPIC, JSON.stringify(attributes));
  // Attributes sent

  client.end();
});

client.on('error', (err) => console.error('MQTT error:', err));`;
}

function http(ctx: SnippetContext): string {
  return `const fetch = require('node-fetch');

// Entity: ${ctx.entityName}
// UNS Path: ${ctx.unsPath}

const API_URL = '${ctx.apiUrl}';
const TOKEN = '${ctx.token}';

const headers = {
  'Authorization': \`Bearer \${TOKEN}\`,
  'Content-Type': 'application/json',
};

// Send telemetry data
async function sendTelemetry() {
  const data = { temperature: 25.5, humidity: 60 };
  const res = await fetch(\`\${API_URL}/api/data/telemetry\`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  // Response logged
}

// Send attributes
async function sendAttributes() {
  const attributes = { firmware_version: '1.2.3', model: 'SensorX' };
  const res = await fetch(\`\${API_URL}/api/data/attributes\`, {
    method: 'POST',
    headers,
    body: JSON.stringify(attributes),
  });
  // Response logged
}

sendTelemetry();`;
}
