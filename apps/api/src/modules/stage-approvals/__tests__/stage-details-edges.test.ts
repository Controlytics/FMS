/**
 * stage-details.ts over malformed / legacy event shapes (coverage suite,
 * 2026-10-21). The readings an approver signs against are read out of
 * free-form `filter_events.attributes`; rows written by older releases or
 * corrected by hand carry numbers as strings, an instrument code instead of a
 * description, or no attributes object at all. Each must still render, and
 * never invent a value. Pure derivation, plus the DB layer's empty / unbound
 * inputs (no rows written).
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { deriveStageDetails, classifyEvent, collectStageDetails, type StageEventLike } from '../stage-details.js';

const names = (id: string | null) => (id ? `u-${id}` : null);
const ev = (toState: string, at: string, attributes: unknown, fromState: string | null = 'X'): StageEventLike =>
  ({ eventType: 'STATE_TRANSITION', fromState, toState, performedBy: 'op', performedAt: at, attributes });

describe('readings over loose attribute shapes', () => {
  it('falls back to the instrument code, parses numeric strings, and drops what is not a number or a string', () => {
    const d = deriveStageDetails({
      stageKey: 'WASH_OUT', requestedAt: '2026-10-01T10:00:00Z', requestedByName: 'req', cycle: null, userName: names,
      events: [
        ev('WASH_IN', '2026-10-01T09:00:00Z', {
          instrumentReadings: [
            { instrumentCode: 'RO-1', value: '12.5', uom: 3, leastCount: '0.1', outOfRange: true },
            { value: 'abc' },
          ],
        }),
        ev('WASH_OUT', '2026-10-01T09:30:00Z', { instrumentReadings: 'not-a-list' }),
      ],
    });
    expect(d.washIn!.readings).toEqual([
      { description: 'RO-1', value: 12.5, uom: null, leastCount: null, outOfRange: true },
      { description: null, value: null, uom: null, leastCount: null },
    ]);
    expect(d.washOut).toEqual({ at: '2026-10-01T09:30:00.000Z', by: 'u-op', readings: [] });
    expect(d.cleaningReason).toBeNull();
  });

  it('an attributes value that is an array or null is treated as empty', () => {
    expect(classifyEvent(ev('DRY_IN', '2026-10-01T09:00:00Z', ['DRYER_STARTED']))).toBeNull();
    expect(classifyEvent(ev('DRY_IN', '2026-10-01T09:00:00Z', null))).toBeNull();
  });

  it('with no request time the latest event of each kind is used; an unparseable time sorts first', () => {
    const d = deriveStageDetails({
      stageKey: 'WASH_OUT', requestedAt: null, requestedByName: 'req', cycle: { cleaningReasonLabel: 'PM', dryerDurationMinutes: null, dryerStartedAt: null }, userName: names,
      events: [
        { ...ev('WASH_IN', 'not-a-date', {}), performedBy: 'old' },
        { ...ev('WASH_IN', '2026-10-01T09:00:00Z', {}), performedBy: 'new' },
      ],
    });
    expect(d.washIn!.by).toBe('u-new');
    // No Wash Out event and no request time: the card falls back to the requester, with no time.
    expect(d.washOut).toEqual({ at: null, by: 'req', readings: [] });
    expect(d.cleaningReason).toBe('PM');
  });

  it('a Dry Out request with no dryer events at all reports empty dryer facts', () => {
    const d = deriveStageDetails({
      stageKey: 'DRY_OUT', requestedAt: '2026-10-01T10:00:00Z', requestedByName: 'req', cycle: null, userName: names, events: [],
    });
    expect(d.dryIn).toEqual({ startedAt: null, startedBy: null, durationMinutes: null, endedAt: null, endedBy: null, readings: [] });
    expect(d.dryOut).toEqual({ at: '2026-10-01T10:00:00.000Z', by: 'req', readings: [] });
  });
});

describe('collectStageDetails (DB layer) with nothing to look up', () => {
  it('no rows → an empty map, without querying', async () => {
    expect((await collectStageDetails([])).size).toBe(0);
  });

  it('a row with no cycle, or a cycle that no longer exists, still gets details (reason null)', async () => {
    const a = randomUUID(); const b = randomUUID();
    const out = await collectStageDetails([
      { id: a, cycleId: null, stageKey: 'WASH_OUT', requestedAt: new Date('2026-10-01T10:00:00Z'), requestedByName: 'req' },
      { id: b, cycleId: randomUUID(), stageKey: 'DRY_OUT', requestedAt: new Date('2026-10-01T10:00:00Z'), requestedByName: 'req' },
    ]);
    expect(out.get(a)).toMatchObject({ cleaningReason: null, washOut: { by: 'req', readings: [] } });
    expect(out.get(b)).toMatchObject({ cleaningReason: null, dryOut: { by: 'req' } });
  });
});
