import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockIdentRepo, mockInstanceRepo, mockAuditLog, mockPrisma } = vi.hoisted(() => {
  // create() writes through prisma.$transaction (2026-09-25: it may release a
  // tag held by a retired filter in the same tx). Route the callback to the
  // same tx-shaped object so tx.x.method() records on the mock.
  //
  // D-DB-2 (2026-10-22): the "one identifier per entity" / duplicate-value
  // reads moved INSIDE that transaction, behind advisory locks. The tx reads
  // delegate to the repository mocks below, so each test's
  // mockIdentRepo.findMany / findByIdentifierValue / findById setup still
  // means what it says.
  const repo = {
    findMany: vi.fn(),
    findByValue: vi.fn(),
    findById: vi.fn(),
    findByIdentifierValue: vi.fn(),
    // C-07 (2026-10-19): the RFID duplicate check is case-insensitive. The
    // tests below set findByIdentifierValue; this delegates so they keep
    // meaning the same thing (see beforeEach).
    findByIdentifierValueInsensitive: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  };
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    assetIdentifier: {
      create: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn((args: { where: Record<string, unknown> }) => repo.findMany(args.where)),
      findFirst: vi.fn((args: { where: { identifierValue: { equals: string } } }) => repo.findByIdentifierValue(args.where.identifierValue.equals)),
      findUnique: vi.fn((args: { where: { id?: string; identifierValue?: string } }) =>
        (args.where.id ? repo.findById(args.where.id) : repo.findByIdentifierValue(args.where.identifierValue))),
    },
    assetInstance: { findUnique: vi.fn() },
  };
  return {
    mockIdentRepo: repo,
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
    mockIdentRepo.findByIdentifierValueInsensitive.mockImplementation((v: string) => mockIdentRepo.findByIdentifierValue(v));
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
      }), expect.anything()); // D-DB-2: written with the tx, so the assign and its audit row commit together
    });

    it('takes the filter lock, then the tag lock, BEFORE reading what the filter holds (D-DB-2)', async () => {
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'a1', name: 'Filter-42' });
      mockIdentRepo.findMany.mockResolvedValue([]);
      mockIdentRepo.findByIdentifierValue.mockResolvedValue(null);
      mockPrisma.assetIdentifier.create.mockResolvedValue({ id: 'i1', assetId: 'a1', identifierType: 'RFID', identifierValue: 'CA00AB12' });

      await identifierService.create({ assetId: 'a1', identifierType: 'RFID', identifierValue: 'ca00ab12' }, ctx);

      const locks = mockPrisma.$executeRaw.mock.calls.map(([strings, ...values]) => ({ sql: (strings as string[]).join('?'), values }));
      expect(locks).toHaveLength(2);
      expect(locks[0].sql).toContain('pg_advisory_xact_lock');
      expect(locks[0].values).toContain('a1');
      expect(locks[1].values).toContain('ca00ab12'); // the canonical value, lower-cased
      const firstLock = mockPrisma.$executeRaw.mock.invocationCallOrder[0];
      const lastLock = mockPrisma.$executeRaw.mock.invocationCallOrder[1];
      expect(lastLock).toBeLessThan(mockPrisma.assetIdentifier.findMany.mock.invocationCallOrder[0]);
      expect(firstLock).toBeLessThan(lastLock);
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

    /**
     * 2026-10-05: re-tagging a filter. Without `replaceExisting` a second tag is
     * still refused (409 ENTITY_HAS_IDENTIFIER, message names the held tag). With
     * it, the held tag is released inside the same transaction, audited as a
     * removal whose reason names the new tag — the RFID Track Record shows
     * REMOVE then ASSIGN. Re-scanning the tag the filter already holds is a
     * distinct refusal so the operator is not told to "replace" a tag with itself.
     */
    it('refuses a second tag without replaceExisting, naming the held tag', async () => {
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'a1', name: 'FD/AHU-02/20-00' });
      mockIdentRepo.findMany.mockResolvedValue([{ id: 'held', assetId: 'a1', identifierType: 'RFID', identifierValue: 'CA000BF8' }]);

      await expect(identifierService.create({ assetId: 'a1', identifierType: 'RFID', identifierValue: 'CA000CF3' }, ctx))
        .rejects.toMatchObject({ code: 'ENTITY_HAS_IDENTIFIER', message: expect.stringContaining('CA000BF8') });
      // Refused inside the transaction (D-DB-2), before anything is written.
      expect(mockPrisma.assetIdentifier.create).not.toHaveBeenCalled();
      expect(mockPrisma.assetIdentifier.delete).not.toHaveBeenCalled();
      expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it('refuses re-assigning the tag the filter already holds, even with replaceExisting', async () => {
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'a1', name: 'FD/AHU-02/20-00' });
      mockIdentRepo.findMany.mockResolvedValue([{ id: 'held', assetId: 'a1', identifierType: 'RFID', identifierValue: 'CA000BF8' }]);

      await expect(identifierService.create({ assetId: 'a1', identifierType: 'RFID', identifierValue: 'CA000BF8', replaceExisting: true }, ctx))
        .rejects.toMatchObject({ code: 'IDENTIFIER_ALREADY_ON_ENTITY' });
      // Refused inside the transaction (D-DB-2), before anything is written.
      expect(mockPrisma.assetIdentifier.create).not.toHaveBeenCalled();
      expect(mockPrisma.assetIdentifier.delete).not.toHaveBeenCalled();
    });

    it('replaceExisting releases the held tag (audited, reason names the new tag) and binds the new one in one transaction', async () => {
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'a1', name: 'FD/AHU-02/20-00' });
      mockIdentRepo.findMany.mockResolvedValue([{ id: 'held', assetId: 'a1', identifierType: 'RFID', identifierValue: 'CA000BF8' }]);
      mockIdentRepo.findByIdentifierValue.mockResolvedValue(null);
      mockPrisma.assetIdentifier.create.mockResolvedValue({ id: 'i3', assetId: 'a1', identifierType: 'RFID', identifierValue: 'CA000CF3' });

      const result = await identifierService.create({ assetId: 'a1', identifierType: 'RFID', identifierValue: 'CA000CF3', replaceExisting: true }, ctx);
      expect(result.id).toBe('i3');
      expect(mockPrisma.assetIdentifier.delete).toHaveBeenCalledWith({ where: { id: 'held' } });

      const removed = mockAuditLog.mock.calls.find(([e]) => e.action === 'ASSET_IDENTIFIER_DELETED');
      expect(removed).toBeDefined();
      expect(removed![0].targetId).toBe('held');
      expect(removed![0].beforeValue).toEqual({ assetId: 'a1', identifierType: 'RFID', identifierValue: 'CA000BF8', filterName: 'FD/AHU-02/20-00' });
      expect(removed![0].afterValue).toEqual({ deleted: true, replacedBy: 'CA000CF3' });
      expect(removed![0].reason).toContain('CA000CF3');
      expect(removed![1]).toBeDefined(); // written inside the tx, like the retired-holder release
      const created = mockAuditLog.mock.calls.find(([e]) => e.action === 'ASSET_IDENTIFIER_CREATED');
      expect(created![0].afterValue).toEqual(expect.objectContaining({ identifierValue: 'CA000CF3', filterName: 'FD/AHU-02/20-00' }));
    });

    it('replaceExisting still refuses a tag that is live on ANOTHER filter', async () => {
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'a1', name: 'FD/AHU-02/20-00' });
      mockIdentRepo.findMany.mockResolvedValue([{ id: 'held', assetId: 'a1', identifierType: 'RFID', identifierValue: 'CA000BF8' }]);
      mockIdentRepo.findByIdentifierValue.mockResolvedValue({ id: 'elsewhere', assetId: 'a2', identifierType: 'RFID', identifierValue: 'CA00C3F0' });
      mockPrisma.assetInstance.findUnique.mockResolvedValue({ name: 'FD/AHU-02/19-00', status: 'Active', isActive: true });

      await expect(identifierService.create({ assetId: 'a1', identifierType: 'RFID', identifierValue: 'CA00C3F0', replaceExisting: true }, ctx))
        .rejects.toMatchObject({ code: 'DUPLICATE_IDENTIFIER_VALUE' });
      // Nothing was released: the refusal happens before the transaction.
      expect(mockPrisma.assetIdentifier.delete).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes identifier and logs audit', async () => {
      mockIdentRepo.findById.mockResolvedValue({ id: 'i1', assetId: 'a1', identifierType: 'RFID', identifierValue: 'RFID-001' });
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'a1', name: 'Filter-42' });

      await identifierService.delete('i1', ctx);
      // D-DB-2: deleted through the transaction, under the filter + tag locks,
      // with the audit row in the same transaction.
      expect(mockPrisma.assetIdentifier.delete).toHaveBeenCalledWith({ where: { id: 'i1' } });
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2);
      expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        action: 'ASSET_IDENTIFIER_DELETED',
        beforeValue: expect.objectContaining({ filterName: 'Filter-42', identifierValue: 'RFID-001' }),
      }), expect.anything());
    });

    it('answers 404 when a concurrent request removed the row first (re-read under the lock)', async () => {
      mockIdentRepo.findById
        .mockResolvedValueOnce({ id: 'i1', assetId: 'a1', identifierType: 'RFID', identifierValue: 'RFID-001' })
        .mockResolvedValueOnce(null);
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'a1', name: 'Filter-42' });

      await expect(identifierService.delete('i1', ctx)).rejects.toThrow('not found');
      expect(mockPrisma.assetIdentifier.delete).not.toHaveBeenCalled();
      expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it('throws NotFoundError', async () => {
      mockIdentRepo.findById.mockResolvedValue(null);
      await expect(identifierService.delete('bad', ctx)).rejects.toThrow('not found');
    });
  });
});
