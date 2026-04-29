/**
 * Mosquitto ACL Refresh Endpoint
 *
 * On-demand regeneration of Mosquitto's dynamic-security.json from
 * DigiLog's DeviceCredential table. Resolves each ACTIVE credential's
 * UNS path via UnsMapping (or AssetInstance fallback) — same logic as
 * apps/api/src/transport/mqtt-auth-routes.ts.
 *
 * Bearer-auth via MOSQUITTO_REFRESH_TOKEN. Replaces EMQX HTTP webhook
 * auth with Mosquitto's built-in plugin. Registered at
 * /api/internal/mqtt/refresh-acl when USE_MOSQUITTO=true.
 *
 * Mosquitto picks up file changes when sent SIGUSR1 — see
 * scripts/install-mosquitto.ps1 for the reload trigger.
 */

import type { FastifyInstance } from 'fastify';
import { writeFile } from 'node:fs/promises';
import { prisma } from '../lib/prisma.js';
import { generateDynamicSecurity, type DynamicSecurityConfig } from './mosquitto-acl-generator.js';

interface ResolvedDevice {
  token: string;
  unsPath: string;
}

async function resolveDeviceUnsPath(entityId: string): Promise<string | null> {
  const mapping = await prisma.unsMapping.findUnique({ where: { entityId } });
  if (mapping?.unsPath) return mapping.unsPath;
  const instance = await prisma.assetInstance.findUnique({
    where: { id: entityId },
    select: { unsPath: true },
  });
  return instance?.unsPath ?? null;
}

export default async function mosquittoRefreshRoutes(app: FastifyInstance) {
  app.post('/refresh-acl', async (req, reply) => {
    const expected = process.env.MOSQUITTO_REFRESH_TOKEN;
    if (!expected) {
      return reply.code(500).send({ error: 'MOSQUITTO_REFRESH_TOKEN env var not configured' });
    }

    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${expected}`) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const adminPassword = process.env.MOSQUITTO_ADMIN_PASSWORD;
    if (!adminPassword) {
      return reply.code(500).send({ error: 'MOSQUITTO_ADMIN_PASSWORD env var not configured' });
    }

    const credentials = await prisma.deviceCredential.findMany({
      where: { status: 'ACTIVE' },
      select: { entityId: true, accessToken: true },
    });

    const resolved: ResolvedDevice[] = [];
    let skippedCount = 0;
    for (const credential of credentials) {
      const unsPath = await resolveDeviceUnsPath(credential.entityId);
      if (!unsPath) {
        skippedCount++;
        req.log.warn({ entityId: credential.entityId }, 'Skipping device with no resolvable unsPath');
        continue;
      }
      resolved.push({ token: credential.accessToken, unsPath });
    }

    let config: DynamicSecurityConfig;
    try {
      config = await generateDynamicSecurity({ devices: resolved, adminPassword });
    } catch (err) {
      req.log.error({ err }, 'Failed to generate Mosquitto dynamic-security config');
      return reply.code(500).send({ error: (err as Error).message });
    }

    const targetPath = process.env.MOSQUITTO_DYNSEC_PATH ?? './mosquitto/dynamic-security.json';
    await writeFile(targetPath, JSON.stringify(config, null, 2));

    return { wroteFile: true, deviceCount: resolved.length, skippedCount, path: targetPath };
  });
}
