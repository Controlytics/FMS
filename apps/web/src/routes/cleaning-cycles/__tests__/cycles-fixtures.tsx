/**
 * Shared fixtures for the cleaning-cycles page tests (coverage campaign,
 * 2026-10-21). NOT a test file.
 */
import { vi } from 'vitest';
import { useLocation } from 'react-router-dom';
import type { MockRoute } from '@/test-utils/page-harness';

/** Deterministic datetime config: UTC, 24-hour. Put BEFORE baseRoutes(). */
export const DT_UTC: MockRoute = {
  path: '/api/config/datetime/current',
  body: { dateFormat: 'YYYY-MM-DD', timeFormat: '24-hour', timezone: 'UTC' },
};

/** Stand-in for the ReportDoc createReport() returns — records every call. */
export function fakeReport() {
  const calls: { op: string; arg: any }[] = [];
  const r = {
    calls,
    addKeyValue: vi.fn((rows: [string, string][]) => { calls.push({ op: 'kv', arg: rows }); }),
    addSectionTitle: vi.fn((t: string) => { calls.push({ op: 'title', arg: t }); }),
    addTable: vi.fn((t: any) => { calls.push({ op: 'table', arg: t }); }),
    newPage: vi.fn(() => { calls.push({ op: 'page', arg: null }); }),
    save: vi.fn(),
    getSnapshot: vi.fn(() => ({ sections: [{}] })),
    titles: () => calls.filter((c) => c.op === 'title').map((c) => c.arg as string),
    tables: () => calls.filter((c) => c.op === 'table').map((c) => c.arg),
    kvs: () => calls.filter((c) => c.op === 'kv').map((c) => Object.fromEntries(c.arg as [string, string][])),
  };
  return r;
}

/** Renders the router location so a test can assert navigate() targets. */
export function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

const t = (h: number, m = 0) => `2026-10-01T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

/** A COMPLETED cycle whose events fill every Cleaning Record column. */
export function completedCycle(over: Record<string, any> = {}) {
  return {
    id: 'cyc-1', filterId: 'f1', filterName: 'FLT-001', filterSet: 'SET_A', ahuName: 'AHU-1',
    status: 'COMPLETED', startedAt: t(8), completedAt: t(12),
    cycleCode: 'CC-001', cleaningReasonKey: 'PM', cleaningReasonLabel: 'Preventive',
    cleaningAreaName: 'Block A',
    profileStages: ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT'],
    dryerDurationMinutes: 90, dryerStartedAt: t(10),
    lastStageByUsername: 'opr2',
    events: [
      { id: 'e1', eventType: 'STATE_TRANSITION', fromState: null, toState: 'WASH_IN', performedAt: t(8), performedByName: 'opr1',
        attributes: { instrumentReadings: [
          { description: 'Compressed Air Pressure', value: 6.123, leastCount: 0.1, uom: 'bar' },
          { description: 'RO Water Pressure', value: 2, uom: 'bar' },
        ] } },
      { id: 'e2', eventType: 'STATE_TRANSITION', fromState: 'WASH_IN', toState: 'WASH_OUT', performedAt: t(9), performedByName: 'opr1', attributes: {} },
      { id: 'e3', eventType: 'STATE_TRANSITION', fromState: 'WASH_OUT', toState: 'DRY_IN', performedAt: t(10), performedByName: 'opr2',
        attributes: { action: 'DRYER_STARTED', dryerDurationMinutes: 90, dryerStartedAt: t(10) } },
      { id: 'e4', eventType: 'STATE_TRANSITION', fromState: null, toState: 'DRY_IN', performedAt: t(11, 30), performedByName: 'opr2',
        attributes: { action: 'DRYER_READINGS_SUBMITTED', instrumentReadings: [{ description: 'Dryer Temperature', value: 55, uom: '°C' }] } },
      { id: 'e5', eventType: 'STATE_TRANSITION', fromState: 'DRY_IN', toState: 'DRY_OUT', performedAt: t(12), performedByName: 'opr3', attributes: {} },
    ],
    ...over,
  };
}

export const ISO = t;
