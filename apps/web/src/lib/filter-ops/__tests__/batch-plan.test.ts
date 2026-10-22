import { describe, it, expect } from 'vitest';
import {
  readingsCallKey,
  splitByReadings,
  checklistSignature,
  largestGroup,
  planFinalStageBatch,
  planPendingChecklistBatch,
  splitNewCycleBatch,
  splitUnread,
  leftInQueueMessage,
} from '../batch-plan';

const GA = { id: 'ga', name: 'Bay A', instruments: [{ id: 'i1', stageKey: 'WASH_IN' }] };
const GB = { id: 'gb', name: 'Bay B', instruments: [{ id: 'i2', stageKey: 'WASH_IN' }] };
const GC = { id: 'gc', name: 'Bay C', instruments: [{ id: 'i3', stageKey: 'DRY_IN' }] };
const bound = (g: any) => ({ currentCycle: { equipmentGroupId: g.id }, equipmentGroup: g, blockEquipmentGroups: [] });
const unbound = (...gs: any[]) => ({ currentCycle: { equipmentGroupId: null }, equipmentGroup: gs[0] ?? null, blockEquipmentGroups: gs });
const item = (n: number) => ({ filterId: `f${n}`, filterName: `F-00${n}` });
const of = (m: Record<string, any>) => (id: string) => m[id] ?? null;

describe('readingsCallKey', () => {
  it('names the call: the bound group, a choice, none, or unknown', () => {
    expect(readingsCallKey(bound(GB), 'WASH_IN')).toBe('group:gb');
    expect(readingsCallKey(unbound(GB, GA), 'WASH_IN')).toBe('choice:ga,gb');
    expect(readingsCallKey(unbound(GA), 'WASH_IN')).toBe('group:ga');
    expect(readingsCallKey(bound(GC), 'WASH_IN')).toBe('none'); // its group reads nothing at Wash In
    expect(readingsCallKey(unbound(), 'WASH_IN')).toBe('none');
    expect(readingsCallKey(null, 'WASH_IN')).toBeNull();
  });

  it('stageKey null: any group takes readings (Dry In temperature, Wash In asked by block)', () => {
    expect(readingsCallKey(bound(GC), null)).toBe('group:gc');
    expect(readingsCallKey(unbound(), null, [GA, GB])).toBe('choice:ga,gb');
  });
});

describe('splitByReadings', () => {
  it('a filter bound to ANOTHER group stays out, named with that group; the same group rides', () => {
    const r = splitByReadings([item(1), item(2), item(3)], of({ f1: bound(GA), f2: bound(GB), f3: bound(GA) }), 'WASH_IN');
    expect(r.ride.map((b) => b.filterId)).toEqual(['f1', 'f3']);
    expect(r.left).toEqual([{ item: item(2), note: 'its cleaning cycle records readings with Bay B' }]);
  });

  it('an unbound filter with a choice of its own does not ride on a bound group (it is never chosen for)', () => {
    const r = splitByReadings([item(1), item(2)], of({ f1: bound(GA), f2: unbound(GA, GB) }), 'WASH_IN');
    expect(r.ride).toEqual([item(1)]);
    expect(r.left[0].note).toBe('its equipment group must be chosen on its own');
  });

  it('a filter that takes readings does not ride on a batch that takes none (it would go without them)', () => {
    const r = splitByReadings([item(1), item(2)], of({ f1: bound(GC), f2: bound(GA) }), 'WASH_IN');
    expect(r.ride).toEqual([item(1)]);
    expect(r.left[0].note).toBe('its cleaning cycle records readings with Bay A');
  });

  it('an unknown state never takes the first filter\'s shape', () => {
    const r = splitByReadings([item(1), item(2)], of({ f1: bound(GA) }), 'WASH_IN');
    expect(r.ride).toEqual([item(1)]);
    expect(r.left[0].note).toMatch(/could not be read/);
  });

  it('a single-group block: an unbound cycle and one bound to that group ride together', () => {
    const r = splitByReadings([item(1), item(2)], of({ f1: unbound(GA), f2: bound(GA) }), 'WASH_IN');
    expect(r.ride).toHaveLength(2);
  });
});

describe('checklistSignature / largestGroup', () => {
  it('order-independent; the version counts', () => {
    expect(checklistSignature([{ checklistProfileId: 'b', profileVersion: 1 }, { checklistProfileId: 'a' }])).toBe('a@0|b@1');
    expect(checklistSignature([{ checklistProfileId: 'a', profileVersion: 2 }])).not.toBe(checklistSignature([{ checklistProfileId: 'a', profileVersion: 3 }]));
  });

  it('the largest group wins; a tie keeps the group seen first', () => {
    expect(largestGroup([{ key: 'x', item: 1 }, { key: 'y', item: 2 }, { key: 'y', item: 3 }])).toEqual({ key: 'y', items: [2, 3] });
    expect(largestGroup([{ key: 'x', item: 1 }, { key: 'y', item: 2 }])).toEqual({ key: 'x', items: [1] });
    expect(largestGroup([])).toBeNull();
  });
});

const CL = (id: string, v = 1) => ({ pipelineNodeId: `n-${id}`, checklistProfileId: id, checklistProfileName: id, profileVersion: v, questions: [] });
const atFinal = (clId: string | null, extra: Record<string, unknown> = {}) => ({
  stageLookup: { STORAGE_OUT: { nextStages: [], leadsToEnd: true, pendingChecklistProfileIds: clId ? [clId] : [], interlockGated: false, ...extra } },
  disabledChecklistProfileIds: [],
});

describe('planFinalStageBatch', () => {
  const resolveFrom = (m: Record<string, any[]>) => async (id: string) => m[id] ?? [];

  it('per filter: carry the checklist, a bare advance, or stay out for a different checklist', async () => {
    const p = await planFinalStageBatch(
      [item(1), item(2), item(3), item(4)],
      'STORAGE_OUT',
      of({ f1: atFinal('cl1'), f2: atFinal(null), f3: atFinal('cl2'), f4: atFinal('cl1') }),
      resolveFrom({ f1: [CL('cl1')], f3: [CL('cl2')], f4: [CL('cl1')] }),
    );
    expect(p.plain).toEqual([item(2)]);
    expect(p.carry).toEqual([item(1), item(4)]);
    expect(p.checklists).toEqual([CL('cl1')]);
    expect(p.left).toEqual([{ item: item(3), note: 'its profile asks a different checklist' }]);
  });

  it('the server\'s exceptions stay plain: a disabled checklist, a QA-interlock final stage, more stages after it', async () => {
    const p = await planFinalStageBatch(
      [item(1), item(2), item(3)],
      'STORAGE_OUT',
      of({
        f1: { ...atFinal('cl1'), disabledChecklistProfileIds: ['cl1'] },
        f2: atFinal('cl1', { interlockGated: true }),
        f3: atFinal('cl1', { leadsToEnd: false, nextStages: ['X'] }),
      }),
      async () => [CL('cl1')],
    );
    expect(p.plain).toHaveLength(3);
    expect(p.carry).toEqual([]);
  });

  it('a checklist that must ride but cannot be resolved goes plain (the server refuses it, shown) — never another\'s checklist', async () => {
    const p = await planFinalStageBatch([item(1)], 'STORAGE_OUT', of({ f1: atFinal('cl1') }), async () => []);
    expect(p).toMatchObject({ plain: [item(1)], carry: [], left: [] });
  });

  it('an unknown state stays out', async () => {
    const p = await planFinalStageBatch([item(1)], 'STORAGE_OUT', of({}), async () => []);
    expect(p.left[0].note).toMatch(/could not be read/);
  });
});

describe('planPendingChecklistBatch', () => {
  it('one dialog for the largest group waiting on the same checklist; another checklist, or none, stays out', async () => {
    const pending: Record<string, any[] | null> = { f1: [CL('a')], f2: [CL('b')], f3: [CL('b')], f4: null };
    const p = await planPendingChecklistBatch([item(1), item(2), item(3), item(4)], of({ f1: {}, f2: {}, f3: {}, f4: {} }), async (id) => pending[id]);
    expect(p.ride).toEqual([item(2), item(3)]);
    expect(p.checklists).toEqual([CL('b')]);
    expect(p.left).toEqual([
      { item: item(4), note: 'has no checklist waiting' },
      { item: item(1), note: 'is waiting on a different checklist' },
    ]);
  });
});

describe('splitNewCycleBatch', () => {
  it('a START only for filters with no cycle whose cleaning starts at this stage', () => {
    const firsts = (st: any) => st.firsts ?? [];
    const r = splitNewCycleBatch(
      [item(1), item(2), item(3), item(4)],
      of({ f1: { currentCycle: null, firsts: ['WASH_IN'] }, f2: { currentCycle: { id: 'c' } }, f3: { currentCycle: null, firsts: ['DRY_IN'] }, f4: { currentCycle: null } }),
      'WASH_IN',
      firsts,
    );
    expect(r.ride).toEqual([item(1), item(4)]);
    expect(r.left.map((l) => l.note)).toEqual(['is already in a cleaning cycle', 'its cleaning starts at DRY IN']);
  });
});

describe('splitUnread', () => {
  it('only a filter whose state could not be read stays out', () => {
    const r = splitUnread([item(1), item(2)], of({ f1: {} }));
    expect(r.ride).toEqual([item(1)]);
    expect(r.left[0]).toMatchObject({ item: item(2), note: expect.stringMatching(/could not be read/) });
  });
});

describe('leftInQueueMessage', () => {
  it('names each filter and why', () => {
    expect(leftInQueueMessage([])).toBe('');
    expect(leftInQueueMessage([{ item: item(2), note: 'why' }])).toBe('Left in the queue — submit separately:\nF-002: why');
  });
});
