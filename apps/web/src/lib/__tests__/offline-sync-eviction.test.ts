/**
 * M53 (2026-10-19): a retired / deactivated filter must drop out of the
 * tablet's cached READ data when the online refresh no longer offers it —
 * otherwise an OFFLINE scan still resolves its tag and its cached state still
 * says "cleanable".
 *
 * Covers the one identifier-map builder (shared by the full sync, the tablet
 * operations page and the wrapper) and the filter-state eviction in
 * syncAllDataForOffline. Queued work is never stranded: a filter with any
 * unsynced op keeps both its map entry and its filter-state row (replay reads
 * tapeVersion from that row).
 *
 * The IndexedDB layer is mocked — the workspace has no fake-indexeddb (see
 * offline-store.test.ts). What is asserted is WHAT the sync asks the store to
 * keep / delete, which is where the rule lives.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({
  cacheData: vi.fn(async () => {}),
  cacheFilters: vi.fn(async () => {}),
  cacheBlocks: vi.fn(async () => {}),
  cacheAreas: vi.fn(async () => {}),
  cacheAhus: vi.fn(async () => {}),
  cacheFiltersTyped: vi.fn(async () => {}),
  deleteFilterStatesExcept: vi.fn(async () => 0),
  getAllOperations: vi.fn(async () => [] as any[]),
  getPendingTombstones: vi.fn(async () => [] as any[]),
}));
const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../offline-store', () => store);
vi.mock('../api-client', () => ({ apiClient: api }));
vi.mock('../offline-cache', () => ({ withDerivedPendingChecklist: (s: any) => s }));

import { buildIdentifierMap, filterIdsWithUnsyncedWork, syncAllDataForOffline } from '../offline-sync-service';

const IDENTS = [
  { identifierValue: 'CA000001', assetId: 'live', asset: { name: 'F-LIVE', status: 'Active', isActive: true, approvalStatus: 'APPROVED' } },
  { identifierValue: 'CA000002', assetId: 'retired', asset: { name: 'F-RET', status: 'Retired', isActive: true, approvalStatus: 'APPROVED' } },
  { identifierValue: 'CA000003', assetId: 'inactive', asset: { name: 'F-OFF', status: 'Active', isActive: false, approvalStatus: 'APPROVED' } },
  { identifierValue: 'CA000004', assetId: 'pending', asset: { name: 'F-PEND', status: 'Active', isActive: true, approvalStatus: 'PENDING_REVIEW' } },
];

describe('buildIdentifierMap (the one builder)', () => {
  it('leaves out tags held by retired or deactivated filters', () => {
    const map = buildIdentifierMap(IDENTS);
    expect(map.CA000001?.filterId).toBe('live');
    expect(map.CA000002).toBeUndefined();
    expect(map.CA000003).toBeUndefined();
  });

  it('keeps a gone holder that still has queued work', () => {
    const map = buildIdentifierMap(IDENTS, new Set(['retired']));
    expect(map.CA000002?.filterId).toBe('retired');
    expect(map.CA000003).toBeUndefined();
  });

  it('carries approvalStatus so the offline not-approved gate can refuse', () => {
    expect(buildIdentifierMap(IDENTS).CA000004?.approvalStatus).toBe('PENDING_REVIEW');
  });

  it('indexes the raw, upper and lower spellings', () => {
    const map = buildIdentifierMap([{ identifierValue: 'ab12cd', assetId: 'x', asset: { name: 'X' } }]);
    expect(map.ab12cd?.filterId).toBe('x');
    expect(map.AB12CD?.filterId).toBe('x');
  });
});

describe('filterIdsWithUnsyncedWork', () => {
  beforeEach(() => vi.clearAllMocks());
  it('collects every non-synced op, any owner', async () => {
    store.getAllOperations.mockResolvedValueOnce([
      { filterId: 'a', status: 'pending', ownerUserId: 'u1' },
      { filterId: 'b', status: 'failed', ownerUserId: 'u2' },
      { filterId: 'c', status: 'syncing' },
      { filterId: 'd', status: 'synced' },
    ]);
    store.getPendingTombstones.mockResolvedValueOnce([{ payload: { filterId: 'e' } }]);
    expect([...await filterIdsWithUnsyncedWork()].sort()).toEqual(['a', 'b', 'c', 'e']);
  });
});

function routeApi(opts: { batchFails?: boolean } = {}) {
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/assets/templates') return { data: [{ id: 't', templateKind: 'FILTER' }] };
    if (url === '/api/assets/instances') return { data: [{ id: 'live', templateId: 't' }] };
    if (url.startsWith('/api/hierarchy/')) return { data: [] };
    if (url === '/api/filters/batch-states') {
      if (opts.batchFails) throw new Error('batch down');
      return { states: { live: { currentState: 'WASH_IN' } }, cachedAt: 'now' };
    }
    if (url.startsWith('/api/filters/') && url.endsWith('/current-state')) return { currentState: 'WASH_IN' };
    if (url === '/api/assets/identifiers') return IDENTS;
    return [];
  });
}

describe('syncAllDataForOffline — eviction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('evicts filter-state rows /batch-states no longer returns, keeping filters with queued work', async () => {
    routeApi();
    store.getAllOperations.mockResolvedValue([{ filterId: 'retired', status: 'pending' }]);
    await syncAllDataForOffline();
    expect(store.deleteFilterStatesExcept).toHaveBeenCalledTimes(1);
    const keep = (store.deleteFilterStatesExcept.mock.calls[0] as any[])[0] as Set<string>;
    expect([...keep].sort()).toEqual(['live', 'retired']);
  });

  it('never evicts on the per-filter fallback (a partial list)', async () => {
    routeApi({ batchFails: true });
    await syncAllDataForOffline();
    expect(store.deleteFilterStatesExcept).not.toHaveBeenCalled();
  });

  it('caches the identifier map without retired/deactivated holders', async () => {
    routeApi();
    store.getAllOperations.mockResolvedValue([]);
    await syncAllDataForOffline();
    const call = (store.cacheData.mock.calls as any[]).find((c) => c[0] === 'identifier-map');
    expect(call).toBeTruthy();
    const map = call[1];
    expect(map.CA000001?.filterId).toBe('live');
    expect(map.CA000002).toBeUndefined();
    expect(map.CA000003).toBeUndefined();
    expect(map.CA000004?.approvalStatus).toBe('PENDING_REVIEW');
  });
});
