import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────

const {
  mockUpsert,
  mockFindUnique,
  mockFindMany,
  mockUpdate,
  mockAssetFindUnique,
  mockAddDeviceEventRow,
} = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockFindUnique: vi.fn(),
  mockFindMany: vi.fn(),
  mockUpdate: vi.fn(),
  mockAssetFindUnique: vi.fn(),
  mockAddDeviceEventRow: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    connectivityStatus: {
      // markOnline / markOffline read the previous status before upserting so
      // we can detect transitions (OFFLINE -> ONLINE etc) and emit the right
      // device event. Mock it to return null by default (= no row yet); tests
      // that care about transitions override this.
      findUnique: mockFindUnique,
      upsert: mockUpsert,
      findMany: mockFindMany,
      update: mockUpdate,
    },
    assetInstance: {
      findUnique: mockAssetFindUnique,
    },
  },
}));

vi.mock('@digilog/db', () => ({
  addDeviceEventRow: mockAddDeviceEventRow,
}));

// connectivity-tracker calls notification-dispatcher when devices flip
// offline. The dispatcher itself reads notificationRule.findMany and writes
// notifications - none of which are under test here. Stub it out so tests
// don't pull a real Prisma client into the picture.
vi.mock('../../notification-delivery/notification-dispatcher.js', () => ({
  dispatchNotification: vi.fn().mockResolvedValue(undefined),
}));

import { markOnline, markOffline, checkInactivityTimeouts } from '../connectivity-tracker.js';

// ── Tests ──────────────────────────────────────────────────────────────

describe('connectivity-tracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // ── markOnline ─────────────────────────────────────────────────────

  describe('markOnline', () => {
    it('should upsert connectivity status to ONLINE with correct fields', async () => {
      mockUpsert.mockResolvedValue({});

      await markOnline('entity-001', 'mqtt', '192.168.1.10', 'digilog/v1/sensors/temp');

      expect(mockUpsert).toHaveBeenCalledTimes(1);
      const call = mockUpsert.mock.calls[0][0];
      expect(call.where).toEqual({ entityId: 'entity-001' });
      expect(call.create.entityId).toBe('entity-001');
      expect(call.create.status).toBe('ONLINE');
      expect(call.create.protocol).toBe('MQTT');
      expect(call.create.sourceIp).toBe('192.168.1.10');
      expect(call.create.lastActivityAt).toBeInstanceOf(Date);
      expect(call.create.lastConnectedAt).toBeInstanceOf(Date);
      expect(call.update.status).toBe('ONLINE');
      expect(call.update.protocol).toBe('MQTT');
      expect(call.update.sourceIp).toBe('192.168.1.10');
      expect(call.update.lastActivityAt).toBeInstanceOf(Date);
      expect(call.update.lastConnectedAt).toBeInstanceOf(Date);
    });

    it('should uppercase the protocol string', async () => {
      mockUpsert.mockResolvedValue({});

      await markOnline('entity-002', 'http', '10.0.0.1', 'digilog/v1/sensors/ph');

      const call = mockUpsert.mock.calls[0][0];
      expect(call.create.protocol).toBe('HTTP');
      expect(call.update.protocol).toBe('HTTP');
    });

    it('should call addDeviceEventRow with ACTIVITY event type', async () => {
      mockUpsert.mockResolvedValue({});

      await markOnline('entity-001', 'mqtt', '192.168.1.10', 'digilog/v1/sensors/temp');

      expect(mockAddDeviceEventRow).toHaveBeenCalledTimes(1);
      const eventArg = mockAddDeviceEventRow.mock.calls[0][0];
      expect(eventArg.entityId).toBe('entity-001');
      expect(eventArg.eventType).toBe('ACTIVITY');
      expect(eventArg.details).toEqual({ protocol: 'mqtt', sourceIp: '192.168.1.10' });
      expect(eventArg.sourceIp).toBe('192.168.1.10');
      expect(eventArg.unsPath).toBe('digilog/v1/sensors/temp');
      expect(eventArg.time).toBeInstanceOf(Date);
    });

    it('should use the same timestamp for both upsert and device event', async () => {
      mockUpsert.mockResolvedValue({});

      await markOnline('entity-001', 'ws', '10.0.0.5', 'digilog/v1/sensors/flow');

      const upsertTime = mockUpsert.mock.calls[0][0].create.lastActivityAt;
      const eventTime = mockAddDeviceEventRow.mock.calls[0][0].time;
      expect(upsertTime).toEqual(eventTime);
    });
  });

  // ── markOffline ────────────────────────────────────────────────────

  describe('markOffline', () => {
    it('should upsert connectivity status to OFFLINE with correct fields', async () => {
      mockUpsert.mockResolvedValue({});

      await markOffline('entity-001', 'digilog/v1/sensors/temp');

      expect(mockUpsert).toHaveBeenCalledTimes(1);
      const call = mockUpsert.mock.calls[0][0];
      expect(call.where).toEqual({ entityId: 'entity-001' });
      expect(call.create.entityId).toBe('entity-001');
      expect(call.create.status).toBe('OFFLINE');
      expect(call.create.lastDisconnectedAt).toBeInstanceOf(Date);
      expect(call.update.status).toBe('OFFLINE');
      expect(call.update.lastDisconnectedAt).toBeInstanceOf(Date);
    });

    it('should call addDeviceEventRow with DISCONNECTED event type', async () => {
      mockUpsert.mockResolvedValue({});

      await markOffline('entity-001', 'digilog/v1/sensors/temp');

      expect(mockAddDeviceEventRow).toHaveBeenCalledTimes(1);
      const eventArg = mockAddDeviceEventRow.mock.calls[0][0];
      expect(eventArg.entityId).toBe('entity-001');
      expect(eventArg.eventType).toBe('DISCONNECTED');
      expect(eventArg.details).toBeNull();
      expect(eventArg.sourceIp).toBeNull();
      expect(eventArg.unsPath).toBe('digilog/v1/sensors/temp');
      expect(eventArg.time).toBeInstanceOf(Date);
    });

    it('should use the same timestamp for both upsert and device event', async () => {
      mockUpsert.mockResolvedValue({});

      await markOffline('entity-001', 'digilog/v1/sensors/temp');

      const upsertTime = mockUpsert.mock.calls[0][0].create.lastDisconnectedAt;
      const eventTime = mockAddDeviceEventRow.mock.calls[0][0].time;
      expect(upsertTime).toEqual(eventTime);
    });
  });

  // ── checkInactivityTimeouts ────────────────────────────────────────

  describe('checkInactivityTimeouts', () => {
    it('should return 0 when no online entities exist', async () => {
      mockFindMany.mockResolvedValue([]);

      const count = await checkInactivityTimeouts();

      expect(count).toBe(0);
      expect(mockFindMany).toHaveBeenCalledWith({ where: { status: 'ONLINE' } });
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockAssetFindUnique).not.toHaveBeenCalled();
    });

    it('should return 0 when entities are still within timeout', async () => {
      const recentActivity = new Date(); // just now -- well within any timeout
      mockFindMany.mockResolvedValue([
        {
          id: 'cs-001',
          entityId: 'entity-001',
          status: 'ONLINE',
          lastActivityAt: recentActivity,
        },
      ]);
      mockAssetFindUnique.mockResolvedValue({
        template: { inactivityTimeout: 60 },
        unsPath: 'digilog/v1/sensors/temp',
      });

      const count = await checkInactivityTimeouts();

      expect(count).toBe(0);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockAddDeviceEventRow).not.toHaveBeenCalled();
    });

    it('should mark entities OFFLINE when they exceed the inactivity timeout', async () => {
      const staleActivity = new Date(Date.now() - 120_000); // 120 seconds ago
      mockFindMany.mockResolvedValue([
        {
          id: 'cs-001',
          entityId: 'entity-001',
          status: 'ONLINE',
          lastActivityAt: staleActivity,
        },
      ]);
      mockAssetFindUnique.mockResolvedValue({
        template: { inactivityTimeout: 60 },
        unsPath: 'digilog/v1/sensors/temp',
      });
      mockUpdate.mockResolvedValue({});

      const count = await checkInactivityTimeouts();

      expect(count).toBe(1);
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'cs-001' },
        data: { status: 'OFFLINE' },
      });
    });

    it('should use the default 60s timeout when template has no inactivityTimeout', async () => {
      const staleActivity = new Date(Date.now() - 70_000); // 70 seconds ago, exceeds default 60s
      mockFindMany.mockResolvedValue([
        {
          id: 'cs-002',
          entityId: 'entity-002',
          status: 'ONLINE',
          lastActivityAt: staleActivity,
        },
      ]);
      mockAssetFindUnique.mockResolvedValue({
        template: { inactivityTimeout: null },
        unsPath: 'digilog/v1/sensors/ph',
      });
      mockUpdate.mockResolvedValue({});

      const count = await checkInactivityTimeouts();

      expect(count).toBe(1);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    it('should use the default 60s timeout when entity instance is not found', async () => {
      const staleActivity = new Date(Date.now() - 70_000); // 70 seconds ago
      mockFindMany.mockResolvedValue([
        {
          id: 'cs-003',
          entityId: 'entity-ghost',
          status: 'ONLINE',
          lastActivityAt: staleActivity,
        },
      ]);
      mockAssetFindUnique.mockResolvedValue(null); // entity not found
      mockUpdate.mockResolvedValue({});

      const count = await checkInactivityTimeouts();

      expect(count).toBe(1);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    it('should log INACTIVITY device event with elapsed and timeout details', async () => {
      const staleActivity = new Date(Date.now() - 90_000); // 90 seconds ago
      mockFindMany.mockResolvedValue([
        {
          id: 'cs-001',
          entityId: 'entity-001',
          status: 'ONLINE',
          lastActivityAt: staleActivity,
        },
      ]);
      mockAssetFindUnique.mockResolvedValue({
        template: { inactivityTimeout: 60 },
        unsPath: 'digilog/v1/sensors/temp',
      });
      mockUpdate.mockResolvedValue({});

      await checkInactivityTimeouts();

      expect(mockAddDeviceEventRow).toHaveBeenCalledTimes(1);
      const eventArg = mockAddDeviceEventRow.mock.calls[0][0];
      expect(eventArg.entityId).toBe('entity-001');
      expect(eventArg.eventType).toBe('INACTIVITY');
      expect(eventArg.details.timeoutSeconds).toBe(60);
      expect(eventArg.details.elapsedSeconds).toBeGreaterThanOrEqual(90);
      expect(eventArg.sourceIp).toBeNull();
      expect(eventArg.unsPath).toBe('digilog/v1/sensors/temp');
      expect(eventArg.time).toBeInstanceOf(Date);
    });

    it('should skip entities that have no lastActivityAt', async () => {
      mockFindMany.mockResolvedValue([
        {
          id: 'cs-004',
          entityId: 'entity-004',
          status: 'ONLINE',
          lastActivityAt: null, // no activity recorded yet
        },
      ]);

      const count = await checkInactivityTimeouts();

      expect(count).toBe(0);
      expect(mockAssetFindUnique).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockAddDeviceEventRow).not.toHaveBeenCalled();
    });

    it('should process multiple entities and return correct offline count', async () => {
      const staleActivity = new Date(Date.now() - 120_000); // 120s ago -- timed out
      const recentActivity = new Date(); // just now -- still active

      mockFindMany.mockResolvedValue([
        {
          id: 'cs-001',
          entityId: 'entity-001',
          status: 'ONLINE',
          lastActivityAt: staleActivity,
        },
        {
          id: 'cs-002',
          entityId: 'entity-002',
          status: 'ONLINE',
          lastActivityAt: recentActivity,
        },
        {
          id: 'cs-003',
          entityId: 'entity-003',
          status: 'ONLINE',
          lastActivityAt: staleActivity,
        },
      ]);

      mockAssetFindUnique.mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === 'entity-001') {
          return Promise.resolve({
            template: { inactivityTimeout: 60 },
            unsPath: 'digilog/v1/sensors/temp',
          });
        }
        if (where.id === 'entity-002') {
          return Promise.resolve({
            template: { inactivityTimeout: 60 },
            unsPath: 'digilog/v1/sensors/ph',
          });
        }
        if (where.id === 'entity-003') {
          return Promise.resolve({
            template: { inactivityTimeout: 30 },
            unsPath: 'digilog/v1/sensors/flow',
          });
        }
        return Promise.resolve(null);
      });

      mockUpdate.mockResolvedValue({});

      const count = await checkInactivityTimeouts();

      expect(count).toBe(2); // entity-001 and entity-003 timed out
      expect(mockUpdate).toHaveBeenCalledTimes(2);
      expect(mockAddDeviceEventRow).toHaveBeenCalledTimes(2);

      // Verify the two timed-out entities were updated
      const updatedIds = mockUpdate.mock.calls.map((c: any[]) => c[0].where.id);
      expect(updatedIds).toContain('cs-001');
      expect(updatedIds).toContain('cs-003');
    });
  });
});
