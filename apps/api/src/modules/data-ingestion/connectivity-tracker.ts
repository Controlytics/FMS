/**
 * Connectivity Tracker — Updates entity connectivity status.
 * On data received: ONLINE + update lastActivityAt
 * On LWT: OFFLINE (handled by Phase B mqtt-handler)
 * Maintenance job: checks inactivity timeouts, marks entities OFFLINE
 */

import { prisma } from '../../lib/prisma.js';
import { addDeviceEventRow } from '@digilog/db';

/** Update entity connectivity to ONLINE on data received. */
export async function markOnline(
  entityId: string,
  protocol: string,
  sourceIp: string,
  unsPath: string,
): Promise<void> {
  const now = new Date();

  await prisma.connectivityStatus.upsert({
    where: { entityId },
    create: {
      entityId,
      status: 'ONLINE',
      lastActivityAt: now,
      lastConnectedAt: now,
      protocol: protocol.toUpperCase(),
      sourceIp,
    },
    update: {
      status: 'ONLINE',
      lastActivityAt: now,
      lastConnectedAt: now,
      protocol: protocol.toUpperCase(),
      sourceIp,
    },
  });

  // Update DeviceCredential timestamps (firstConnectedAt only on first connection)
  try {
    const credential = await prisma.deviceCredential.findUnique({
      where: { entityId },
      select: { firstConnectedAt: true },
    });
    if (credential) {
      await prisma.deviceCredential.update({
        where: { entityId },
        data: {
          lastConnectedAt: now,
          lastSourceIp: sourceIp,
          ...(credential.firstConnectedAt ? {} : { firstConnectedAt: now }),
        },
      });
    }
  } catch {
    // Non-critical: connectivity status is the primary source of truth
  }

  // Log activity event (batched)
  addDeviceEventRow({
    time: now,
    entityId,
    eventType: 'ACTIVITY',
    details: { protocol, sourceIp },
    sourceIp,
    unsPath,
  });
}

/** Mark entity as OFFLINE. */
export async function markOffline(entityId: string, unsPath: string): Promise<void> {
  const now = new Date();

  await prisma.connectivityStatus.upsert({
    where: { entityId },
    create: {
      entityId,
      status: 'OFFLINE',
      lastDisconnectedAt: now,
    },
    update: {
      status: 'OFFLINE',
      lastDisconnectedAt: now,
    },
  });

  addDeviceEventRow({
    time: now,
    entityId,
    eventType: 'DISCONNECTED',
    details: null,
    sourceIp: null,
    unsPath,
  });
}

/**
 * Maintenance: check all entities for inactivity timeout.
 * Marks entities as OFFLINE if lastActivityAt < now - inactivityTimeout.
 */
export async function checkInactivityTimeouts(): Promise<number> {
  // Get all ONLINE entities with their template's inactivity timeout
  const onlineEntities = await prisma.connectivityStatus.findMany({
    where: { status: 'ONLINE' },
  });

  if (onlineEntities.length === 0) return 0;

  let offlineCount = 0;
  const now = Date.now();

  for (const entity of onlineEntities) {
    if (!entity.lastActivityAt) continue;

    // Get the entity's template inactivity timeout
    const instance = await prisma.assetInstance.findUnique({
      where: { id: entity.entityId },
      select: { template: { select: { inactivityTimeout: true } }, unsPath: true },
    });

    const timeoutSeconds = instance?.template?.inactivityTimeout ?? 60;
    const lastActivity = entity.lastActivityAt.getTime();
    const elapsed = (now - lastActivity) / 1000;

    if (elapsed > timeoutSeconds) {
      await prisma.connectivityStatus.update({
        where: { id: entity.id },
        data: { status: 'OFFLINE' },
      });

      // Log inactivity event
      addDeviceEventRow({
        time: new Date(),
        entityId: entity.entityId,
        eventType: 'INACTIVITY',
        details: { elapsedSeconds: Math.round(elapsed), timeoutSeconds },
        sourceIp: null,
        unsPath: instance?.unsPath ?? '',
      });

      offlineCount++;
    }
  }

  return offlineCount;
}
