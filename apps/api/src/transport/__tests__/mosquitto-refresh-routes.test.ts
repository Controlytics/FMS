import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// Mock prisma BEFORE importing the route module — mirrors the import
// path used by apps/api/src/transport/mqtt-auth-routes.ts
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    deviceCredential: { findMany: vi.fn() },
    unsMapping: { findUnique: vi.fn() },
    assetInstance: { findUnique: vi.fn() },
  },
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));

// Mock fs/promises so the test does not actually write
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

// Mock the audit logger so we can assert it was called and prevent
// it from hitting prisma.auditTrail.create at test time
const { mockAuditLog } = vi.hoisted(() => ({
  mockAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../lib/audit.js', () => ({ auditLog: mockAuditLog }));

import mosquittoRefreshRoutes from '../mosquitto-refresh-routes.js';
import { writeFile, rename } from 'node:fs/promises';

const prisma = mockPrisma;

describe('mosquitto-refresh-routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.MOSQUITTO_ADMIN_PASSWORD = 'test-admin-password-123';
    process.env.MOSQUITTO_REFRESH_TOKEN = 'shared-secret';
    process.env.MOSQUITTO_DYNSEC_PATH = './test-dynsec.json';

    app = Fastify();
    await app.register(mosquittoRefreshRoutes, { prefix: '/api/internal/mqtt' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.MOSQUITTO_REFRESH_TOKEN;
    delete process.env.MOSQUITTO_ADMIN_PASSWORD;
    delete process.env.MOSQUITTO_DYNSEC_PATH;
  });

  it('returns 401 without admin Bearer token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/internal/mqtt/refresh-acl' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with wrong Bearer token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/mqtt/refresh-acl',
      headers: { authorization: 'Bearer wrong-secret' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 + writes file when authed (zero devices)', async () => {
    (prisma.deviceCredential.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/mqtt/refresh-acl',
      headers: { authorization: 'Bearer shared-secret' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ wroteFile: true, deviceCount: 0 });

    // Atomic write: writeFile to tmp, then rename onto the target
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [tmpPath, contents] = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(tmpPath).toBe('./test-dynsec.json.tmp');
    const parsed = JSON.parse(contents as string);
    expect(parsed).toHaveProperty('clients');
    expect(parsed.clients).toHaveLength(1); // admin only

    expect(rename).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledWith('./test-dynsec.json.tmp', './test-dynsec.json');
  });

  it('writes to <path>.tmp then renames onto target (atomic write)', async () => {
    (prisma.deviceCredential.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/mqtt/refresh-acl',
      headers: { authorization: 'Bearer shared-secret' },
    });

    expect(res.statusCode).toBe(200);
    // The tmp path is the target with `.tmp` suffix
    expect((writeFile as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      './test-dynsec.json.tmp'
    );
    // Rename moves tmp → target
    expect((rename as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      './test-dynsec.json.tmp',
      './test-dynsec.json',
    ]);
    // writeFile was called BEFORE rename
    const writeOrder = (writeFile as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const renameOrder = (rename as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(renameOrder);
  });

  it('returns 500 WRITE_FAILED when rename fails', async () => {
    (prisma.deviceCredential.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (rename as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('EACCES: permission denied'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/mqtt/refresh-acl',
      headers: { authorization: 'Bearer shared-secret' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({
      error: 'WRITE_FAILED',
      message: 'EACCES: permission denied',
    });
    // Audit must NOT fire on a failed write
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('writes audit log MOSQUITTO_ACL_REFRESH on success', async () => {
    (prisma.deviceCredential.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/mqtt/refresh-acl',
      headers: { authorization: 'Bearer shared-secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    const entry = mockAuditLog.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: 'MOSQUITTO_ACL_REFRESH',
      targetType: 'mqtt-broker',
      targetId: 'global',
      afterValue: {
        deviceCount: 0,
        skippedCount: 0,
        path: './test-dynsec.json',
      },
    });
    expect(entry.signatureMeaning).toBeDefined();
    expect(entry.ipAddress).toBeDefined();
  });

  it('still returns 200 if audit log itself fails (broker state already mutated)', async () => {
    (prisma.deviceCredential.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockAuditLog.mockRejectedValueOnce(new Error('audit DB down'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/mqtt/refresh-acl',
      headers: { authorization: 'Bearer shared-secret' },
    });

    // File write succeeded, broker config is already on disk —
    // audit failure must NOT undo it (and must NOT 500).
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ wroteFile: true, deviceCount: 0 });
  });

  it('resolves device unsPath via unsMapping then falls back to assetInstance', async () => {
    (prisma.deviceCredential.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { entityId: 'ent-1', accessToken: 'tok-1' },
      { entityId: 'ent-2', accessToken: 'tok-2' },
    ]);
    (prisma.unsMapping.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ unsPath: 'digilog/v1/site-1/area-1/ent-1' })
      .mockResolvedValueOnce(null);
    (prisma.assetInstance.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      unsPath: 'digilog/v1/site-1/area-1/ent-2',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/mqtt/refresh-acl',
      headers: { authorization: 'Bearer shared-secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ wroteFile: true, deviceCount: 2 });
  });

  it('skips devices with no resolvable unsPath and reports skipped count', async () => {
    (prisma.deviceCredential.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { entityId: 'ent-1', accessToken: 'tok-1' },
      { entityId: 'ent-no-path', accessToken: 'tok-no-path' },
    ]);
    (prisma.unsMapping.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ unsPath: 'digilog/v1/site-1/ent-1' })
      .mockResolvedValueOnce(null);
    (prisma.assetInstance.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ unsPath: null });

    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/mqtt/refresh-acl',
      headers: { authorization: 'Bearer shared-secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ wroteFile: true, deviceCount: 1, skippedCount: 1 });
  });

  it('returns 500 if MOSQUITTO_REFRESH_TOKEN env var is unset', async () => {
    delete process.env.MOSQUITTO_REFRESH_TOKEN;
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/mqtt/refresh-acl',
      headers: { authorization: 'Bearer anything' },
    });
    expect(res.statusCode).toBe(500);
  });

  it('returns 500 if MOSQUITTO_ADMIN_PASSWORD env var is unset', async () => {
    delete process.env.MOSQUITTO_ADMIN_PASSWORD;
    (prisma.deviceCredential.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/mqtt/refresh-acl',
      headers: { authorization: 'Bearer shared-secret' },
    });
    expect(res.statusCode).toBe(500);
  });
});
