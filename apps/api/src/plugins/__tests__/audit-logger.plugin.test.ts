import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockPrismaCreate, mockComputeChecksum } = vi.hoisted(() => ({
  mockPrismaCreate: vi.fn(),
  mockComputeChecksum: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    auditTrail: { create: mockPrismaCreate },
  },
}));

vi.mock('../../lib/hash-chain.js', () => ({
  computeChecksum: mockComputeChecksum,
}));

import auditLoggerPlugin from '../audit-logger.js';

describe('auditLoggerPlugin', () => {
  let auditLog: Function;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockComputeChecksum.mockReturnValue('sha256-test-checksum');
    mockPrismaCreate.mockResolvedValue({});

    const app = {
      decorate: vi.fn((name: string, fn: Function) => {
        if (name === 'auditLog') auditLog = fn;
      }),
    } as any;

    await auditLoggerPlugin(app, {});
  });

  it('creates audit entry with computed checksum', async () => {
    await auditLog({
      userId: 'admin',
      action: 'USER_CREATED',
      targetType: 'user',
      targetId: 'u1',
      afterValue: { username: 'newuser' },
    });

    expect(mockComputeChecksum).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin',
        action: 'USER_CREATED',
        targetType: 'user',
        targetId: 'u1',
      }),
    );

    expect(mockPrismaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'admin',
        action: 'USER_CREATED',
        checksum: 'sha256-test-checksum',
      }),
    });
  });

  it('deep clones afterValue to prevent mutation', async () => {
    const afterValue = { nested: { key: 'value' } };
    await auditLog({
      action: 'TEST',
      afterValue,
    });

    const createCall = mockPrismaCreate.mock.calls[0][0];
    expect(createCall.data.afterValue).toEqual(afterValue);
    expect(createCall.data.afterValue).not.toBe(afterValue);
  });

  it('handles entry without optional fields', async () => {
    await auditLog({ action: 'LOGOUT' });

    expect(mockPrismaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'LOGOUT',
      }),
    });
  });

  it('stores signatureMeaning', async () => {
    await auditLog({
      action: 'PASSWORD_CHANGED',
      signatureMeaning: 'User confirmed password change',
    });

    expect(mockPrismaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        signatureMeaning: 'User confirmed password change',
      }),
    });
  });

  it('includes ipAddress, userAgent, and sessionId', async () => {
    await auditLog({
      action: 'LOGIN',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      sessionId: 'sess-123',
    });

    expect(mockPrismaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        sessionId: 'sess-123',
      }),
    });
  });

  it('deep clones beforeValue', async () => {
    const beforeValue = { status: 'ACTIVE' };
    await auditLog({
      action: 'STATUS_CHANGE',
      beforeValue,
      afterValue: { status: 'MAINTENANCE' },
    });

    const createCall = mockPrismaCreate.mock.calls[0][0];
    expect(createCall.data.beforeValue).toEqual(beforeValue);
    expect(createCall.data.beforeValue).not.toBe(beforeValue);
  });
});
