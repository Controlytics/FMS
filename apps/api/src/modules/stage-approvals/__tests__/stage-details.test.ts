import { describe, it, expect } from 'vitest';
import { classifyEvent, deriveStageDetails, type StageEventLike } from '../stage-details.js';

const T = (iso: string) => new Date(iso);
const users: Record<string, string> = { u1: '101012', u2: '101014' };
const userName = (id: string | null) => (id ? users[id] ?? id.substring(0, 8) : null);

const ev = (over: Partial<StageEventLike> & { toState: string | null }): StageEventLike => ({
  eventType: 'STATE_TRANSITION',
  fromState: null,
  performedBy: 'u1',
  performedAt: T('2026-09-05T08:00:00Z'),
  attributes: {},
  ...over,
});

const ro = { instrumentId: 'i1', instrumentCode: 'RO-1', description: 'RO Water Pressure', value: 2.5, uom: 'bar', leastCount: 0.1 };
const air = { instrumentId: 'i2', instrumentCode: 'AIR-1', description: 'Compressed Air Pressure', value: 4, uom: 'bar', leastCount: 0.1 };
const temp = { instrumentId: 'i3', instrumentCode: 'DT-1', description: 'Dryer Temperature', value: 61, uom: '°C', leastCount: 1 };

const washCycle = [
  ev({ fromState: null, toState: 'WASH_IN', performedAt: T('2026-09-05T08:00:00Z'), attributes: { instrumentReadings: [ro, air] } }),
  ev({ fromState: 'WASH_IN', toState: 'WASH_OUT', performedAt: T('2026-09-05T08:30:00Z'), performedBy: 'u2' }),
];

describe('classifyEvent', () => {
  it('maps the plain stage transitions', () => {
    expect(classifyEvent(ev({ toState: 'WASH_IN' }))).toBe('WASH_IN');
    expect(classifyEvent(ev({ toState: 'WASH_OUT' }))).toBe('WASH_OUT');
    expect(classifyEvent(ev({ toState: 'DRY_OUT' }))).toBe('DRY_OUT');
    expect(classifyEvent(ev({ toState: 'STORAGE_IN' }))).toBeNull();
  });

  it('ignores non-transition events and interlock decisions (a reject is not a wash)', () => {
    expect(classifyEvent(ev({ eventType: 'APPROVAL_GRANTED', toState: null }))).toBeNull();
    expect(classifyEvent(ev({ fromState: 'WASH_OUT', toState: 'WASH_IN', attributes: { kind: 'STAGE_INTERLOCK_REJECTED' } }))).toBeNull();
  });

  it('splits the two DRY_IN rows: started by action or legacy duration, ended by action or readings', () => {
    expect(classifyEvent(ev({ fromState: 'WASH_OUT', toState: 'DRY_IN', attributes: { action: 'DRYER_STARTED', dryerDurationMinutes: 5 } }))).toBe('DRY_IN_STARTED');
    expect(classifyEvent(ev({ fromState: null, toState: 'DRY_IN', attributes: { dryerDurationMinutes: 5 } }))).toBe('DRY_IN_STARTED');
    expect(classifyEvent(ev({ fromState: null, toState: 'DRY_IN', attributes: { action: 'DRYER_READINGS_SUBMITTED', instrumentReadings: [temp] } }))).toBe('DRY_IN_ENDED');
    // 13 legacy rows: DRY_IN -> DRY_IN with readings and no action.
    expect(classifyEvent(ev({ fromState: 'DRY_IN', toState: 'DRY_IN', attributes: { instrumentReadings: [temp] } }))).toBe('DRY_IN_ENDED');
  });

  it('treats a plain WASH_OUT -> DRY_IN entry with readings as a stage move, not the dryer end', () => {
    expect(classifyEvent(ev({ fromState: 'WASH_OUT', toState: 'DRY_IN', attributes: { instrumentReadings: [temp] } }))).toBeNull();
    expect(classifyEvent(ev({ fromState: 'WASH_OUT', toState: 'DRY_IN' }))).toBeNull();
  });
});

describe('deriveStageDetails — WASH_OUT', () => {
  it('reports wash-in time/user/readings, the reason, and the wash-out time/user', () => {
    const d = deriveStageDetails({
      stageKey: 'WASH_OUT', requestedAt: T('2026-09-05T08:30:01Z'), requestedByName: '101014',
      cycle: { cleaningReasonLabel: 'Preventive Maintenance', dryerDurationMinutes: null, dryerStartedAt: null },
      events: washCycle, userName,
    });
    expect(d.cleaningReason).toBe('Preventive Maintenance');
    expect(d.washIn).toEqual({
      at: '2026-09-05T08:00:00.000Z', by: '101012',
      readings: [
        { description: 'RO Water Pressure', value: 2.5, uom: 'bar', leastCount: 0.1 },
        { description: 'Compressed Air Pressure', value: 4, uom: 'bar', leastCount: 0.1 },
      ],
    });
    expect(d.washOut).toEqual({ at: '2026-09-05T08:30:00.000Z', by: '101014', readings: [] });
    expect(d.dryIn).toBeUndefined();
    expect(d.dryOut).toBeUndefined();
  });

  it('falls back to the request itself for Wash Out when the event is missing', () => {
    const d = deriveStageDetails({
      stageKey: 'WASH_OUT', requestedAt: T('2026-09-05T08:30:01Z'), requestedByName: '101014',
      cycle: null, events: [washCycle[0]], userName,
    });
    expect(d.washOut).toEqual({ at: '2026-09-05T08:30:01.000Z', by: '101014', readings: [] });
    expect(d.cleaningReason).toBeNull();
  });

  it('uses the 8-char uuid prefix for a deleted performer', () => {
    const d = deriveStageDetails({
      stageKey: 'WASH_OUT', requestedAt: T('2026-09-05T08:30:01Z'), requestedByName: null,
      cycle: null,
      events: [ev({ toState: 'WASH_IN', performedBy: 'deadbeef-0000-4000-8000-000000000000' })],
      userName,
    });
    expect(d.washIn?.by).toBe('deadbeef');
  });

  it('on a reject-and-redo cycle, each attempt describes ITS OWN wash', () => {
    const redo = [
      ...washCycle,
      ev({ fromState: 'WASH_OUT', toState: 'WASH_IN', performedAt: T('2026-09-05T09:00:00Z'), performedBy: 'u2', attributes: { kind: 'STAGE_INTERLOCK_REJECTED' } }),
      ev({ fromState: 'WASH_IN', toState: 'WASH_IN', performedAt: T('2026-09-05T09:10:00Z'), attributes: { instrumentReadings: [{ ...ro, value: 3.1 }, air] } }),
      ev({ fromState: 'WASH_IN', toState: 'WASH_OUT', performedAt: T('2026-09-05T09:40:00Z') }),
    ];
    const first = deriveStageDetails({ stageKey: 'WASH_OUT', requestedAt: T('2026-09-05T08:30:01Z'), requestedByName: null, cycle: null, events: redo, userName });
    const second = deriveStageDetails({ stageKey: 'WASH_OUT', requestedAt: T('2026-09-05T09:40:01Z'), requestedByName: null, cycle: null, events: redo, userName });
    expect(first.washIn?.readings[0].value).toBe(2.5);
    expect(first.washOut?.at).toBe('2026-09-05T08:30:00.000Z');
    expect(second.washIn?.readings[0].value).toBe(3.1);
    expect(second.washIn?.at).toBe('2026-09-05T09:10:00.000Z');
    expect(second.washOut?.at).toBe('2026-09-05T09:40:00.000Z');
  });

  it('falls back to the latest event overall when nothing precedes the request time', () => {
    const d = deriveStageDetails({
      stageKey: 'WASH_OUT', requestedAt: T('2026-09-05T07:00:00Z'), requestedByName: null, cycle: null, events: washCycle, userName,
    });
    expect(d.washIn?.at).toBe('2026-09-05T08:00:00.000Z');
  });
});

describe('deriveStageDetails — DRY_OUT', () => {
  const dryCycle = [
    ...washCycle,
    ev({ fromState: 'WASH_OUT', toState: 'DRY_IN', performedAt: T('2026-09-05T10:00:00Z'), attributes: { action: 'DRYER_STARTED', dryerDurationMinutes: 5, dryerStartedAt: '2026-09-05T09:59:58.000Z' } }),
    ev({ fromState: null, toState: 'DRY_IN', performedAt: T('2026-09-05T10:03:00Z'), performedBy: 'u2', attributes: { action: 'DRYER_READINGS_SUBMITTED', instrumentReadings: [temp] } }),
    ev({ fromState: 'DRY_IN', toState: 'DRY_OUT', performedAt: T('2026-09-05T10:06:00Z'), performedBy: 'u2' }),
  ];

  it('reports dryer start (the started event\'s performedAt, not the attribute copy), duration, temperature, end and dry-out', () => {
    const d = deriveStageDetails({
      stageKey: 'DRY_OUT', requestedAt: T('2026-09-05T10:06:01Z'), requestedByName: '101014',
      cycle: { cleaningReasonLabel: 'Breakdown', dryerDurationMinutes: 5, dryerStartedAt: T('2026-09-05T09:59:58Z') },
      events: dryCycle, userName,
    });
    expect(d.cleaningReason).toBe('Breakdown');
    expect(d.dryIn).toEqual({
      startedAt: '2026-09-05T10:00:00.000Z', startedBy: '101012', durationMinutes: 5,
      endedAt: '2026-09-05T10:03:00.000Z', endedBy: '101014',
      readings: [{ description: 'Dryer Temperature', value: 61, uom: '°C', leastCount: 1 }],
    });
    expect(d.dryOut).toEqual({ at: '2026-09-05T10:06:00.000Z', by: '101014', readings: [] });
    expect(d.washIn).toBeUndefined();
  });

  it('uses the attribute copy only when neither the event nor the cycle row has a start', () => {
    const d = deriveStageDetails({
      stageKey: 'DRY_OUT', requestedAt: T('2026-09-05T10:06:01Z'), requestedByName: null,
      cycle: null,
      events: [ev({ fromState: 'WASH_OUT', toState: 'DRY_IN', performedAt: 'not-a-date', attributes: { action: 'DRYER_STARTED', dryerDurationMinutes: 5, dryerStartedAt: '2026-09-05T09:59:58.000Z' } })],
      userName,
    });
    expect(d.dryIn?.startedAt).toBe('2026-09-05T09:59:58.000Z');
  });

  it('falls back to the cycle row for duration/start when the started event is missing', () => {
    const d = deriveStageDetails({
      stageKey: 'DRY_OUT', requestedAt: T('2026-09-05T10:06:01Z'), requestedByName: '101014',
      cycle: { cleaningReasonLabel: null, dryerDurationMinutes: 10, dryerStartedAt: T('2026-09-05T09:50:00Z') },
      events: [dryCycle[3], dryCycle[4]], userName,
    });
    expect(d.dryIn?.durationMinutes).toBe(10);
    expect(d.dryIn?.startedAt).toBe('2026-09-05T09:50:00.000Z');
    expect(d.dryIn?.startedBy).toBeNull();
  });

  it('a redo after a DRY_OUT reject describes the second dryer run', () => {
    const redo = [
      ...dryCycle,
      ev({ fromState: 'DRY_OUT', toState: 'DRY_IN', performedAt: T('2026-09-05T10:10:00Z'), performedBy: 'u2', attributes: { kind: 'STAGE_INTERLOCK_REJECTED' } }),
      ev({ fromState: null, toState: 'DRY_IN', performedAt: T('2026-09-05T10:15:00Z'), attributes: { action: 'DRYER_STARTED', dryerDurationMinutes: 15, dryerStartedAt: '2026-09-05T10:15:00.000Z' } }),
      ev({ fromState: null, toState: 'DRY_IN', performedAt: T('2026-09-05T10:23:00Z'), attributes: { action: 'DRYER_READINGS_SUBMITTED', instrumentReadings: [{ ...temp, value: 70 }] } }),
      ev({ fromState: 'DRY_IN', toState: 'DRY_OUT', performedAt: T('2026-09-05T10:31:00Z') }),
    ];
    const second = deriveStageDetails({
      stageKey: 'DRY_OUT', requestedAt: T('2026-09-05T10:31:01Z'), requestedByName: null,
      cycle: { cleaningReasonLabel: null, dryerDurationMinutes: 15, dryerStartedAt: T('2026-09-05T10:15:00Z') },
      events: redo, userName,
    });
    expect(second.dryIn?.durationMinutes).toBe(15);
    expect(second.dryIn?.readings[0].value).toBe(70);
    expect(second.dryOut?.at).toBe('2026-09-05T10:31:00.000Z');
    const first = deriveStageDetails({ stageKey: 'DRY_OUT', requestedAt: T('2026-09-05T10:06:01Z'), requestedByName: null, cycle: null, events: redo, userName });
    expect(first.dryIn?.durationMinutes).toBe(5);
    expect(first.dryIn?.readings[0].value).toBe(61);
  });

  it('a mid-dryer request (no temperature yet) leaves the ended fields empty rather than borrowing the start', () => {
    const d = deriveStageDetails({
      stageKey: 'DRY_OUT', requestedAt: T('2026-09-05T10:06:01Z'), requestedByName: null,
      cycle: null, events: [dryCycle[2], dryCycle[4]], userName,
    });
    expect(d.dryIn?.endedAt).toBeNull();
    expect(d.dryIn?.readings).toEqual([]);
  });
});

describe('deriveStageDetails — other stages', () => {
  it('returns only the reason for a stage that is not an interlock point', () => {
    const d = deriveStageDetails({ stageKey: 'STORAGE_IN', requestedAt: null, requestedByName: null, cycle: { cleaningReasonLabel: 'PM', dryerDurationMinutes: null, dryerStartedAt: null }, events: [], userName });
    expect(d).toEqual({ cleaningReason: 'PM' });
  });
});
