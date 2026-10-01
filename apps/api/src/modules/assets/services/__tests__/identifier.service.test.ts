import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockIdentRepo, mockInstanceRepo, mockAuditLog, mockPrisma } = vi.hoisted(() => {
  // create() writes through prisma.$transaction (2026-09-25: it may release a
  // tag held by a retired filter in the same tx). Route the callback to the
  // same tx-shaped object so tx.x.method() records on the mock.
  const tx = {
    assetIdentifier: { create: vi.fn(), delete: vi.fn() },
    assetInstance: { findUnique: vi.fn() },
  };
  return {
    mockIdentRepo: {
      findMany: vi.fn(),
      findByValue: vi.fn(),
      findById: vi.fn(),
      findByIdentifierValue: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    mockInstanceRepo: { findByIdSimple: vi.fn() },
    mockAuditLog: vi.fn(),
    mockPrisma: { ...tx, $transaction: vi.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)) },
  };
});

vi.mock('../../repositories/identifier.repository.js', () => ({ identifierRepository: mockIdentRepo }));
vi.mock('../../repositories/instance.repository.js', () => ({ instanceRepository: mockInstanceRepo }));
vi.mock('../../../../lib/audit.js', () => ({ auditLog: mockAuditLog }));
vi.mock('../../../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import { identifierService } from '../identifier.service.js';

const ctx = { userId: 'admin', userSub: 'sub-1', userRole: 'ADMIN', ipAddress: '127.0.0.1', userAgent: 'test', sessionId: 'sess-1' };

describe('identifierService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditLog.mockResolvedValue(undefined);
  });

  describe('list', () => {
    it('returns identifiers', async () => {
      mockIdentRepo.findMany.mockResolvedValue([{ id: 'i1' }]);
      const result = await identifierService.list({ assetId: 'a1' });
      expect(result).toHaveLength(1);
    });
  });

  describe('lookupByValue', () => {
    it('returns identifier with asset', async () => {
      mockIdentRepo.findByValue.mockResolvedValue({ id: 'i1', identifierValue: 'QR-001' });
      const result = await identifierService.lookupByValue('QR-001');
      expect(result.identifierValue).toBe('QR-001');
    });

    it('throws NotFoundError', async () => {
      mockIdentRepo.findByValue.mockResolvedValue(null);
      await expect(identifierService.lookupByValue('MISSING')).rejects.toThrow('not found');
    });
  });

  describe('create', () => {
    it('creates identifier', async () => {
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'a1', name: 'Filter-42' });
      // The service enforces "one identifier per entity" via findMany before
      // findByIdentifierValue. Both must return empty for the create to
      // proceed.
      mockIdentRepo.findMany.mockResolvedValue([]);
      mockIdentRepo.findByIdentifierValue.mockResolvedValue(null);
      mockPrisma.assetIdentifier.create.mockResolvedValue({ id: 'i1', assetId: 'a1', identifierType: 'RFID', identifierValue: 'RFID-001' });

      const result = await identifierService.create({ assetId: 'a1', identifierType: 'RFID', identifierValue: 'RFID-001' }, ctx);
      expect(result.identifierValue).toBe('RFID-001');
      expect(mockPrisma.assetIdentifier.delete).not.toHaveBeenCalled();
      // Audit row must be self-describing: it stores the filter name (targetId is
      // the identifier UUID) and the tag value so the audit UI can render both.
      expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        action: 'ASSET_IDENTIFIER_CREATED',
        afterValue: expect.objectContaining({ filterName: 'Filter-42', identifierValue: 'RFID-001' }),
      }));
    });

    it('rejects when asset not found', async () => {
      mockInstanceRepo.findByIdSimple.mockResolvedValue(null);
      await expect(identifierService.create({ assetId: 'bad', identifierType: 'QR', identifierValue: 'x' }, ctx))
        .rejects.toThrow('not found');
    });

    it('rejects duplicate identifier value (collision against another entity)', async () => {
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'a1' });
      // Pass the "one-per-entity" check; trip on the cross-entity dup check.
      mockIdentRepo.findMany.mockResolvedValue([]);
      mockIdentRepo.findByIdentifierValue.mockResolvedValue({ id: 'existing', assetId: 'a2' });
      // The current holder is a LIVE filter — still a conflict.
      mockPrisma.assetInstance.findUnique.mockResolvedValue({ name: 'Other', status: 'Active', isActive: true });

      await expect(identifierService.create({ assetId: 'a1', identifierType: 'QR', identifierValue: 'DUP' }, ctx))
        .rejects.toThrow('already exists');
      expect(mockPrisma.assetIdentifier.delete).not.toHaveBeenCalled();
    });

    /**
     * 2026-09-25 (strict-audit follow-up): a tag stays bound to a retired filter
     * on purpose (retire-replace-identifier-invariant e2e), but a retired or
     * deactivated filter is hidden from every RFID surface, so its tag could
     * never be freed. Re-assignment releases it — audited, in the same tx.
     */
    it('releases a tag held by a retired filter and re-assigns it, audited, in one transaction', async () => {
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'a1', name: 'Filter-NEW' });
      mockIdentRepo.findMany.mockResolvedValue([]);
      mockIdentRepo.findByIdentifierValue.mockResolvedValue({ id: 'old-ident', assetId: 'a-old', identifierType: 'RFID', identifierValue: 'RFID-777' });
      mockPrisma.assetInstance.findUnique.mockResolvedValue({ name: 'Filter-OLD', status: 'Retired', isActive: false });
      mockPrisma.assetIdentifier.create.mockResolvedValue({ id: 'i2', assetId: 'a1', identifierType: 'RFID', identifierValue: 'RFID-777' });

      const result = await identifierService.create({ assetId: 'a1', identifierType: 'RFID', identifierValue: 'RFID-777' }, ctx);
      expect(result.id).toBe('i2');
      expect(mockPrisma.assetIdentifier.delete).toHaveBeenCalledWith({ where: { id: 'old-ident' } });

      const released = mockAuditLog.mock.calls.find(([e]) => e.action === 'ASSET_IDENTIFIER_DELETED');
      expect(released).toBeDefined();
      // Same beforeValue shape as identifier.service.delete() — the RFID Track
      // Record reads identifierType + identifierValue + assetId off it.
      expect(released![0].beforeValue).toEqual({ assetId: 'a-old', identifierType: 'RFID', identifierValue: 'RFID-777', filterName: 'Filter-OLD' });
      expect(released![0].afterValue).toEqual({ deleted: true, reassignedTo: 'a1' });
      expect(released![1]).toBeDefined(); // inside the tx
      expect(mockAuditLog.mock.calls.some(([e]) => e.action === 'ASSET_IDENTIFIER_CREATED')).toBe(true);
    });
  });

  describe('delete', () => {
    it('deletes identifier and logs audit', async () => {
      mockIdentRepo.findById.mockResolvedValue({ id: 'i1', assetId: 'a1', identifierType: 'RFID', identifierValue: 'RFID-001' });
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'a1', name: 'Filter-42' });
      mockIdentRepo.delete.mockResolvedValue({});

      await identifierService.delete('i1', ctx);
      expect(mockIdentRepo.delete).toHaveBeenCalledWith('i1');
      expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        action: 'ASSET_IDENTIFIER_DELETED',
        beforeValue: expect.objectContaining({ filterName: 'Filter-42', identifierValue: 'RFID-001' }),
      }));
    });

    it('throws NotFoundError', async () => {
      mockIdentRepo.findById.mockResolvedValue(null);
      await expect(identifierService.delete('bad', ctx)).rejects.toThrow('not found');
    });
  });
});
