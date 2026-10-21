import { describe, it, expect } from 'vitest';
import { stageDetailGroups, formatReading, prettyStage, detailRows, type StageDetails } from '../stage-approval';

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

describe('prettyStage', () => {
  it('labels the six stations, passes unknown keys through, blanks a missing key', () => {
    expect(['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT'].map(prettyStage))
      .toEqual(['Wash In', 'Wash Out', 'Dry In', 'Dry Out', 'Storage In', 'Storage Out']);
    expect(prettyStage('IN_USE')).toBe('IN_USE');
    expect(prettyStage(null)).toBe('');
    expect(prettyStage(undefined)).toBe('');
    expect(prettyStage('')).toBe('');
  });
});

describe('detailRows', () => {
  it('lists the nine identity rows in display order, dashing every missing value', () => {
    const empty = { filterName: null, block: null, area: null, ahu: null, ahuType: null, micronSize: null, filterType: null, filterDimensions: null, filterSet: null };
    const rows = detailRows(empty);
    expect(rows.map((r) => r.label)).toEqual(['Filter', 'Block', 'Area', 'AHU', 'AHU Type', 'Micron Size', 'Filter Type', 'Filter Dimensions', 'Filter Set']);
    expect(rows.every((r) => r.value === '—')).toBe(true);
    const full = detailRows({ filterName: 'F-1', block: 'B', area: 'A', ahu: 'AHU-1', ahuType: 'Supply', micronSize: '0.3', filterType: 'HEPA', filterDimensions: '610x610', filterSet: 'Set A' });
    expect(full.map((r) => r.value)).toEqual(['F-1', 'B', 'A', 'AHU-1', 'Supply', '0.3', 'HEPA', '610x610', 'Set A']);
  });
});

describe('stageDetailGroups — DRY_OUT fallbacks', () => {
  it('with no dryIn / dryOut recorded prints dashes; a reading without description is labelled "Reading"', () => {
    const g = stageDetailGroups('DRY_OUT', { cleaningReason: null }, fmt);
    expect(g[0].rows).toEqual([
      { label: 'Started at', value: '—' },
      { label: 'Duration', value: '—' },
      { label: 'Ended at', value: '—' },
      { label: 'Cleaning reason', value: '—' },
      { label: 'By', value: '—' },
    ]);
    expect(g[1].rows).toEqual([{ label: 'Done at', value: '—' }, { label: 'By', value: '—' }]);
  });

  it('shows the one known name when only the starter (or only the ender) is recorded', () => {
    const onlyStart = stageDetailGroups('DRY_OUT', { cleaningReason: null, dryIn: { startedAt: null, startedBy: 'starter', durationMinutes: null, endedAt: null, endedBy: null, readings: [{ description: null, value: 3, uom: null, leastCount: null }] } }, fmt);
    expect(onlyStart[0].rows.find((r) => r.label === 'By')?.value).toBe('starter');
    expect(onlyStart[0].rows.find((r) => r.label === 'Reading')?.value).toBe('3');
    const same = stageDetailGroups('DRY_OUT', { cleaningReason: null, dryIn: { startedAt: null, startedBy: 'x', durationMinutes: 0, endedAt: null, endedBy: 'x', readings: [] } }, fmt);
    expect(same[0].rows.find((r) => r.label === 'By')?.value).toBe('x');
    expect(same[0].rows.find((r) => r.label === 'Duration')?.value).toBe('0m');
  });
});
