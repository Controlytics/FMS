import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    unsMapping: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    assetInstance: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    deviceCredential: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import { buildUnsTree, searchByWildcard } from '../uns.service.js';

describe('uns.service', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('buildUnsTree', () => {
    it('returns empty array when no mappings exist', async () => {
      mockPrisma.unsMapping.findMany.mockResolvedValue([]);
      const result = await buildUnsTree();
      expect(result).toEqual([]);
    });

    it('builds tree from UNS mappings', async () => {
      mockPrisma.unsMapping.findMany.mockResolvedValue([
        { unsPath: 'digilog/v1/enterprise/site/area/pump-1', entityId: 'e1' },
      ]);
      // buildUnsTree fetches entity names for the leaf nodes via
      // assetInstance.findMany. Without this stub the .map() at line 327
      // explodes on `undefined`.
      mockPrisma.assetInstance.findMany.mockResolvedValue([
        { id: 'e1', name: 'Pump 1' },
      ]);
      const result = await buildUnsTree();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].name).toBe('digilog');
    });

    it('nests multiple entities under shared paths', async () => {
      mockPrisma.unsMapping.findMany.mockResolvedValue([
        { unsPath: 'digilog/v1/ent/site/area/pump-1', entityId: 'e1' },
        { unsPath: 'digilog/v1/ent/site/area/pump-2', entityId: 'e2' },
      ]);
      mockPrisma.assetInstance.findMany.mockResolvedValue([
        { id: 'e1', name: 'Pump 1' },
        { id: 'e2', name: 'Pump 2' },
      ]);
      const result = await buildUnsTree();
      // Both share digilog > v1 > ent > site > area
      expect(result).toHaveLength(1); // single root "digilog"
    });
  });

  describe('searchByWildcard', () => {
    it('returns exact match for non-wildcard pattern', async () => {
      // searchByWildcard for a non-wildcard pattern uses unsMapping.findMany
      // (it scans + filters in-memory) and assetInstance.findMany twice
      // (one by-id lookup, one name-match search). Stub all three.
      mockPrisma.unsMapping.findMany.mockResolvedValue([
        { entityId: 'e1', unsPath: 'digilog/v1/ent/site/area/pump-1' },
      ]);
      mockPrisma.assetInstance.findMany
        .mockResolvedValueOnce([{ id: 'e1', name: 'Pump 1' }]) // by id
        .mockResolvedValueOnce([]); // name-match search

      const result = await searchByWildcard('digilog/v1/ent/site/area/pump-1');
      expect(result).toHaveLength(1);
      expect(result[0].entityId).toBe('e1');
    });

    it('returns empty array when no exact match', async () => {
      mockPrisma.unsMapping.findMany.mockResolvedValue([]);
      mockPrisma.assetInstance.findMany.mockResolvedValue([]);

      const result = await searchByWildcard('digilog/v1/missing');
      expect(result).toHaveLength(0);
    });

    it('filters by wildcard pattern with #', async () => {
      mockPrisma.unsMapping.findMany.mockResolvedValue([
        { entityId: 'e1', unsPath: 'digilog/v1/ent/site/area/pump-1' },
        { entityId: 'e2', unsPath: 'digilog/v1/ent/site/area/pump-2' },
        { entityId: 'e3', unsPath: 'digilog/v1/other/site/thing' },
      ]);
      mockPrisma.assetInstance.findMany.mockResolvedValue([
        { id: 'e1', name: 'Pump 1' },
        { id: 'e2', name: 'Pump 2' },
      ]);

      const result = await searchByWildcard('digilog/v1/ent/#');
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by wildcard pattern with +', async () => {
      mockPrisma.unsMapping.findMany.mockResolvedValue([
        { entityId: 'e1', unsPath: 'digilog/v1/ent/site1/pump' },
        { entityId: 'e2', unsPath: 'digilog/v1/ent/site2/pump' },
      ]);
      mockPrisma.assetInstance.findMany.mockResolvedValue([
        { id: 'e1', name: 'Pump A' },
        { id: 'e2', name: 'Pump B' },
      ]);

      const result = await searchByWildcard('digilog/v1/ent/+/pump');
      expect(result).toHaveLength(2);
    });
  });
});
