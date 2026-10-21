import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useNowTick, buildTempOptionsSnapped, buildTempOptionsLinear, findDryerTempInstrument, projectDryerCountdown,
} from '../use-dryer-countdown';
// The barrel re-exports the same functions the two filter-operations pages import.
import * as barrel from '../index';

afterEach(() => { vi.useRealTimers(); });

describe('filter-ops barrel', () => {
  it('re-exports the shared dryer + gate helpers (both pages import from here)', () => {
    expect(barrel.projectDryerCountdown).toBe(projectDryerCountdown);
    expect(barrel.buildTempOptionsSnapped).toBe(buildTempOptionsSnapped);
    expect(typeof barrel.validateOfflineGate).toBe('function');
    expect(typeof barrel.firstStagesFromGraph).toBe('function');
    expect(typeof barrel.resolvePendingChecklistDialog).toBe('function');
    expect(typeof barrel.resolveChecklistForTargetStage).toBe('function');
    expect(typeof barrel.findNextPendingChecklist).toBe('function');
    expect(barrel.useNowTick).toBe(useNowTick);
    expect(barrel.buildTempOptionsLinear).toBe(buildTempOptionsLinear);
    expect(barrel.findDryerTempInstrument).toBe(findDryerTempInstrument);
  });
});

describe('useNowTick', () => {
  it('ticks once a second and stops its interval on unmount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T08:00:00.000Z'));
    const { result, unmount } = renderHook(() => useNowTick());
    const t0 = result.current;
    expect(t0).toBe(Date.parse('2026-10-21T08:00:00.000Z'));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(t0 + 1000);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current).toBe(t0 + 4000);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('buildTempOptionsSnapped (desktop)', () => {
  it.each([
    ['whole steps', 60, 63, 1, [60, 61, 62, 63]],
    ['half steps', 60, 62, 0.5, [60, 60.5, 61, 61.5, 62]],
    ['snaps the first value up to a least-count multiple', 60.3, 61.5, 0.5, [60.5, 61, 61.5]],
    ['no float drift at 0.1', 0, 0.3, 0.1, [0, 0.1, 0.2, 0.3]],
    ['max inside the first step', 60.2, 60.4, 1, []],
  ])('%s', (_l, min, max, step, expected) => {
    expect(buildTempOptionsSnapped(min, max, step)).toEqual(expected);
  });

  it.each([[0], [-1], [Number.NaN]])('a non-positive or invalid step (%s) yields no options', (step) => {
    expect(buildTempOptionsSnapped(0, 10, step)).toEqual([]);
  });

  it('an empty or inverted range yields no options', () => {
    expect(buildTempOptionsSnapped(10, 10, 1)).toEqual([]);
    expect(buildTempOptionsSnapped(10, 5, 1)).toEqual([]);
  });

  it('stops after 501 options (safety cap) on a huge range', () => {
    const opts = buildTempOptionsSnapped(0, 1_000_000, 1);
    expect(opts).toHaveLength(501);
    expect(opts[500]).toBe(500);
  });
});

describe('buildTempOptionsLinear (tablet)', () => {
  it.each([
    ['half steps from min', 60, 61, 0.5, [60, 60.5, 61]],
    ['does not snap a fractional min', 60.3, 61.3, 0.5, [60.3, 60.8, 61.3]],
    ['rounds each step to 2 decimals', 0, 0.03, 0.01, [0, 0.01, 0.02, 0.03]],
    ['a zero step falls back to 1', 1, 3, 0, [1, 2, 3]],
    ['a negative step falls back to 1', 1, 2, -5, [1, 2]],
    ['an inverted range yields nothing', 5, 1, 1, []],
  ])('%s', (_l, min, max, step, expected) => {
    expect(buildTempOptionsLinear(min, max, step)).toEqual(expected);
  });

  it('caps at 10,000 options', () => {
    expect(buildTempOptionsLinear(0, 1e9, 1)).toHaveLength(10000);
  });
});

describe('findDryerTempInstrument', () => {
  const temp = { stageKey: 'DRY_IN', description: 'Dryer Temperature' };
  it('finds the DRY_IN instrument whose description mentions temp (any case)', () => {
    expect(findDryerTempInstrument({ instruments: [{ stageKey: 'WASH_IN', description: 'temp' }, { stageKey: 'DRY_IN', description: 'Timer' }, temp] })).toBe(temp);
    const upper = { stageKey: 'DRY_IN', description: 'TEMP PROBE' };
    expect(findDryerTempInstrument({ instruments: [upper] })).toBe(upper);
  });

  it.each([
    ['no group', null],
    ['group without instruments', {}],
    ['no DRY_IN temperature instrument', { instruments: [{ stageKey: 'WASH_IN', description: 'Water temp' }] }],
    ['DRY_IN instrument with no description', { instruments: [{ stageKey: 'DRY_IN' }] }],
  ])('returns null for %s', (_l, group) => {
    expect(findDryerTempInstrument(group)).toBeNull();
  });
});

describe('projectDryerCountdown', () => {
  const start = Date.parse('2026-10-21T08:00:00.000Z');

  it('a cycle with no dryer started projects zeros and is not half-way', () => {
    for (const cycle of [null, undefined, {}, { dryerDurationMinutes: 60 }]) {
      const p = projectDryerCountdown(cycle, start);
      expect(p.startedAt).toBeNull();
      expect(p.elapsedMs).toBe(0);
      expect(p.halfReached).toBe(false);
      expect(p.progressPct).toBe(0);
    }
    expect(projectDryerCountdown(null, start).durationMin).toBeNull();
  });

  it('ten minutes into a 60-minute cycle: 20 minutes to the reading gate', () => {
    const p = projectDryerCountdown({ dryerStartedAt: '2026-10-21T08:00:00.000Z', dryerDurationMinutes: 60 }, start + 10 * 60_000);
    expect(p).toEqual({
      startedAt: start, durationMin: 60, halfMs: 1_800_000, totalMs: 3_600_000, elapsedMs: 600_000,
      halfReached: false, remainingToHalfMin: 20, remainingSec: 1200, remainingMin: 20, remainingSecPart: 0,
      progressPct: (600_000 / 3_600_000) * 100,
    });
  });

  it('rounds the remaining time UP and splits it into minutes and seconds', () => {
    const p = projectDryerCountdown({ dryerStartedAt: new Date(start), dryerDurationMinutes: 10 }, start + 61_500);
    // half = 300 s; remaining = 238.5 s -> 239 s = 3 min 59 s; 4 whole minutes to the gate.
    expect(p.remainingSec).toBe(239);
    expect(p.remainingMin).toBe(3);
    expect(p.remainingSecPart).toBe(59);
    expect(p.remainingToHalfMin).toBe(4);
  });

  it('exactly at half-time the reading gate opens', () => {
    const p = projectDryerCountdown({ dryerStartedAt: new Date(start), dryerDurationMinutes: 60 }, start + 1_800_000);
    expect(p.halfReached).toBe(true);
    expect(p.remainingToHalfMin).toBe(0);
    expect(p.remainingSec).toBe(0);
  });

  it('progress is capped at 100% after the full duration', () => {
    const p = projectDryerCountdown({ dryerStartedAt: new Date(start), dryerDurationMinutes: 30 }, start + 5 * 3_600_000);
    expect(p.progressPct).toBe(100);
    expect(p.halfReached).toBe(true);
  });

  it('a started dryer with no duration has an open gate and no progress', () => {
    const p = projectDryerCountdown({ dryerStartedAt: new Date(start), dryerDurationMinutes: null }, start + 1000);
    expect(p.halfMs).toBe(0);
    expect(p.halfReached).toBe(true);
    expect(p.progressPct).toBe(0);
  });
});
