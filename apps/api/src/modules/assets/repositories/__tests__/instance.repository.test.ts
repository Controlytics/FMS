import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    assetInstance: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock('../../../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import { instanceRepository } from '../instance.repository.js';

describe('instance.repository', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('findMany', () => {
    it('returns paginated instances', async () => {
      mockPrisma.assetInstance.findMany.mockResolvedValue([{ id: 'i1', name: 'Pump-1' }]);
      mockPrisma.assetInstance.count.mockResolvedValue(1);
      const result = await instanceRepository.findMany({}, 0, 10);
      expect(result.instances).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('findById', () => {
    it('returns instance with template', async () => {
      mockPrisma.assetInstance.findUnique.mockResolvedValue({
        id: 'i1', name: 'Pump-1',
        template: { id: 't1', name: 'Pump' },
      });
      const result = await instanceRepository.findById('i1');
      expect(result?.name).toBe('Pump-1');
    });
  });

  describe('findByIdSimple', () => {
    it('returns instance without joins', async () => {
      mockPrisma.assetInstance.findUnique.mockResolvedValue({ id: 'i1', name: 'Pump-1' });
      const result = await instanceRepository.findByIdSimple('i1');
      expect(result?.id).toBe('i1');
    });
  });

  describe('create', () => {
    it('creates a new instance', async () => {
      mockPrisma.assetInstance.create.mockResolvedValue({ id: 'i2', name: 'Valve-1' });
      const result = await instanceRepository.create({
        name: 'Valve-1', templateId: 't1', status: 'ACTIVE',
      });
      expect(result.name).toBe('Valve-1');
    });
  });

  describe('update', () => {
    it('updates instance data', async () => {
      mockPrisma.assetInstance.update.mockResolvedValue({ id: 'i1', status: 'MAINTENANCE' });
      const result = await instanceRepository.update('i1', { status: 'MAINTENANCE' });
      expect(result.status).toBe('MAINTENANCE');
    });
  });

  describe('softDeleteMany', () => {
    it('soft-deletes multiple instances', async () => {
      mockPrisma.assetInstance.updateMany.mockResolvedValue({ count: 3 });
      const result = await instanceRepository.softDeleteMany(['i1', 'i2', 'i3'], 'admin');
      expect(result.count).toBe(3);
    });
  });

  describe('findChildren', () => {
    it('returns child instances', async () => {
      mockPrisma.assetInstance.findMany.mockResolvedValue([
        { id: 'c1', parentId: 'i1' },
        { id: 'c2', parentId: 'i1' },
      ]);
      const result = await instanceRepository.findChildren('i1');
      expect(result).toHaveLength(2);
    });
  });
});
