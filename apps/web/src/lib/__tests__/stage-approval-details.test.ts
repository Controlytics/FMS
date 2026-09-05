import { describe, it, expect } from 'vitest';
import { stageDetailGroups, formatReading, type StageDetails } from '../stage-approval';

const fmt = (iso: string) => `T(${iso})`;

describe('formatReading', () => {
  it('uses the least count and unit, flags out-of-range', () => {
    expect(formatReading({ description: 'RO', value: 2.5, uom: 'bar', leastCount: 0.1 })).toBe('2.5 bar');
    expect(formatReading({ description: 'RO', value: 2, uom: 'bar', leastCount: 0.01 })).toBe('2.00 bar');
    expect(formatReading({ description: 'T', value: 61, uom: null, leastCount: null, outOfRange: true })).toBe('61 (out of range)');
    expect(formatReading({ description: 'T', value: null, uom: '°C', leastCount: 1 })).toBe('—');
  });
});

describe('stageDetailGroups — WASH_OUT', () => {
  const d: StageDetails = {
    cleaningReason: 'Preventive Maintenance',
    washIn: {
      at: '2026-09-05T08:00:00.000Z', by: '101012',
      readings: [
        { description: 'RO Water Pressure', value: 2.5, uom: 'bar', leastCount: 0.1 },
        { description: 'Compressed Air Pressure', value: 4, uom: 'bar', leastCount: 0.1 },
      ],
    },
    washOut: { at: '2026-09-05T08:30:00.000Z', by: '101014', readings: [] },
  };

  it('renders Wash In (time, each reading, reason, user) then Wash Out (time, user)', () => {
    const g = stageDetailGroups('WASH_OUT', d, fmt);
    expect(g.map((x) => x.title)).toEqual(['Wash In', 'Wash Out']);
    expect(g[0].rows).toEqual([
      { label: 'Done at', value: 'T(2026-09-05T08:00:00.000Z)' },
      { label: 'RO Water Pressure', value: '2.5 bar' },
      { label: 'Compressed Air Pressure', value: '4.0 bar' },
      { label: 'Cleaning reason', value: 'Preventive Maintenance' },
      { label: 'Cleaned by', value: '101012' },
    ]);
    expect(g[1].rows).toEqual([
      { label: 'Done at', value: 'T(2026-09-05T08:30:00.000Z)' },
      { label: 'By', value: '101014' },
    ]);
  });

  it('prints dashes, never blanks, when a step was not recorded', () => {
    const g = stageDetailGroups('WASH_OUT', { cleaningReason: null }, fmt);
    expect(g[0].rows).toEqual([
      { label: 'Done at', value: '—' },
      { label: 'Cleaning reason', value: '—' },
      { label: 'Cleaned by', value: '—' },
    ]);
  });
});

describe('stageDetailGroups — DRY_OUT', () => {
  it('renders Dry In (start, duration, temperature, end, reason, user) then Dry Out', () => {
    const g = stageDetailGroups('DRY_OUT', {
      cleaningReason: 'Breakdown',
      dryIn: {
        startedAt: '2026-09-05T10:00:00.000Z', startedBy: '101012', durationMinutes: 90,
        endedAt: '2026-09-05T10:45:00.000Z', endedBy: '101012',
        readings: [{ description: 'Dryer Temperature', value: 61, uom: '°C', leastCount: 1 }],
      },
      dryOut: { at: '2026-09-05T11:30:00.000Z', by: '101014', readings: [] },
    }, fmt);
    expect(g.map((x) => x.title)).toEqual(['Dry In', 'Dry Out']);
    expect(g[0].rows).toEqual([
      { label: 'Started at', value: 'T(2026-09-05T10:00:00.000Z)' },
      { label: 'Duration', value: '1h 30m' },
      { label: 'Dryer Temperature', value: '61 °C' },
      { label: 'Ended at', value: 'T(2026-09-05T10:45:00.000Z)' },
      { label: 'Cleaning reason', value: 'Breakdown' },
      { label: 'By', value: '101012' },
    ]);
    expect(g[1].rows).toEqual([
      { label: 'Done at', value: 'T(2026-09-05T11:30:00.000Z)' },
      { label: 'By', value: '101014' },
    ]);
  });

  it('names both users when the dryer was started and ended by different people', () => {
    const g = stageDetailGroups('DRY_OUT', {
      cleaningReason: null,
      dryIn: { startedAt: null, startedBy: 'a', durationMinutes: 5, endedAt: null, endedBy: 'b', readings: [] },
    }, fmt);
    expect(g[0].rows.find((r) => r.label === 'By')?.value).toBe('a / b');
    expect(g[0].rows.find((r) => r.label === 'Duration')?.value).toBe('5m');
  });
});

describe('stageDetailGroups — edges', () => {
  it('returns nothing for a missing payload (older/cached response)', () => {
    expect(stageDetailGroups('WASH_OUT', undefined, fmt)).toEqual([]);
    expect(stageDetailGroups('WASH_OUT', null, fmt)).toEqual([]);
  });
  it('shows only the reason for a non-interlock stage', () => {
    expect(stageDetailGroups('STORAGE_IN', { cleaningReason: 'PM' }, fmt)).toEqual([
      { title: 'Storage In', rows: [{ label: 'Cleaning reason', value: 'PM' }] },
    ]);
    expect(stageDetailGroups('STORAGE_IN', { cleaningReason: null }, fmt)).toEqual([]);
  });
});
