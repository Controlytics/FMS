/**
 * Tablet operations page — every control a screen reader / voice-access user
 * meets on the LIVE screens has an accessible name (2026-10-22). One shared rule:
 * components/__tests__/support/a11y.ts. Checked in each state the operator
 * reaches from /m: the station with its queue, Dry In's duration, the Cleaning
 * Reason dialog, the Equipment Readings dialog, the checklist dialog (every
 * question type) and the block-change dialog.
 */
import { describe, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { expectAllControlsNamed } from '@/components/__tests__/support/a11y';
import { useMobileLifecycle } from './support/mobile-kit';
import {
  renderOps, scanTag, inQueue, state, adv, graph, setDryer, submitButton, CHECKLIST_PROFILE,
} from './support/ops-harness';

vi.mock('@/lib/connectivity', async () => (await import('./support/fakes')).connectivityModule);
vi.mock('@/lib/sync-engine', async () => (await import('./support/fakes')).syncEngineModule);
vi.mock('@/lib/rfid-bridge', async () => (await import('./support/fakes')).rfidBridgeModule);
vi.mock('../../filter-management/components/drying-filters-panel', () => ({ DryingFiltersPanel: () => null }));

useMobileLifecycle();

const NO_CYCLE = (keys: string[]) => ({ currentState: null, currentCycle: null, actions: [], pipelineGraph: graph(keys), homeBlock: { id: 'b1', name: 'North' }, blockChangeStatus: 'MATCH' });
const GROUP = { id: 'gw', name: 'Wash Bay', blockId: 'b1', instruments: [
  { id: 'ro', description: 'RO water pressure', stageKey: 'WASH_IN', uom: 'bar', operatingMin: 1, operatingMax: 2, leastCount: 0.5 },
  { id: 'ca', description: 'Compressed air', stageKey: 'WASH_IN', uom: 'bar', operatingMin: 4, operatingMax: 6, leastCount: 1, autoFetchEnabled: true },
] };

describe('every control on the live operations screens is named', () => {
  it('a station with its queue (row ticks, select-all, Remove, remarks, scan field)', async () => {
    await renderOps({ stage: 'WASH_OUT' });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    expectAllControlsNamed();
  });

  it('Dry In: the duration for the whole selection', async () => {
    await renderOps({ stage: 'DRY_IN', states: { f1: state('WASH_OUT', [setDryer()]) } });
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E1'); await inQueue('F-001');
    expectAllControlsNamed();
  });

  it('the Cleaning Reason and Equipment Readings dialogs', async () => {
    await renderOps({
      stage: 'WASH_IN', states: { f3: NO_CYCLE(['WASH_IN', 'WASH_OUT']) },
      routes: [{ path: '/api/equipment-groups/by-block/b1', body: [GROUP] }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    await screen.findByText('Cleaning Reason');
    fireEvent.click(screen.getByRole('button', { name: /Breakdown/ })); // shows the justification box
    expectAllControlsNamed();
    fireEvent.change(screen.getByRole('textbox', { name: 'Justification' }), { target: { value: 'Fan bearing seized' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByText('Equipment Readings');
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    expectAllControlsNamed();
  });

  it('the checklist dialog, every question type', async () => {
    const questions = [
      { id: 'a', question: 'Gasket ok?', questionType: 'YES_NO', required: true },
      { id: 'b', question: 'Pleats ok?', questionType: 'YES_NO_NA' },
      { id: 'c', question: 'Leak test', questionType: 'PASS_FAIL' },
      { id: 'd', question: 'Washer', questionType: 'DROPDOWN', options: ['W1', 'W2'] },
      { id: 'e', question: 'Defects', questionType: 'MULTI_SELECT', options: ['Dent', 'Tear'] },
      { id: 'f', question: 'Pressure drop', questionType: 'NUMERIC', validation: { min: 0, max: 250, unit: 'Pa', leastCount: 0.5 } },
      { id: 'g', question: 'Notes', questionType: 'TEXT' },
      { id: 'h', question: 'Photo', questionType: 'PHOTO' },
      { id: 'i', question: 'Sign here', questionType: 'SIGNATURE' },
    ];
    const profile = { ...CHECKLIST_PROFILE, questions };
    await renderOps({
      stage: 'WASH_OUT', cache: { 'checklist-profiles': [profile] }, checklistProfiles: [profile],
      states: { f1: state('WASH_IN', [adv('WASH_OUT')], { stageLookup: { WASH_OUT: { pendingChecklistProfileIds: ['cl1'] } } }) },
    });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    await screen.findByText('Checklist Required');
    expectAllControlsNamed();
  });

  it('the block-change dialog (APPROVAL: reason box)', async () => {
    await renderOps({
      stage: 'WASH_IN', blockChangeMode: 'APPROVAL',
      states: { f1: state('WASH_IN', [adv('WASH_IN')], { homeBlock: { id: 'b1', name: 'North' } }) },
      routes: [{ path: '/api/filters/f1/current-state', body: { blockChangeStatus: 'REQUIRED', homeBlock: { id: 'b1', name: 'North' } } }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'South' }));
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    await screen.findByText('Block change approval needed');
    expectAllControlsNamed();
  });
});
