import { describe, it, expect, beforeEach, vi } from 'vitest';

const {
  mockInstanceRepo, mockRelRepo, mockIdentRepo, mockTemplateRepo,
  mockValidateAttributes, mockHasCycle, mockCollectDescendants, mockAuditLog,
  mockPrisma,
} = vi.hoisted(() => ({
  mockInstanceRepo: {
    findMany: vi.fn(), findTree: vi.fn(), findById: vi.fn(), findByIdSimple: vi.fn(),
    findByIdWithName: vi.fn(), create: vi.fn(), update: vi.fn(),
    softDeleteMany: vi.fn(), findChildren: vi.fn(),
  },
  mockRelRepo: {
    createPairWithParent: vi.fn(), deleteOldContains: vi.fn(), deleteByAssetIds: vi.fn(),
    countBySourceAsset: vi.fn(), countContainsChildren: vi.fn(), countContainsParents: vi.fn(),
  },
  mockIdentRepo: { deleteByAssetIds: vi.fn() },
  mockTemplateRepo: { findById: vi.fn() },
  mockValidateAttributes: vi.fn(),
  mockHasCycle: vi.fn(),
  mockCollectDescendants: vi.fn(),
  mockAuditLog: vi.fn(),
  // Top-level prisma surface used by instance.service.ts. The service runs
  // create / update / delete inside `prisma.$transaction(async tx => ...)`,
  // so we route the $transaction callback to the same tx-shaped object.
  // Both `prisma.x.method(...)` and `tx.x.method(...)` therefore record on
  // the same vi.fn() instance.
  mockPrisma: (() => {
    const tx = {
      assetInstance: {
        create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => ({
          id: 'inst-1',
          ...args.data,
        })),
        update: vi.fn().mockImplementation(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
          id: args.where.id,
          ...args.data,
        })),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      assetRelationship: {
        create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => ({
          id: 'rel-1',
          ...args.data,
        })),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      assetIdentifier: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      deviceCredential: {
        create: vi.fn().mockResolvedValue({ id: 'cred-1' }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      connectivityStatus: {
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      unsMapping: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      qrCode: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      latestTelemetry: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      dataStream: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    return {
      ...tx,
      $transaction: vi.fn().mockImplementation(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
    };
  })(),
}));

vi.mock('../../repositories/instance.repository.js', () => ({ instanceRepository: mockInstanceRepo }));
vi.mock('../../repositories/relationship.repository.js', () => ({ relationshipRepository: mockRelRepo }));
vi.mock('../../repositories/identifier.repository.js', () => ({ identifierRepository: mockIdentRepo }));
vi.mock('../../repositories/template.repository.js', () => ({ templateRepository: mockTemplateRepo }));
vi.mock('../../helpers/attribute-validator.js', () => ({ validateAttributeValues: mockValidateAttributes }));
vi.mock('../../helpers/cycle-detection.js', () => ({ hasContainsCycle: mockHasCycle }));
vi.mock('../../helpers/descendant-collector.js', () => ({ collectDescendantIds: mockCollectDescendants }));
vi.mock('../../../../lib/audit.js', () => ({ auditLog: mockAuditLog }));
vi.mock('../../../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import { instanceService } from '../instance.service.js';

const ctx = { userId: 'admin', userSub: 'sub-1', userRole: 'ADMIN', ipAddress: '127.0.0.1', userAgent: 'test', sessionId: 'sess-1' };

describe('instanceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditLog.mockResolvedValue(undefined);
    mockValidateAttributes.mockReturnValue([]);
  });

  describe('list', () => {
    it('returns paginated instances', async () => {
      mockInstanceRepo.findMany.mockResolvedValue({ instances: [{ id: 'i1' }], total: 1 });
      const result = await instanceService.list({ page: 1, limit: 10 });
      expect(result.data).toHaveLength(1);
    });
  });

  describe('getTree', () => {
    it('returns flat tree array', async () => {
      mockInstanceRepo.findTree.mockResolvedValue([{ id: 'i1' }, { id: 'i2' }]);
      const result = await instanceService.getTree();
      expect(result).toHaveLength(2);
    });
  });

  describe('getById', () => {
    it('returns instance', async () => {
      mockInstanceRepo.findById.mockResolvedValue({ id: 'i1', name: 'Pump-1' });
      const result = await instanceService.getById('i1');
      expect(result.name).toBe('Pump-1');
    });

    it('throws NotFoundError', async () => {
      mockInstanceRepo.findById.mockResolvedValue(null);
      await expect(instanceService.getById('bad')).rejects.toThrow('not found');
    });
  });

  describe('create', () => {
    it('creates instance without parent', async () => {
      mockTemplateRepo.findById.mockResolvedValue({ id: 't1', version: 1, attributeSchema: [] });
      mockInstanceRepo.create.mockResolvedValue({ id: 'new-1', name: 'P1' });

      const result = await instanceService.create({ name: 'P1', templateId: 't1' }, ctx);
      expect(result.name).toBe('P1');
    });

    it('creates instance with parent and CONTAINS + CONTAINED_IN relationships in one transaction', async () => {
      mockTemplateRepo.findById.mockResolvedValue({ id: 't1', version: 1, attributeSchema: [], maxParentConnections: 1, maxConnections: 10 });
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'parent', templateId: 't1' });
      mockRelRepo.countBySourceAsset.mockResolvedValue(2);
      mockInstanceRepo.findByIdWithName.mockResolvedValue({ name: 'Parent' });
      mockHasCycle.mockResolvedValue(false);

      // Make assetInstance.create return the deterministic 'child' id our
      // assertions check for. Cast through unknown because vi.fn typed via
      // mockImplementation in hoisted block keeps a generic Mock signature.
      (mockPrisma.assetInstance.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'child',
        name: 'Child',
      });

      const result = await instanceService.create({ name: 'Child', templateId: 't1', parentId: 'parent' }, ctx);
      expect(result.name).toBe('Child');

      // Service inlines the relationship pair inside prisma.$transaction
      // using tx.assetRelationship.create. We aliased `tx` to `mockPrisma`,
      // so the spy records both calls.
      expect(mockPrisma.assetRelationship.create).toHaveBeenCalledTimes(2);
      const calls = (mockPrisma.assetRelationship.create as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].data.relationshipType);
      expect(calls).toEqual(expect.arrayContaining(['CONTAINS', 'CONTAINED_IN']));
    });

    it('rejects invalid attributes', async () => {
      mockTemplateRepo.findById.mockResolvedValue({ id: 't1', version: 1, attributeSchema: [{ name: 'temp', dataType: 'INTEGER', required: true }] });
      mockValidateAttributes.mockReturnValue(['temp is required']);

      await expect(instanceService.create({ name: 'P1', templateId: 't1', attributes: {} }, ctx))
        .rejects.toThrow('ATTRIBUTE_VALIDATION_ERROR');
    });

    it('rejects when template not found', async () => {
      mockTemplateRepo.findById.mockResolvedValue(null);
      await expect(instanceService.create({ name: 'P', templateId: 'bad' }, ctx))
        .rejects.toThrow('Template not found');
    });
  });

  describe('changeStatus', () => {
    it('changes status and logs audit', async () => {
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'i1', status: 'ACTIVE', name: 'P1' });
      mockInstanceRepo.update.mockResolvedValue({ id: 'i1', status: 'MAINTENANCE', name: 'P1' });

      const result = await instanceService.changeStatus('i1', 'MAINTENANCE', ctx);
      expect(result.status).toBe('MAINTENANCE');
      expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'ASSET_STATUS_CHANGED' }));
    });

    it('rejects empty status', async () => {
      await expect(instanceService.changeStatus('i1', '', ctx)).rejects.toThrow('required');
    });
  });

  describe('delete', () => {
    it('cascade soft-deletes with descendants in a single transaction', async () => {
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'i1', name: 'P1', status: 'ACTIVE', isActive: true });
      mockCollectDescendants.mockResolvedValue(['child-1', 'child-2']);

      const count = await instanceService.delete('i1', ctx);
      expect(count).toBe(3); // i1 + 2 descendants

      // Service runs everything via prisma.$transaction(tx) using direct tx
      // table calls (not the repository). Verify the assetInstance soft-delete
      // updateMany covers all three IDs and clears unsPath.
      expect(mockPrisma.assetInstance.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['i1', 'child-1', 'child-2'] } },
        data: { isActive: false, unsPath: null, updatedBy: 'admin' },
      });
      // ...and the FK-dependent rows are deleted with the same id set.
      expect(mockPrisma.assetRelationship.deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { sourceAssetId: { in: ['i1', 'child-1', 'child-2'] } },
            { targetAssetId: { in: ['i1', 'child-1', 'child-2'] } },
          ],
        },
      });
      expect(mockPrisma.assetIdentifier.deleteMany).toHaveBeenCalledWith({
        where: { assetId: { in: ['i1', 'child-1', 'child-2'] } },
      });
    });
  });

  describe('getChildren', () => {
    it('returns children of parent', async () => {
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'p1' });
      mockInstanceRepo.findChildren.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

      const result = await instanceService.getChildren('p1');
      expect(result).toHaveLength(2);
    });
  });
});
