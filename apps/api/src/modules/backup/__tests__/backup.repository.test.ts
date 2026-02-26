import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findMany: vi.fn() },
    role: { findMany: vi.fn() },
    systemConfig: { findMany: vi.fn() },
    auditTrail: { findMany: vi.fn() },
    notification: { findMany: vi.fn(), deleteMany: vi.fn() },
    passwordHistory: { findMany: vi.fn(), createMany: vi.fn() },
    session: { findMany: vi.fn(), deleteMany: vi.fn() },
    fieldIdConfig: { findMany: vi.fn(), createMany: vi.fn() },
    userConfig: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    roleConfig: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    passwordResetRequest: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    $queryRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  },
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import { fetchAllTablesRaw, fetchAllTablesPrisma, resetAuditSequence } from '../backup.repository.js';

describe('backup.repository', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('fetchAllTablesRaw', () => {
    it('queries each DB table via raw SQL', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
      const result = await fetchAllTablesRaw();
      expect(typeof result).toBe('object');
      // Should have queried multiple tables
      expect(mockPrisma.$queryRawUnsafe.mock.calls.length).toBeGreaterThan(0);
    });

    it('uses ORDER BY for audit_trail table', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
      await fetchAllTablesRaw();
      const auditCall = mockPrisma.$queryRawUnsafe.mock.calls.find(
        (call: string[]) => call[0].includes('audit_trail'),
      );
      expect(auditCall).toBeDefined();
      expect(auditCall![0]).toContain('ORDER BY id ASC');
    });
  });

  describe('fetchAllTablesPrisma', () => {
    it('fetches all tables using Prisma models', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.role.findMany.mockResolvedValue([]);
      mockPrisma.systemConfig.findMany.mockResolvedValue([]);
      mockPrisma.auditTrail.findMany.mockResolvedValue([]);
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.passwordHistory.findMany.mockResolvedValue([]);
      mockPrisma.session.findMany.mockResolvedValue([]);
      mockPrisma.fieldIdConfig.findMany.mockResolvedValue([]);
      mockPrisma.userConfig.findMany.mockResolvedValue([]);
      mockPrisma.roleConfig.findMany.mockResolvedValue([]);
      mockPrisma.passwordResetRequest.findMany.mockResolvedValue([]);

      const result = await fetchAllTablesPrisma();
      expect(result).toHaveProperty('users');
      expect(result).toHaveProperty('roles');
      expect(result).toHaveProperty('auditTrail');
      expect(result).toHaveProperty('systemConfig');
      expect(result).toHaveProperty('notifications');
    });

    it('orders audit trail by id ascending', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.role.findMany.mockResolvedValue([]);
      mockPrisma.systemConfig.findMany.mockResolvedValue([]);
      mockPrisma.auditTrail.findMany.mockResolvedValue([]);
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.passwordHistory.findMany.mockResolvedValue([]);
      mockPrisma.session.findMany.mockResolvedValue([]);
      mockPrisma.fieldIdConfig.findMany.mockResolvedValue([]);
      mockPrisma.userConfig.findMany.mockResolvedValue([]);
      mockPrisma.roleConfig.findMany.mockResolvedValue([]);
      mockPrisma.passwordResetRequest.findMany.mockResolvedValue([]);

      await fetchAllTablesPrisma();
      expect(mockPrisma.auditTrail.findMany).toHaveBeenCalledWith({ orderBy: { id: 'asc' } });
    });
  });

  describe('resetAuditSequence', () => {
    it('resets audit_trail sequence via raw SQL', async () => {
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);
      await resetAuditSequence();
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('setval'),
      );
    });
  });
});
