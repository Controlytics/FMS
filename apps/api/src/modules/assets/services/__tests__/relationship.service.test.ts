import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockRelRepo, mockInstanceRepo, mockTemplateRepo, mockHasCycle, mockAuditLog } = vi.hoisted(() => ({
  mockRelRepo: {
    findMany: vi.fn(),
    findById: vi.fn(),
    findByCompositeKey: vi.fn(),
    findInverse: vi.fn(),
    createPairWithParent: vi.fn(),
    deletePairWithParent: vi.fn(),
    countBySourceAsset: vi.fn(),
    countContainsParents: vi.fn(),
    countContainsChildren: vi.fn(),
  },
  mockInstanceRepo: {
    findByIdSimple: vi.fn(),
    findByIdWithName: vi.fn(),
  },
  mockTemplateRepo: { findById: vi.fn() },
  mockHasCycle: vi.fn(),
  mockAuditLog: vi.fn(),
}));

vi.mock('../../repositories/relationship.repository.js', () => ({ relationshipRepository: mockRelRepo }));
vi.mock('../../repositories/instance.repository.js', () => ({ instanceRepository: mockInstanceRepo }));
vi.mock('../../repositories/template.repository.js', () => ({ templateRepository: mockTemplateRepo }));
vi.mock('../../helpers/cycle-detection.js', () => ({ hasContainsCycle: mockHasCycle }));
vi.mock('../../../../lib/audit.js', () => ({ auditLog: mockAuditLog }));
vi.mock('@digilog/shared', () => ({
  INVERSE_RELATIONSHIP_MAP: {
    CONTAINS: 'CONTAINED_IN',
    CONTAINED_IN: 'CONTAINS',
    FEEDS: 'FED_BY',
    FED_BY: 'FEEDS',
    CONNECTED_TO: 'CONNECTED_TO',
  },
}));

import { relationshipService } from '../relationship.service.js';

const ctx = { userId: 'admin', userSub: 'sub-1', userRole: 'ADMIN', ipAddress: '127.0.0.1', userAgent: 'test', sessionId: 'sess-1' };

describe('relationshipService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditLog.mockResolvedValue(undefined);
  });

  describe('list', () => {
    it('returns relationships for asset', async () => {
      mockRelRepo.findMany.mockResolvedValue([{ id: 'r1' }]);
      const result = await relationshipService.list({ assetId: 'a1' });
      expect(result).toHaveLength(1);
    });
  });

  describe('create', () => {
    const setupCreate = () => {
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'a1', name: 'Source', templateId: 't1' });
      mockRelRepo.findByCompositeKey.mockResolvedValue(null);
      mockTemplateRepo.findById.mockResolvedValue({ maxConnections: 10, maxParentConnections: 1 });
      mockRelRepo.countBySourceAsset.mockResolvedValue(2);
      mockRelRepo.countContainsChildren.mockResolvedValue(0);
      mockRelRepo.countContainsParents.mockResolvedValue(0);
      mockHasCycle.mockResolvedValue(false);
      mockRelRepo.createPairWithParent.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
    };

    it('creates bidirectional relationship', async () => {
      setupCreate();

      const result = await relationshipService.create({
        sourceAssetId: 'a1', targetAssetId: 'a2', relationshipType: 'FEEDS',
      }, ctx);

      expect(result.relationship.id).toBe('r1');
      expect(result.inverse.id).toBe('r2');
      expect(result.connectionInfo).toBeDefined();
    });

    it('rejects self-relationship', async () => {
      await expect(relationshipService.create({
        sourceAssetId: 'a1', targetAssetId: 'a1', relationshipType: 'FEEDS',
      }, ctx)).rejects.toThrow('itself');
    });

    it('rejects duplicate relationship', async () => {
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'a1', templateId: 't1' });
      mockRelRepo.findByCompositeKey.mockResolvedValue({ id: 'existing' });

      await expect(relationshipService.create({
        sourceAssetId: 'a1', targetAssetId: 'a2', relationshipType: 'FEEDS',
      }, ctx)).rejects.toThrow('already exists');
    });

    it('rejects when max connections reached', async () => {
      mockInstanceRepo.findByIdSimple.mockResolvedValue({ id: 'a1', templateId: 't1' });
      mockRelRepo.findByCompositeKey.mockResolvedValue(null);
      mockTemplateRepo.findById.mockResolvedValue({ maxConnections: 5 });
      mockRelRepo.countBySourceAsset.mockResolvedValue(5); // already at max

      await expect(relationshipService.create({
        sourceAssetId: 'a1', targetAssetId: 'a2', relationshipType: 'FEEDS',
      }, ctx)).rejects.toThrow('max connections');
    });

    it('rejects CONTAINS when cycle would form', async () => {
      setupCreate();
      mockHasCycle.mockResolvedValue(true);

      await expect(relationshipService.create({
        sourceAssetId: 'a1', targetAssetId: 'a2', relationshipType: 'CONTAINS',
      }, ctx)).rejects.toThrow('cycle');
    });

    it('rejects CONTAINS when target already has children', async () => {
      setupCreate();
      mockRelRepo.countContainsChildren.mockResolvedValue(3); // target is parent

      await expect(relationshipService.create({
        sourceAssetId: 'a1', targetAssetId: 'a2', relationshipType: 'CONTAINS',
      }, ctx)).rejects.toThrow('already a parent');
    });
  });

  describe('delete', () => {
    it('deletes both sides of relationship', async () => {
      mockRelRepo.findById.mockResolvedValue({
        id: 'r1', sourceAssetId: 'a1', targetAssetId: 'a2', relationshipType: 'FEEDS',
      });
      mockRelRepo.findInverse.mockResolvedValue({ id: 'r2' });
      mockRelRepo.deletePairWithParent.mockResolvedValue([]);
      mockInstanceRepo.findByIdWithName.mockResolvedValue({ name: 'Entity' });

      await relationshipService.delete('r1', ctx);
      expect(mockRelRepo.deletePairWithParent).toHaveBeenCalledWith('r1', 'r2', undefined);
    });

    it('clears parentId when deleting CONTAINS', async () => {
      mockRelRepo.findById.mockResolvedValue({
        id: 'r1', sourceAssetId: 'a1', targetAssetId: 'a2', relationshipType: 'CONTAINS',
      });
      mockRelRepo.findInverse.mockResolvedValue({ id: 'r2' });
      mockRelRepo.deletePairWithParent.mockResolvedValue([]);
      mockInstanceRepo.findByIdWithName.mockResolvedValue({ name: 'Entity' });

      await relationshipService.delete('r1', ctx);
      expect(mockRelRepo.deletePairWithParent).toHaveBeenCalledWith('r1', 'r2', { instanceId: 'a2' });
    });

    it('throws NotFoundError', async () => {
      mockRelRepo.findById.mockResolvedValue(null);
      await expect(relationshipService.delete('bad', ctx)).rejects.toThrow('not found');
    });
  });
});
