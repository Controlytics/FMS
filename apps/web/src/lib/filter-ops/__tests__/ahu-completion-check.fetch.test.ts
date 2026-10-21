/**
 * AHU completion pre-flight through the REAL apiClient: only global `fetch` is
 * stubbed (page-harness `mockApi`), so the assertions cover the URL and body the
 * tablet/desktop actually send. The sibling file keeps its apiClient-mock tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockApi, type MockRequest } from '@/test-utils/page-harness';
import {
  checkAhuCompletion, checkAhuCompletionBatch, checkAhuHasBothSets,
  isTerminalChecklist, isCompletingAdvance, isTerminalTargetWithChecklist,
} from '../ahu-completion-check';

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sessionStorage.setItem('access_token', 'test-token');
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); sessionStorage.clear(); });

describe('checkAhuCompletion (single filter)', () => {
  const pending = [{ id: 'f2', name: 'F-2', stage: 'WASH_IN' }];
  const filters = [{ id: 'f1', name: 'F-1', stage: 'STORAGE_OUT', done: true }, { id: 'f2', name: 'F-2', stage: 'WASH_IN', done: false }];

  it('INTERLOCK with pending siblings blocks, and asks for the AHU excluding this filter', async () => {
    const api = mockApi([{ path: '/api/filters/ahu/ahu-1/completion-status', body: { allAtFinal: false, ahuName: 'AHU-01', pending, filters } }]);
    const r = await checkAhuCompletion('INTERLOCK', 'ahu-1', 'f1', true);
    expect(r).toEqual({ block: true, warn: false, ahuName: 'AHU-01', filters, pending });
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0].url).toBe('/api/filters/ahu/ahu-1/completion-status?exclude=f1');
    expect(api.requests[0].headers.authorization).toBe('Bearer test-token');
  });

  it('POPUP with pending siblings warns instead of blocking', async () => {
    mockApi([{ path: '/api/filters/ahu/ahu-1/completion-status', body: { allAtFinal: false, ahuName: 'AHU-01', pending, filters } }]);
    const r = await checkAhuCompletion('POPUP', 'ahu-1', 'f1', true);
    expect(r.block).toBe(false);
    expect(r.warn).toBe(true);
  });

  it('POPUP is still asked while offline (only INTERLOCK defers to the server)', async () => {
    const api = mockApi([{ path: '/api/filters/ahu/ahu-1/completion-status', body: { allAtFinal: true, pending: [] } }]);
    const r = await checkAhuCompletion('POPUP', 'ahu-1', 'f1', false);
    expect(api.requests).toHaveLength(1);
    expect(r).toEqual({ block: false, warn: false, ahuName: '', filters: [], pending: [] });
  });

  it('a response without pending/filters/name reads as nothing pending', async () => {
    mockApi([{ path: '/api/filters/ahu/ahu-1/completion-status', body: { allAtFinal: true } }]);
    expect(await checkAhuCompletion('INTERLOCK', 'ahu-1', 'f1', true)).toEqual({ block: false, warn: false, ahuName: '', filters: [], pending: [] });
  });

  it.each([
    ['mode NONE', 'NONE', 'ahu-1', true],
    ['no AHU', 'INTERLOCK', null, true],
    ['INTERLOCK offline', 'INTERLOCK', 'ahu-1', false],
  ] as const)('%s: no request, nothing blocks', async (_l, mode, ahuId, online) => {
    const api = mockApi();
    expect(await checkAhuCompletion(mode, ahuId, 'f1', online)).toEqual({ block: false, warn: false, ahuName: '', filters: [], pending: [] });
    expect(api.requests).toEqual([]);
  });

  it('a server failure is thrown to the caller (callers catch and proceed)', async () => {
    mockApi([{ path: '/api/filters/ahu/ahu-1/completion-status', status: 500, body: { error: 'INTERNAL', message: 'boom' } }]);
    await expect(checkAhuCompletion('INTERLOCK', 'ahu-1', 'f1', true)).rejects.toBeTruthy();
  });
});

describe('checkAhuCompletionBatch request body', () => {
  it.each([
    ['SET_A', { filterIds: ['f1', 'f2'], set: 'SET_A' }],
    ['SET_B', { filterIds: ['f1', 'f2'], set: 'SET_B' }],
    ['ALL', { filterIds: ['f1', 'f2'] }],
    [undefined, { filterIds: ['f1', 'f2'] }],
  ] as const)('set %s is sent as %j', async (set, body) => {
    const api = mockApi([{ method: 'POST', path: '/api/filters/ahu-completion-status/batch', body: (req: MockRequest) => ({ ahus: [{ ahuId: 'a', echo: req.json }] }) }]);
    const r = await checkAhuCompletionBatch('POPUP', ['f1', 'f2'], true, set);
    expect(api.calls('POST', '/api/filters/ahu-completion-status/batch')[0].json).toEqual(body);
    expect(r.failed).toBe(false);
    expect(r.ahus).toHaveLength(1);
  });

  it('a response without ahus is an empty (not failed) result', async () => {
    mockApi([{ method: 'POST', path: '/api/filters/ahu-completion-status/batch', body: {} }]);
    expect(await checkAhuCompletionBatch('INTERLOCK', ['f1'], true)).toEqual({ ahus: [], failed: false });
  });

  it('an empty batch makes no request', async () => {
    const api = mockApi();
    expect(await checkAhuCompletionBatch('INTERLOCK', [], true)).toEqual({ ahus: [], failed: false });
    expect(api.requests).toEqual([]);
  });

  it('a 500 is reported as failed and logged, never as "all done"', async () => {
    mockApi([{ method: 'POST', path: '/api/filters/ahu-completion-status/batch', status: 500, body: { error: 'X' } }]);
    expect(await checkAhuCompletionBatch('INTERLOCK', ['f1'], true)).toEqual({ ahus: [], failed: true });
    expect(errSpy).toHaveBeenCalledWith('[ahu-completion] batch completion-status check failed', expect.anything());
  });
});

describe('checkAhuHasBothSets', () => {
  it('posts the filter ids and reads hasBothSets strictly', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/filters/ahu-set-availability', body: { hasBothSets: true } }]);
    expect(await checkAhuHasBothSets('POPUP', ['f1'], true)).toBe(true);
    expect(api.requests[0].json).toEqual({ filterIds: ['f1'] });
  });

  it('a truthy non-boolean is not "both sets"', async () => {
    mockApi([{ method: 'POST', path: '/api/filters/ahu-set-availability', body: { hasBothSets: 'yes' } }]);
    expect(await checkAhuHasBothSets('POPUP', ['f1'], true)).toBe(false);
  });

  it.each([
    ['mode NONE', 'NONE', ['f1'], true],
    ['no filters', 'POPUP', [], true],
    ['offline (any mode)', 'POPUP', ['f1'], false],
  ] as const)('%s: false with no request', async (_l, mode, ids, online) => {
    const api = mockApi();
    expect(await checkAhuHasBothSets(mode, [...ids], online)).toBe(false);
    expect(api.requests).toEqual([]);
  });
});

describe('terminal-stage predicates with sparse stageLookup entries', () => {
  it('isTerminalChecklist: missing nextStages counts as none', () => {
    expect(isTerminalChecklist('STORAGE_OUT', { STORAGE_OUT: { leadsToEnd: true } })).toBe(true);
    expect(isTerminalChecklist('STORAGE_OUT', { STORAGE_OUT: { leadsToEnd: true, nextStages: ['X'] } })).toBe(false);
    expect(isTerminalChecklist('STORAGE_OUT', { OTHER: { leadsToEnd: true } })).toBe(false);
    expect(isTerminalChecklist(null, { STORAGE_OUT: { leadsToEnd: true } })).toBe(false);
    expect(isTerminalChecklist('STORAGE_OUT', null)).toBe(false);
  });

  it('isCompletingAdvance: missing nextStages / pendingChecklistProfileIds count as none', () => {
    expect(isCompletingAdvance('STORAGE_OUT', { STORAGE_OUT: { leadsToEnd: true } })).toBe(true);
    expect(isCompletingAdvance('STORAGE_OUT', { STORAGE_OUT: { leadsToEnd: true, pendingChecklistProfileIds: ['c'] } })).toBe(false);
  });

  it('isTerminalTargetWithChecklist: needs a checklist; missing fields count as none', () => {
    expect(isTerminalTargetWithChecklist('STORAGE_OUT', { STORAGE_OUT: { leadsToEnd: true } })).toBe(false);
    expect(isTerminalTargetWithChecklist('STORAGE_OUT', { STORAGE_OUT: { leadsToEnd: true, pendingChecklistProfileIds: ['c'] } })).toBe(true);
    expect(isTerminalTargetWithChecklist('STORAGE_OUT', { STORAGE_OUT: { leadsToEnd: true, nextStages: ['X'], pendingChecklistProfileIds: ['c'] } })).toBe(false);
  });
});
