/**
 * D03-08 (2026-10-22): the console's Cleaning Cycles columns use the Cleaning
 * Record's own rule (getStageInfo), so a stage rejected at approval and redone
 * shows the attempt that counts here too — the latest entry into the stage — and
 * the approver's rejection rewind never stands in for the wash.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { resetEnv } from './config-test-helpers';
import { renderFdm, row, openTab } from './fdm-helpers';

vi.setConfig({ testTimeout: 20_000 });
afterEach(resetEnv);

const RO = { instrumentId: 'i-ro', description: 'RO Water Pressure', value: 2.5, uom: 'bar', leastCount: 0.1 };

const REJ = {
  id: 'c9', cycleCode: 'CYC-009', filterId: 'f1', filterName: 'FLT-900', status: 'COMPLETED',
  startedAt: '2026-07-05T08:00:00.000Z', completedAt: '2026-07-05T09:00:00.000Z',
  events: [
    { id: 'r1', eventType: 'STATE_TRANSITION', fromState: null, toState: 'WASH_IN', performedAt: '2026-07-05T08:00:00.000Z', performedByName: 'Op A', attributes: { instrumentReadings: [RO] } },
    { id: 'r2', eventType: 'STATE_TRANSITION', fromState: 'WASH_IN', toState: 'WASH_OUT', performedAt: '2026-07-05T08:20:00.000Z', performedByName: 'Op A', attributes: {} },
    { id: 'r3', eventType: 'STATE_TRANSITION', fromState: 'WASH_OUT', toState: 'WASH_IN', performedAt: '2026-07-05T08:25:00.000Z', performedByName: 'QA One', attributes: { kind: 'STAGE_INTERLOCK_REJECTED', stageKey: 'WASH_OUT' } },
    { id: 'r4', eventType: 'STATE_TRANSITION', fromState: 'WASH_IN', toState: 'WASH_OUT', performedAt: '2026-07-05T08:40:00.000Z', performedByName: 'Op B', attributes: {} },
  ],
};

describe('Cleaning Cycles tab — a stage rejected at approval and redone (D03-08)', () => {
  it('Wash Out shows the redo (08:40); Wash In and Wash By stay the operator\'s, never the approver', async () => {
    renderFdm([
      { path: '/api/filters/cycles', body: { data: [REJ], total: 1 } },
      { path: '/api/hierarchy/filters', body: { data: [{ id: 'f1', name: 'FLT-900' }] } },
    ]);
    await openTab('Cleaning Cycles');
    const r = await waitFor(() => row('FLT-900'));
    const text = r.textContent ?? '';
    expect(text).toContain('2026-07-05 08:40');
    expect(text).toContain('2026-07-05 08:00');
    expect(text).toContain('2.5 bar');
    expect(text).not.toContain('08:20');
    expect(text).not.toContain('QA One');
    expect(text).toContain('Op A');
  });
});
