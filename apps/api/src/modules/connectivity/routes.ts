import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { randomBytes } from 'node:crypto';
import { errorResponses } from '../../lib/error-schemas.js';
import { provisionUnsMapping } from '../uns/uns.service.js';
import { getEntityUnsPath } from '../../lib/uns-path.js';

export default async function connectivityRoutes(app: FastifyInstance) {

  // ─── GET /:entityId — Get connectivity status ──────────
  app.get('/:entityId', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Connectivity'],
      summary: 'Get entity connectivity status',
      description: 'Returns the connectivity status and device credential info for an entity.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            connectivity: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                entityId: { type: 'string' },
                status: { type: 'string' },
                lastActivityAt: { type: ['string', 'null'], format: 'date-time' },
                lastConnectedAt: { type: ['string', 'null'], format: 'date-time' },
                lastDisconnectedAt: { type: ['string', 'null'], format: 'date-time' },
                protocol: { type: ['string', 'null'] },
                sourceIp: { type: ['string', 'null'] },
                updatedAt: { type: 'string', format: 'date-time' },
              },
            },
            credential: {
              type: ['object', 'null'],
              nullable: true,
              properties: {
                token: { type: 'string' },
                isActive: { type: 'boolean' },
                createdAt: { type: 'string', format: 'date-time' },
                lastUsedAt: { type: ['string', 'null'], format: 'date-time' },
                allowedIps: { type: 'array', items: { type: 'string' } },
                maxDataRatePerMin: { type: 'integer' },
                allowedTopics: { type: 'array', items: { type: 'string' } },
              },
            },
            unsPath: { type: ['string', 'null'] },
            topics: { type: 'array', items: { type: 'string' } },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { entityId } = req.params as { entityId: string };

    const connectivity = await prisma.connectivityStatus.findUnique({
      where: { entityId },
    });

    const credential = await prisma.deviceCredential.findUnique({
      where: { entityId },
      select: {
        accessToken: true,
        isActive: true,
        createdAt: true,
        lastConnectedAt: true,
        allowedIps: true,
        maxDataRatePerMin: true,
        credentialData: true,
      },
    });

    const unsMapping = await prisma.unsMapping.findUnique({
      where: { entityId },
    });

    const connectivityResult = connectivity ?? {
      id: null,
      entityId,
      status: 'UNKNOWN',
      lastActivityAt: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      protocol: null,
      sourceIp: null,
      updatedAt: new Date(),
    };

    const credentialResult = credential
      ? {
          token: credential.accessToken,
          isActive: credential.isActive,
          createdAt: credential.createdAt,
          lastUsedAt: credential.lastConnectedAt,
          allowedIps: credential.allowedIps,
          maxDataRatePerMin: credential.maxDataRatePerMin,
          allowedTopics: (credential.credentialData as Record<string, unknown>)?.allowedTopics as string[] ?? [],
        }
      : null;

    let unsPath = unsMapping?.unsPath ?? null;
    if (!unsPath) {
      const entity = await prisma.assetInstance.findUnique({
        where: { id: entityId },
        include: { template: { select: { name: true } } },
      });
      if (entity) unsPath = getEntityUnsPath(entity);
    }

    return {
      connectivity: connectivityResult,
      credential: credentialResult,
      unsPath,
      topics: credentialResult?.allowedTopics ?? [],
    };
  });

  // ─── POST /:entityId/test — Test entity connectivity ───
  app.post('/:entityId/test', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Connectivity'],
      summary: 'Test entity connectivity',
      description: 'Tests whether a device is reachable by checking its credential and connectivity status.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        additionalProperties: true,
      },
      response: {
        200: {
          type: 'object',
          properties: {
            reachable: { type: 'boolean' },
            protocol: { type: ['string', 'null'] },
            lastActivityAt: { type: ['string', 'null'], format: 'date-time' },
            tokenStatus: { type: 'string', enum: ['ACTIVE', 'NEVER_USED', 'REVOKED', 'NOT_CONFIGURED'] },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { entityId } = req.params as { entityId: string };

    const credential = await prisma.deviceCredential.findUnique({
      where: { entityId },
      select: {
        isActive: true,
        firstConnectedAt: true,
      },
    });

    const connectivity = await prisma.connectivityStatus.findUnique({
      where: { entityId },
    });

    let tokenStatus: 'ACTIVE' | 'NEVER_USED' | 'REVOKED' | 'NOT_CONFIGURED';
    if (!credential) {
      tokenStatus = 'NOT_CONFIGURED';
    } else if (!credential.isActive) {
      tokenStatus = 'REVOKED';
    } else if (!credential.firstConnectedAt) {
      tokenStatus = 'NEVER_USED';
    } else {
      tokenStatus = 'ACTIVE';
    }

    const reachable = connectivity?.status === 'ONLINE' && tokenStatus === 'ACTIVE';

    return {
      reachable,
      protocol: connectivity?.protocol ?? null,
      lastActivityAt: connectivity?.lastActivityAt ?? null,
      tokenStatus,
    };
  });

  // ─── GET /:entityId/snippets — Get connection code snippets ───
  app.get('/:entityId/snippets', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Connectivity'],
      summary: 'Get connection code snippets',
      description: 'Generates code snippets in multiple languages for connecting a device to the platform.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            snippets: {
              type: 'object',
              properties: {
                python: { type: 'string' },
                nodejs: { type: 'string' },
                curl: { type: 'string' },
                c: { type: 'string' },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params as { entityId: string };

    const entity = await prisma.assetInstance.findUnique({
      where: { id: entityId },
      include: { template: { select: { id: true, name: true, transportType: true } } },
    });

    if (!entity) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Entity not found' });
    }

    const credential = await prisma.deviceCredential.findUnique({
      where: { entityId },
      select: { accessToken: true, isActive: true },
    });

    const rawToken = credential?.accessToken;
    const token = rawToken ?? '<YOUR_DEVICE_TOKEN>';
    const unsPath = getEntityUnsPath(entity);
    const apiUrl = process.env.CORS_ORIGIN || process.env.ALLOWED_ORIGINS?.split(',')[0] || 'http://localhost:3000';

    const transportType = entity.template?.transportType ?? 'HTTP';
    const isMqtt = transportType === 'MQTT';

    // ── MQTT snippets ──────────────────────────────────────────
    const mqttBroker = apiUrl.replace(/^https?:\/\//, '');
    const mqttHost = mqttBroker.split(':')[0];
    const telemetryTopic = `${unsPath}/telemetry`;
    const attributesTopic = `${unsPath}/attributes`;

    const pythonMqtt = `import paho.mqtt.client as mqtt
import json, time

# Entity: ${entity.name}
# UNS Path: ${unsPath}

BROKER = "${mqttHost}"
PORT = 1883
TOKEN = "${token}"
TELEMETRY_TOPIC = "${telemetryTopic}"
ATTRIBUTES_TOPIC = "${attributesTopic}"

client = mqtt.Client()
client.username_pw_set(TOKEN)

def on_connect(client, userdata, flags, rc):
    print("Connected" if rc == 0 else f"Failed: {rc}")

client.on_connect = on_connect
client.connect(BROKER, PORT)
client.loop_start()

# Send telemetry data
data = {"temperature": 25.5, "humidity": 60}
client.publish(TELEMETRY_TOPIC, json.dumps(data))
print("Telemetry sent")

# Send attributes
attributes = {"firmware_version": "1.2.3", "model": "SensorX"}
client.publish(ATTRIBUTES_TOPIC, json.dumps(attributes))
print("Attributes sent")

time.sleep(1)
client.disconnect()`;

    const nodejsMqtt = `const mqtt = require('mqtt');

// Entity: ${entity.name}
// UNS Path: ${unsPath}

const BROKER = 'mqtt://${mqttHost}:1883';
const TOKEN = '${token}';
const TELEMETRY_TOPIC = '${telemetryTopic}';
const ATTRIBUTES_TOPIC = '${attributesTopic}';

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

    const curlMqtt = `# Entity: ${entity.name}
# UNS Path: ${unsPath}
# Requires: mosquitto-clients (apt install mosquitto-clients)

# Send telemetry data
mosquitto_pub -h ${mqttHost} -p 1883 \\
  -u "${token}" \\
  -t "${telemetryTopic}" \\
  -m '{"temperature": 25.5, "humidity": 60}'

# Send attributes
mosquitto_pub -h ${mqttHost} -p 1883 \\
  -u "${token}" \\
  -t "${attributesTopic}" \\
  -m '{"firmware_version": "1.2.3", "model": "SensorX"}'`;

    const cMqtt = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "MQTTClient.h"

// Entity: ${entity.name}
// UNS Path: ${unsPath}

#define BROKER  "tcp://${mqttHost}:1883"
#define TOKEN   "${token}"
#define TEL_TOPIC "${telemetryTopic}"
#define ATTR_TOPIC "${attributesTopic}"
#define CLIENTID  "digilog_device"
#define QOS 1

int main() {
    MQTTClient client;
    MQTTClient_connectOptions opts = MQTTClient_connectOptions_initializer;
    MQTTClient_message msg = MQTTClient_message_initializer;
    MQTTClient_deliveryToken dt;

    MQTTClient_create(&client, BROKER, CLIENTID, MQTTCLIENT_PERSISTENCE_NONE, NULL);
    opts.username = TOKEN;
    opts.keepAliveInterval = 20;
    opts.cleansession = 1;

    if (MQTTClient_connect(client, &opts) != MQTTCLIENT_SUCCESS) {
        printf("Connection failed\\n");
        return 1;
    }
    printf("Connected to MQTT broker\\n");

    // Send telemetry
    const char *telemetry = "{\\"temperature\\": 25.5, \\"humidity\\": 60}";
    msg.payload = (void *)telemetry;
    msg.payloadlen = strlen(telemetry);
    msg.qos = QOS;
    MQTTClient_publishMessage(client, TEL_TOPIC, &msg, &dt);
    MQTTClient_waitForCompletion(client, dt, 5000);
    printf("Telemetry sent\\n");

    // Send attributes
    const char *attrs = "{\\"firmware_version\\": \\"1.2.3\\", \\"model\\": \\"SensorX\\"}";
    msg.payload = (void *)attrs;
    msg.payloadlen = strlen(attrs);
    MQTTClient_publishMessage(client, ATTR_TOPIC, &msg, &dt);
    MQTTClient_waitForCompletion(client, dt, 5000);
    printf("Attributes sent\\n");

    MQTTClient_disconnect(client, 1000);
    MQTTClient_destroy(&client);
    return 0;
}
// Compile: gcc -o device device.c -lpaho-mqtt3c`;

    // ── HTTP snippets ──────────────────────────────────────────
    const pythonHttp = `import requests

# Entity: ${entity.name}
# UNS Path: ${unsPath}

url = "${apiUrl}/api/data/telemetry"
headers = {
    "Authorization": "Bearer ${token}",
    "Content-Type": "application/json"
}

# Send telemetry data
data = {"temperature": 25.5, "humidity": 60}
response = requests.post(url, json=data, headers=headers)
print(response.status_code, response.json())

# Send attributes
attr_url = "${apiUrl}/api/data/attributes"
attributes = {"firmware_version": "1.2.3", "model": "SensorX"}
response = requests.post(attr_url, json=attributes, headers=headers)
print(response.status_code, response.json())`;

    const nodejsHttp = `const fetch = require('node-fetch');

// Entity: ${entity.name}
// UNS Path: ${unsPath}

const API_URL = '${apiUrl}';
const TOKEN = '${token}';

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

    const curlHttp = `# Entity: ${entity.name}
# UNS Path: ${unsPath}

# Send telemetry data
curl -X POST "${apiUrl}/api/data/telemetry" \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"temperature": 25.5, "humidity": 60}'

# Send attributes
curl -X POST "${apiUrl}/api/data/attributes" \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"firmware_version": "1.2.3", "model": "SensorX"}'`;

    const cHttp = `#include <stdio.h>
#include <string.h>
#include <curl/curl.h>

// Entity: ${entity.name}
// UNS Path: ${unsPath}

#define API_URL "${apiUrl}/api/data/telemetry"
#define ATTR_URL "${apiUrl}/api/data/attributes"
#define TOKEN   "${token}"

int send_post(const char *url, const char *json) {
    CURL *curl = curl_easy_init();
    if (!curl) return 1;

    struct curl_slist *headers = NULL;
    char auth[256];
    snprintf(auth, sizeof(auth), "Authorization: Bearer %s", TOKEN);
    headers = curl_slist_append(headers, "Content-Type: application/json");
    headers = curl_slist_append(headers, auth);

    curl_easy_setopt(curl, CURLOPT_URL, url);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, json);

    CURLcode res = curl_easy_perform(curl);
    if (res != CURLE_OK)
        fprintf(stderr, "Request failed: %s\\n", curl_easy_strerror(res));

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    return (int)res;
}

int main() {
    curl_global_init(CURL_GLOBAL_ALL);

    // Send telemetry
    send_post(API_URL, "{\\"temperature\\": 25.5, \\"humidity\\": 60}");
    printf("Telemetry sent\\n");

    // Send attributes
    send_post(ATTR_URL, "{\\"firmware_version\\": \\"1.2.3\\", \\"model\\": \\"SensorX\\"}");
    printf("Attributes sent\\n");

    curl_global_cleanup();
    return 0;
}
// Compile: gcc -o device device.c -lcurl`;

    return {
      snippets: {
        python: isMqtt ? pythonMqtt : pythonHttp,
        nodejs: isMqtt ? nodejsMqtt : nodejsHttp,
        curl: isMqtt ? curlMqtt : curlHttp,
        c: isMqtt ? cMqtt : cHttp,
      },
    };
  });

  // ─── POST /:entityId/token — Generate new device token ───
  app.post('/:entityId/token', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Connectivity'],
      summary: 'Generate new device token',
      description: 'Generates a new 64-character hex device access token. Upserts the device credential for the entity.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          customToken: { type: 'string', minLength: 8, maxLength: 128 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params as { entityId: string };

    // Verify entity exists
    const entity = await prisma.assetInstance.findUnique({
      where: { id: entityId },
      select: { id: true, unsPath: true, name: true, template: { select: { name: true } } },
    });

    if (!entity) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Entity not found' });
    }

    // Provision UNS mapping (builds ISA-95 path from hierarchy)
    try {
      await provisionUnsMapping(entityId);
    } catch {
      // Non-fatal: UNS mapping is best-effort during token provisioning
    }

    // Re-fetch entity to get the freshly computed unsPath
    const updatedEntity = await prisma.assetInstance.findUnique({
      where: { id: entityId },
      select: { unsPath: true, name: true, template: { select: { name: true } } },
    });

    const customToken = (req.body as any)?.customToken;
    const token = customToken || randomBytes(32).toString('hex');
    const unsPath = getEntityUnsPath(updatedEntity ?? entity);

    // Build allowed topics from the entity's UNS path
    const allowedTopics = [
      `${unsPath}/telemetry`,
      `${unsPath}/attributes`,
      `${unsPath}/events`,
      `${unsPath}/rpc/request`,
      `${unsPath}/rpc/response`,
    ];

    // Check if custom token is already in use by another entity
    if (customToken) {
      const existing = await prisma.deviceCredential.findUnique({
        where: { accessToken: customToken },
        select: { entityId: true },
      });
      if (existing && existing.entityId !== entityId) {
        return reply.code(409).send({
          error: 'TOKEN_CONFLICT',
          message: 'This token is already in use by another entity. Please choose a different token.',
        });
      }
    }

    const credential = await prisma.deviceCredential.upsert({
      where: { entityId },
      create: {
        entityId,
        accessToken: token,
        status: 'ACTIVE',
        isActive: true,
        credentialData: { allowedTopics },
      },
      update: {
        accessToken: token,
        status: 'ACTIVE',
        isActive: true,
        credentialData: { allowedTopics },
        createdAt: new Date(),
      },
    });

    return {
      token,
      createdAt: credential.createdAt,
    };
  });

  // ─── DELETE /:entityId/token — Revoke device token ─────
  app.delete('/:entityId/token', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Connectivity'],
      summary: 'Revoke device token',
      description: 'Revokes the device access token and sets connectivity status to OFFLINE.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            revoked: { type: 'boolean' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params as { entityId: string };

    // Update device credential to inactive
    const credential = await prisma.deviceCredential.findUnique({
      where: { entityId },
    });

    if (!credential) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'No device credential found for this entity' });
    }

    await prisma.deviceCredential.update({
      where: { entityId },
      data: {
        isActive: false,
        status: 'INACTIVE',
      },
    });

    // Update connectivity status to OFFLINE
    await prisma.connectivityStatus.upsert({
      where: { entityId },
      create: {
        entityId,
        status: 'OFFLINE',
        lastDisconnectedAt: new Date(),
      },
      update: {
        status: 'OFFLINE',
        lastDisconnectedAt: new Date(),
      },
    });

    return { revoked: true };
  });

  // ─── GET /:entityId/history — Connection history ───────
  app.get('/:entityId/history', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Connectivity'],
      summary: 'Get connection history',
      description: 'Returns connection/disconnection events from the time-series database for the specified period.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['24h', '7d', '30d'],
            default: '24h',
          },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              time: { type: 'string', format: 'date-time' },
              eventType: { type: 'string' },
              details: { type: ['object', 'null'], additionalProperties: true },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { entityId } = req.params as { entityId: string };
    const { period } = req.query as { period?: string };

    const intervalMap: Record<string, string> = {
      '24h': '24 hours',
      '7d': '7 days',
      '30d': '30 days',
    };
    const interval = intervalMap[period ?? '24h'] ?? '24 hours';

    const events = await prisma.$queryRawUnsafe<
      Array<{ time: Date; event_type: string; details: unknown }>
    >(
      `SELECT time, event_type, details
       FROM ts_device_events
       WHERE entity_id = $1::uuid
         AND event_type IN ('CONNECTED', 'DISCONNECTED')
         AND time >= NOW() - $2::interval
       ORDER BY time DESC`,
      entityId,
      interval,
    );

    return events.map((e) => ({
      time: e.time,
      eventType: e.event_type,
      details: e.details ?? null,
    }));
  });
}
