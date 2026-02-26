import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockPrismaCreate, mockComputeChecksum } = vi.hoisted(() => ({
  mockPrismaCreate: vi.fn(),
  mockComputeChecksum: vi.fn(),
}));

vi.mock('./prisma.js', () => ({
  prisma: {
    auditTrail: { create: mockPrismaCreate },
  },
}));

vi.mock('./hash-chain.js', () => ({
  computeChecksum: mockComputeChecksum,
}));

import { auditLog } from './audit.js';

describe('auditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComputeChecksum.mockReturnValue('sha256-checksum');
    mockPrismaCreate.mockResolvedValue({});
  });

  it('creates audit trail entry with checksum', async () => {
    await auditLog({
      userId: 'admin',
      userRole: 'ADMIN',
      action: 'USER_CREATED',
      targetType: 'user',
      targetId: 'u1',
      afterValue: { username: 'newuser' },
      ipAddress: '127.0.0.1',
    });

    expect(mockComputeChecksum).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin',
      action: 'USER_CREATED',
      targetType: 'user',
      targetId: 'u1',
    }));

    expect(mockPrismaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'admin',
        action: 'USER_CREATED',
        checksum: 'sha256-checksum',
        afterValue: { username: 'newuser' },
      }),
    });
  });

  it('handles entries without afterValue', async () => {
    await auditLog({ action: 'LOGOUT', targetType: 'session', targetId: 's1' });

    expect(mockPrismaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'LOGOUT',
        afterValue: undefined,
      }),
    });
  });

  it('deep clones beforeValue and afterValue', async () => {
    const afterValue = { nested: { key: 'value' } };
    await auditLog({ action: 'TEST', afterValue });

    const createCall = mockPrismaCreate.mock.calls[0][0];
    // Should be a copy, not the same reference
    expect(createCall.data.afterValue).toEqual(afterValue);
    expect(createCall.data.afterValue).not.toBe(afterValue);
  });

  it('stores signatureMeaning', async () => {
    await auditLog({
      action: 'PASSWORD_CHANGED',
      signatureMeaning: 'User changed password',
    });

    expect(mockPrismaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        signatureMeaning: 'User changed password',
      }),
    });
  });
});
