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
 * NOTE — reload contract:
 *   Mosquitto's dynsec plugin reads dynamic-security.json at broker
 *   startup. After /refresh-acl writes a new file, an operator must
 *   restart the Mosquitto service to apply changes:
 *     - Windows:  Restart-Service mosquitto
 *     - Docker:   docker compose restart mosquitto
 *   SIGUSR1 reload is NOT supported on Windows and is not implemented
 *   for the Linux Docker container either. A future Phase will publish
 *   $CONTROL/dynamic-security/v1 messages to apply changes live without
 *   a broker restart.
 *
 * IMPORTANT — operational contract:
 * - Every refresh re-hashes ALL device tokens (bcrypt salts are random
 *   per call), so EVERY successful refresh rotates EVERY connected
 *   client's credential. After SIGUSR1, currently-connected sessions
 *   that still pass already-cached credentials will keep working until
 *   reconnect; new connections must use the freshly-stored hash. Treat
 *   refreshes as session-rotation events.
 * - The refresh is a whole-cloth replacement of broker state from the
 *   current snapshot of DeviceCredential + UnsMapping. There is a small
 *   race window between the SQL queries and the file rename: any DB
 *   writes (new device, status change) that land DURING that window
 *   will not be reflected in this refresh — they will land in the next
 *   refresh. Callers that need strict read-after-write semantics must
 *   serialize their write with a follow-up refresh.
 * - File write is atomic: write `<path>.tmp` then `rename()` over the
 *   target. On Windows `fs.writeFile` is not atomic, so a process
 *   crash mid-write would otherwise truncate dynamic-security.json and
 *   the dynsec plugin would refuse to load → broker start failure.
 */

import type { FastifyInstance } from 'fastify';
import { writeFile, rename } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { auditLog } from '../lib/audit.js';
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
  app.post(
    '/refresh-acl',
    {
      schema: {
        tags: ['Internal — MQTT'],
        summary: 'Regenerate Mosquitto dynamic-security from DeviceCredential table',
        response: {
          200: {
            type: 'object',
            properties: {
              wroteFile: { type: 'boolean' },
              deviceCount: { type: 'integer' },
              skippedCount: { type: 'integer' },
              path: { type: 'string' },
            },
          },
          401: {
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          500: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const expected = process.env.MOSQUITTO_REFRESH_TOKEN;
      if (!expected) {
        return reply.code(500).send({ error: 'MOSQUITTO_REFRESH_TOKEN env var not configured' });
      }

      const auth = req.headers.authorization ?? '';
      const expectedBearer = `Bearer ${expected}`;
      const expectedBuf = Buffer.from(expectedBearer, 'utf8');
      const actualBuf = Buffer.from(auth, 'utf8');
      if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
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
        // Audit S-12: log full error server-side; return generic message to caller
        req.log.error(err, 'mosquitto-refresh failed');
        return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Mosquitto refresh failed' });
      }

      const targetPath = process.env.MOSQUITTO_DYNSEC_PATH ?? './mosquitto/dynamic-security.json';
      const tmpPath = `${targetPath}.tmp`;
      try {
        // Atomic write: tmp → rename. Mosquitto's dynsec plugin rejects
        // a truncated file, and on Windows fs.writeFile is not atomic.
        await writeFile(tmpPath, JSON.stringify(config, null, 2));
        await rename(tmpPath, targetPath);
      } catch (err) {
        req.log.error({ err, targetPath }, 'Failed to write Mosquitto dynamic-security.json');
        return reply.code(500).send({
          error: 'WRITE_FAILED',
          message: (err as Error).message,
        });
      }

      // 21 CFR Part 11 audit: this endpoint mutates the entire MQTT
      // broker's authn/authz state, so it must be logged. No JWT user
      // on this route (Bearer-shared-secret only), so userId is null.
      try {
        await auditLog({
          action: 'MOSQUITTO_ACL_REFRESH',
          targetType: 'mqtt-broker',
          targetId: 'global',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          afterValue: { deviceCount: resolved.length, skippedCount, path: targetPath },
          signatureMeaning: 'Regenerated Mosquitto dynamic-security from DeviceCredential table',
        });
      } catch (err) {
        // Audit failure must NOT roll back the file write — broker
        // state is already updated. Log loudly so ops sees the gap.
        req.log.error({ err }, 'Failed to write MOSQUITTO_ACL_REFRESH audit entry');
      }

      return { wroteFile: true, deviceCount: resolved.length, skippedCount, path: targetPath };
    }
  );
}
