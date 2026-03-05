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
                arduino: { type: 'string' },
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
      include: { template: { select: { id: true, name: true } } },
    });

    if (!entity) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Entity not found' });
    }

    const credential = await prisma.deviceCredential.findUnique({
      where: { entityId },
      select: { accessToken: true, isActive: true },
    });

    // Mask token in snippets — show only last 8 chars as hint, user copies full token from Credentials tab
    const rawToken = credential?.accessToken;
    const token = rawToken
      ? `<TOKEN_ENDING_...${rawToken.slice(-8)}>`
      : '<YOUR_DEVICE_TOKEN>';
    const unsPath = getEntityUnsPath(entity);
    const apiUrl = process.env.CORS_ORIGIN || process.env.ALLOWED_ORIGINS?.split(',')[0] || 'http://localhost:3000';

    const python = `import requests

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

    const nodejs = `const fetch = require('node-fetch');

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
  console.log(await res.json());
}

// Send attributes
async function sendAttributes() {
  const attributes = { firmware_version: '1.2.3', model: 'SensorX' };
  const res = await fetch(\`\${API_URL}/api/data/attributes\`, {
    method: 'POST',
    headers,
    body: JSON.stringify(attributes),
  });
  console.log(await res.json());
}

sendTelemetry();`;

    const curl = `# Entity: ${entity.name}
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

    const arduino = `#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// Entity: ${entity.name}
// UNS Path: ${unsPath}

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* apiUrl = "${apiUrl}/api/data/telemetry";
const char* token = "${token}";

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.println("Connecting to WiFi...");
  }
  Serial.println("Connected to WiFi");
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(apiUrl);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", String("Bearer ") + token);

    StaticJsonDocument<200> doc;
    doc["temperature"] = 25.5;
    doc["humidity"] = 60;

    String payload;
    serializeJson(doc, payload);

    int httpCode = http.POST(payload);
    Serial.printf("HTTP Response: %d\\n", httpCode);

    if (httpCode > 0) {
      Serial.println(http.getString());
    }

    http.end();
  }
  delay(5000); // Send every 5 seconds
}`;

    return {
      snippets: {
        python,
        nodejs,
        curl,
        arduino,
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
