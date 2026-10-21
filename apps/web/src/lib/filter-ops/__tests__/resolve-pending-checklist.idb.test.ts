/**
 * resolveChecklistForTargetStage / resolvePendingChecklistDialog end to end: the REAL
 * offline-cache, offline-store, action-tape and apiClient run. Replaced boundaries only:
 *   - `indexedDB` global -> lib/__tests__/support/fake-idb.ts (jsdom has none);
 *   - global `fetch` -> page-harness mockApi;
 *   - `isOnline` from connectivity -> true (the real one probes /api/health).
 * The sibling resolve-pending-checklist.test.ts keeps its module-mock unit tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installFakeIdb, type FakeIdb } from '@/lib/__tests__/support/fake-idb';
import { mockApi, type MockApi } from '@/test-utils/page-harness';

vi.mock('@/lib/connectivity', () => ({ isOnline: () => true, onConnectivityChange: () => () => {} }));

import { resolveChecklistForTargetStage, resolvePendingChecklistDialog } from '../resolve-pending-checklist';
import { cacheData, OFFLINE_TTL_MS } from '@/lib/offline-store';

// START -> WASH_IN -> WASH_OUT -> CHECKLIST(cl-final) -> END
const graph = {
  id: 'cp-1', lineageId: 'lin-1', name: 'Std', flowMode: 'SEQUENTIAL', version: 1, status: 'ACTIVE', cleaningReasons: {},
  stages: [
    { id: 'n-s', stateKey: null, nodeType: 'START', configuration: {}, sortOrder: 0 },
    { id: 'n-wi', stateKey: 'WASH_IN', nodeType: 'STAGE', configuration: {}, sortOrder: 1 },
    { id: 'n-wo', stateKey: 'WASH_OUT', nodeType: 'STAGE', configuration: {}, sortOrder: 2 },
    { id: 'n-cl', stateKey: null, nodeType: 'CHECKLIST', configuration: { checklistProfileId: 'cl-final' }, sortOrder: 3 },
    { id: 'n-e', stateKey: null, nodeType: 'END', configuration: {}, sortOrder: 4 },
  ],
  connections: [
    { fromStageId: 'n-s', toStageId: 'n-wi' }, { fromStageId: 'n-wi', toStageId: 'n-wo' },
    { fromStageId: 'n-wo', toStageId: 'n-cl' }, { fromStageId: 'n-cl', toStageId: 'n-e' },
  ],
};
const profile = {
  id: 'cl-final', name: 'Final check', version: 4, isActive: true,
  questions: [{ id: 'q1', question: 'Seal intact?', questionType: 'YES_NO', required: true, sortOrder: 0 }],
};
const PROFILES_URL = /^\/api\/checklist-profiles\?/;

let idb: FakeIdb;
let api: MockApi;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  idb = installFakeIdb();
  sessionStorage.setItem('access_token', 't');
  localStorage.removeItem('digilog_cached_user');
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await cacheData('filter-state-f1', { pipelineGraph: graph, currentState: 'WASH_IN' });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); sessionStorage.clear(); });

const cachedProfiles = () => idb.rows('cache').find((r) => r.key === 'checklist-profiles');

describe('resolveChecklistForTargetStage — refetch when the questions are not cached', () => {
  it('online: fetches the active profiles with questions, caches them, and answers up front', async () => {
    api = mockApi([{ path: PROFILES_URL, body: { data: [profile] } }]);
    const rows = await resolveChecklistForTargetStage('f1', 'WASH_OUT', true);
    expect(rows).toEqual([expect.objectContaining({
      checklistProfileId: 'cl-final', checklistProfileName: 'Final check', profileVersion: 4,
      questions: [expect.objectContaining({ id: 'q1', question: 'Seal intact?' })],
    })]);
    const [req] = api.requests;
    expect(req.path).toBe('/api/checklist-profiles');
    expect(req.query.get('isActive')).toBe('true');
    expect(req.query.get('expand')).toBe('questions');
    expect(Number(req.query.get('limit'))).toBeGreaterThan(1000);
    const row = cachedProfiles()!;
    expect(row.data).toEqual([profile]);
    expect(Date.parse(row.expiresAt) - Date.parse(row.cachedAt)).toBe(OFFLINE_TTL_MS);
  });

  it('accepts a bare-array response too', async () => {
    mockApi([{ path: PROFILES_URL, body: [profile] }]);
    expect(await resolveChecklistForTargetStage('f1', 'WASH_OUT', true)).toHaveLength(1);
  });

  it('a cached profile answers without any request', async () => {
    await cacheData('checklist-profiles', [profile]);
    api = mockApi();
    expect(await resolveChecklistForTargetStage('f1', 'WASH_OUT', true)).toHaveLength(1);
    expect(api.requests).toEqual([]);
  });

  it('offline with the questions missing: [] (caller keeps the post-advance path), no request', async () => {
    api = mockApi();
    expect(await resolveChecklistForTargetStage('f1', 'WASH_OUT', false)).toEqual([]);
    expect(api.requests).toEqual([]);
  });

  it('a stage with no checklist after it: [] with no request', async () => {
    api = mockApi();
    expect(await resolveChecklistForTargetStage('f1', 'WASH_IN', true)).toEqual([]);
    expect(api.requests).toEqual([]);
  });

  it('a failed refetch falls back to [] and caches nothing', async () => {
    mockApi([{ path: PROFILES_URL, status: 500, body: { error: 'X', message: 'down' } }]);
    expect(await resolveChecklistForTargetStage('f1', 'WASH_OUT', true)).toEqual([]);
    expect(cachedProfiles()).toBeUndefined();
  });

  it('a malformed refetch body falls back to [] and caches nothing', async () => {
    mockApi([{ path: PROFILES_URL, body: { data: { not: 'an array' } } }]);
    expect(await resolveChecklistForTargetStage('f1', 'WASH_OUT', true)).toEqual([]);
    expect(cachedProfiles()).toBeUndefined();
  });

  it('a refetch that still lacks the profile resolves to []', async () => {
    mockApi([{ path: PROFILES_URL, body: { data: [{ ...profile, id: 'other' }] } }]);
    expect(await resolveChecklistForTargetStage('f1', 'WASH_OUT', true)).toEqual([]);
  });

  it('online with no cached filter state: no interlock data, falls through to the normal resolve', async () => {
    api = mockApi();
    expect(await resolveChecklistForTargetStage('unknown-filter', 'WASH_OUT', true)).toEqual([]);
    expect(api.requests).toEqual([]);
  });

  it('a gated terminal stage whose lookup omits nextStages is still treated as terminal', async () => {
    await cacheData('filter-state-f1', {
      pipelineGraph: graph, currentState: 'WASH_IN',
      stageLookup: { WASH_OUT: { interlockGated: true, leadsToEnd: true } },
    });
    api = mockApi();
    expect(await resolveChecklistForTargetStage('f1', 'WASH_OUT', true)).toEqual([]);
    expect(api.requests).toEqual([]);
  });
  void warn;
});

describe('resolvePendingChecklistDialog — local tape + cache fallback', () => {
  it('a legacy server tape (SUBMIT_CHECKLIST without questions) falls back to the cached pendingChecklist rows', async () => {
    await cacheData('filter-state-f1', {
      pipelineGraph: graph, currentState: 'WASH_OUT',
      pendingChecklist: [{ pipelineNodeId: 'n-cl', checklistProfileId: 'cl-final', checklistProfileName: 'Final check' }],
    });
    const legacyTape = [{ type: 'SUBMIT_CHECKLIST', label: 'Submit Checklist: Final check', params: { afterStage: 'WASH_OUT', checklistProfileId: 'cl-final' } }] as any;
    const rows = await resolvePendingChecklistDialog('f1', legacyTape);
    expect(rows).toEqual([{ pipelineNodeId: 'n-cl', checklistProfileId: 'cl-final', checklistProfileName: 'Final check', questions: [] }]);
  });

  it('nothing to show when the tape asks for a checklist but neither tape nor cache has rows', async () => {
    const tape = [{ type: 'SUBMIT_CHECKLIST', label: 'Submit Checklist: X', params: { afterStage: 'WASH_OUT', checklistProfileId: 'x', questions: [] } }] as any;
    // the server tape yields a row with no questions, and no pendingChecklist is cached
    expect(await resolvePendingChecklistDialog('never-cached', tape)).toBeNull();
  });
});
