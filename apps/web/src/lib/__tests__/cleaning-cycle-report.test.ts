import { describe, it, expect } from 'vitest';
import type { FilterEvent } from '../../types/filter';
import {
  getStageInfo, getReading, fmtMinutes, getDryerStart, effectiveCycleStatus,
  cycleEndInfo, stageCellText, phaseSuffix, stageProgress, maxReachedStageIndex, transitionEndpoints,
} from '../cleaning-cycle-report';

/**
 * The value helpers behind the Filter Cleaning Record (screen, PDF and Excel)
 * and the cycle-detail views. Stage-cell precedence, stage progress, column
 * keys and the DRY_IN endpoints have their own suites; this one covers the
 * rest: who/when per stage, readings, dryer start, end-of-cycle labels.
 */

const ev = (o: Partial<FilterEvent>): FilterEvent => ({
  id: o.id ?? 'e', filterId: 'f1', eventType: 'STATE_TRANSITION',
  performedBy: 'aaaaaaaa-bbbb-cccc', performedAt: '2026-10-01T10:00:00Z', ...o,
});

describe('getStageInfo', () => {
  it('returns null when the stage was never entered (and tolerates a null event list)', () => {
    expect(getStageInfo([ev({ toState: 'WASH_IN' })], 'DRY_OUT')).toBeNull();
    expect(getStageInfo(null as unknown as FilterEvent[], 'WASH_IN')).toBeNull();
  });

  it('ignores non-transition events for the same stage', () => {
    expect(getStageInfo([ev({ eventType: 'CHECKLIST_SUBMITTED', toState: 'WASH_IN' })], 'WASH_IN')).toBeNull();
  });

  it('prefers the readings-bearing transition and reports its readings', () => {
    const readings = [{ description: 'RO Water Pressure', value: 2, uom: 'bar' }];
    const info = getStageInfo([
      ev({ id: 'plain', toState: 'WASH_IN', performedAt: 't1', performedByName: 'first' }),
      ev({ id: 'withR', toState: 'WASH_IN', performedAt: 't2', performedByName: 'second', attributes: { instrumentReadings: readings } }),
    ], 'WASH_IN');
    expect(info).toEqual({ time: 't2', performedBy: 'second', readings, manual: false });
  });

  it('falls back to the first transition for a non-DRY_IN stage and to the uuid prefix for a deleted user', () => {
    const info = getStageInfo([ev({ toState: 'WASH_OUT', performedAt: 't9', performedByName: undefined })], 'WASH_OUT');
    expect(info).toEqual({ time: 't9', performedBy: 'aaaaaaaa', readings: [], manual: false });
  });

  it('prints "-" when neither a name nor a performer id exists', () => {
    const info = getStageInfo([ev({ toState: 'WASH_OUT', performedBy: undefined as unknown as string })], 'WASH_OUT');
    expect(info!.performedBy).toBe('-');
  });

  it('DRY_IN needs the readings event: the SET_DURATION transition alone leaves the column blank', () => {
    expect(getStageInfo([ev({ toState: 'DRY_IN', attributes: { action: 'DRYER_STARTED' } })], 'DRY_IN')).toBeNull();
  });

  it('DRY_IN falls back to a MANUAL stage change (which carries no readings) and flags it', () => {
    const info = getStageInfo([
      ev({ toState: 'DRY_IN', attributes: { action: 'DRYER_STARTED' } }),
      ev({ toState: 'DRY_IN', performedAt: 'tm', attributes: { manual: true } }),
    ], 'DRY_IN');
    expect(info).toMatchObject({ time: 'tm', manual: true, readings: [] });
  });

  it('an empty readings array does not count as a readings event', () => {
    expect(getStageInfo([ev({ toState: 'DRY_IN', attributes: { instrumentReadings: [] } })], 'DRY_IN')).toBeNull();
  });
});

describe('getReading', () => {
  const readings = [
    { description: 'RO Water Pressure', value: 2.5, uom: 'bar', leastCount: 0.1 },
    { description: 'Compressed Air Pressure', value: 6, uom: 'kg/cm2', leastCount: 1 },
    { description: 'Dryer Temperature', value: 45.678 },
    { description: 'Counter', value: 3, uom: null, leastCount: null },
  ];

  it('matches by case-insensitive description substring and appends the UOM', () => {
    expect(getReading(readings, 'ro water')).toBe('2.5 bar');
    expect(getReading(readings, 'AIR')).toBe('6 kg/cm2');
  });

  it('formats to the instrument least count when one is recorded', () => {
    expect(getReading([{ description: 'x', value: 2, leastCount: 0.01, uom: 'C' }], 'x')).toBe('2.00 C');
  });

  it('prints the raw value with no trailing space when there is no least count or UOM', () => {
    expect(getReading(readings, 'dryer')).toBe('45.678');
    expect(getReading(readings, 'counter')).toBe('3');
  });

  it('"-" when the reading is missing or the list is empty/null', () => {
    expect(getReading(readings, 'humidity')).toBe('-');
    expect(getReading([], 'x')).toBe('-');
    expect(getReading(null as unknown as any[], 'x')).toBe('-');
    expect(getReading([{ value: 1 }], 'x')).toBe('-'); // no description at all
  });
});

describe('fmtMinutes', () => {
  it.each([
    [null, null], [undefined, null], [0, '0m'], [45, '45m'], [59.6, '1h'],
    [60, '1h'], [90, '1h 30m'], [120, '2h'], [125.4, '2h 5m'],
  ])('%s -> %s', (input, out) => {
    expect(fmtMinutes(input as number | null | undefined)).toBe(out);
  });
});

describe('getDryerStart', () => {
  it('uses the cycle row when both columns are set (no event lookup)', () => {
    expect(getDryerStart({ dryerDurationMinutes: 30, dryerStartedAt: 'T0' }, [])).toEqual({ minutes: 30, time: 'T0' });
  });

  it('falls back to the DRYER_STARTED DRY_IN event for legacy cycles', () => {
    const events = [
      ev({ toState: 'WASH_OUT' }),
      ev({ toState: 'DRY_IN', performedAt: 'PA', attributes: { action: 'DRYER_STARTED', dryerDurationMinutes: 45, dryerStartedAt: 'DS' } }),
    ];
    expect(getDryerStart({}, events)).toEqual({ minutes: 45, time: 'DS' });
  });

  it('accepts a legacy event that has only dryerDurationMinutes, timing it by performedAt', () => {
    const events = [ev({ toState: 'DRY_IN', performedAt: 'PA', attributes: { dryerDurationMinutes: 20 } })];
    expect(getDryerStart(null, events)).toEqual({ minutes: 20, time: 'PA' });
  });

  it('fills only the missing half from the event', () => {
    const events = [ev({ toState: 'DRY_IN', performedAt: 'PA', attributes: { action: 'DRYER_STARTED', dryerDurationMinutes: 99 } })];
    expect(getDryerStart({ dryerDurationMinutes: 30 }, events)).toEqual({ minutes: 30, time: 'PA' });
    expect(getDryerStart({ dryerStartedAt: 'CYC' }, events)).toEqual({ minutes: 99, time: 'CYC' });
  });

  it('nulls when nothing records the dryer (a readings-only DRY_IN is not a start)', () => {
    const events = [ev({ toState: 'DRY_IN', attributes: { instrumentReadings: [{ value: 1 }] } })];
    expect(getDryerStart({}, events)).toEqual({ minutes: null, time: null });
    expect(getDryerStart(undefined, null as unknown as FilterEvent[])).toEqual({ minutes: null, time: null });
  });

  it('an event with the start action but no duration yields minutes null', () => {
    const events = [ev({ toState: 'DRY_IN', performedAt: 'PA', attributes: { action: 'DRYER_STARTED' } })];
    expect(getDryerStart({}, events)).toEqual({ minutes: null, time: 'PA' });
  });
});

describe('effectiveCycleStatus', () => {
  it.each([
    [{ status: 'TERMINATED', terminationReason: 'RETIRED' }, 'RETIRED'],
    [{ status: 'TERMINATED', terminationReason: 'REPLACED' }, 'REPLACED'],
    [{ status: 'TERMINATED', terminationReason: 'OPERATOR' }, 'TERMINATED'],
    [{ status: 'TERMINATED' }, 'TERMINATED'],
    [{ status: 'COMPLETED', terminationReason: 'RETIRED' }, 'COMPLETED'],
    [{ status: 'IN_PROGRESS' }, 'IN_PROGRESS'],
  ])('%o -> %s', (cycle, out) => {
    expect(effectiveCycleStatus(cycle)).toBe(out);
  });

  it('is undefined for a missing cycle rather than throwing', () => {
    expect(effectiveCycleStatus(null)).toBeUndefined();
  });
});

describe('cycleEndInfo', () => {
  const fmt = (s: string) => `F(${s})`;

  it('COMPLETED: "Completed by" names the LAST-STAGE operator, not whoever closed it', () => {
    const out = cycleEndInfo({
      status: 'COMPLETED', completedAt: 'C', completedByUsername: 'admin', lastStageByUsername: 'op7',
    }, fmt);
    expect(out).toEqual({ endLabel: 'Cycle Completed time', byLabel: 'Completed by', endTimeText: 'F(C)', by: 'op7' });
  });

  it('COMPLETED with no stage transitions falls back to the closer; deleted users show a uuid prefix', () => {
    expect(cycleEndInfo({ status: 'COMPLETED', completedAt: 'C', completedByUsername: 'closer' }, fmt).by).toBe('closer');
    expect(cycleEndInfo({ status: 'COMPLETED', completedAt: 'C', lastStageBy: '12345678-aaaa' }, fmt).by).toBe('12345678');
    expect(cycleEndInfo({ status: 'COMPLETED', completedAt: 'C', completedBy: '87654321-bbbb' }, fmt).by).toBe('87654321');
  });

  it('TERMINATED keeps the TERMINATOR and uses terminatedAt, falling back to completedAt', () => {
    const t = cycleEndInfo({
      status: 'TERMINATED', terminatedAt: 'T', completedAt: 'C', completedByUsername: 'mgr', lastStageByUsername: 'op7',
    }, fmt);
    expect(t).toEqual({ endLabel: 'Cycle Terminated time', byLabel: 'Terminated by', endTimeText: 'F(T)', by: 'mgr' });
    expect(cycleEndInfo({ status: 'TERMINATED', completedAt: 'C' }, fmt).endTimeText).toBe('F(C)');
  });

  it('an ended cycle with no terminator recorded uses the replace / retire audit fallback', () => {
    const fb = { replacedBy: 'repl-op', retiredBy: 'ret-op' };
    expect(cycleEndInfo({ status: 'TERMINATED', terminationReason: 'REPLACED' }, fmt, fb).by).toBe('repl-op');
    expect(cycleEndInfo({ status: 'TERMINATED', terminationReason: 'RETIRED' }, fmt, fb).by).toBe('ret-op');
    // A plain termination has no audit fallback.
    expect(cycleEndInfo({ status: 'TERMINATED' }, fmt, fb).by).toBeNull();
    // Fallback present but empty -> null, never undefined.
    expect(cycleEndInfo({ status: 'TERMINATED', terminationReason: 'REPLACED' }, fmt, {}).by).toBeNull();
    expect(cycleEndInfo({ status: 'TERMINATED', terminationReason: 'RETIRED' }, fmt, {}).by).toBeNull();
  });

  it('the fallback never overrides a recorded terminator', () => {
    const out = cycleEndInfo({ status: 'TERMINATED', terminationReason: 'REPLACED', completedByUsername: 'mgr' }, fmt, { replacedBy: 'x' });
    expect(out.by).toBe('mgr');
  });

  it('IN_PROGRESS shows the completed labels with an em-dash time and no operator', () => {
    expect(cycleEndInfo({ status: 'IN_PROGRESS' }, fmt)).toEqual({
      endLabel: 'Cycle Completed time', byLabel: 'Completed by', endTimeText: '—', by: null,
    });
  });

  it('ignores non-string performer fields', () => {
    expect(cycleEndInfo({ status: 'COMPLETED', completedAt: 'C', lastStageByUsername: 5, completedBy: 7 }, fmt).by).toBeNull();
  });
});

describe('stageCellText / phaseSuffix', () => {
  it('renders every stage-cell kind as the export text', () => {
    expect(stageCellText({ kind: 'value', value: '10:05', manual: false })).toBe('10:05');
    expect(stageCellText({ kind: 'na' })).toBe('NA');
    expect(stageCellText({ kind: 'terminal', label: 'Retired' })).toBe('Retired');
    expect(stageCellText({ kind: 'skipped' })).toBe('Skipped');
    expect(stageCellText({ kind: 'pending' })).toBe('Pending');
  });

  it('suffixes only a dryer phase', () => {
    expect(phaseSuffix('started')).toBe(' (Started)');
    expect(phaseSuffix('ended')).toBe(' (Ended)');
    expect(phaseSuffix(null)).toBe('');
  });
});

describe('null-tolerant inputs', () => {
  it('maxReachedStageIndex treats a null event list or profile as "nothing reached"', () => {
    expect(maxReachedStageIndex(null as unknown as any[], ['WASH_IN'])).toBe(-1);
    expect(maxReachedStageIndex([{ eventType: 'STATE_TRANSITION', toState: 'WASH_IN' }], null as unknown as string[])).toBe(-1);
  });

  it('transitionEndpoints: a DRY_IN entry with no attributes at all is a plain transition', () => {
    expect(transitionEndpoints({ eventType: 'STATE_TRANSITION', fromState: 'WASH_OUT', toState: 'DRY_IN' }))
      .toEqual({ from: 'WASH_OUT', to: 'DRY_IN', phase: null });
  });
});

describe('stageProgress — edge inputs', () => {
  it('tolerates a null event list', () => {
    const { reached, current } = stageProgress(null as unknown as any[], [], 'IN_PROGRESS');
    expect(reached.size).toBe(0);
    expect(current).toBeNull();
  });

  it('no current stage once every remaining profile stage is reached', () => {
    const events = ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT'].map((s) => ({ eventType: 'STATE_TRANSITION', toState: s }));
    expect(stageProgress(events, [], 'IN_PROGRESS').current).toBeNull();
  });
});
