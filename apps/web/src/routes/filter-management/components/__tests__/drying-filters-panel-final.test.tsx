/**
 * DryingFiltersPanel — the readings step that FINISHES Dry In (2026-10-22: every
 * pipeline shape must complete). Shared by the web Dry In stage and the tablet.
 *
 *  - A FINAL Dry In completes the cycle on its readings (SUBMIT_READINGS), so the
 *    checklist after it rides on them: the checklist is asked first, then ONE
 *    advance-with-checklist per filter. A bare SUBMIT_READINGS there is refused
 *    409 CHECKLIST_REQUIRED, and the panel had no way to send anything else.
 *  - A Dry In with no group, or a group with no Dry In instrument, has nothing to
 *    read. The step is still SUBMIT_READINGS, sent with no readings (the server
 *    accepts it); the panel showed "No dryer temperature instrument configured"
 *    and Submit refused "Enter a temperature", so such a cycle could not finish.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, role, passReauth } from '../../__tests__/fm-test-kit';
import { installFakeIndexedDB, openAppDb } from '../../hooks/__tests__/fake-indexeddb';
import { DryingFiltersPanel } from '../drying-filters-panel';

usePageTestLifecycle();
beforeEach(async () => { installFakeIndexedDB(); await openAppDb(); });

const OPERATOR = role('OPERATOR', ['FILTER_OPERATE']);
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const TEMP = { id: 't1', instrumentId: 'TG-1', description: 'Dryer Temperature', stageKey: 'DRY_IN', uom: '°C', operatingMin: 60, operatingMax: 61, leastCount: 1 };
const DRYER = { id: 'gd', name: 'Dryer bay', instruments: [TEMP] };
const WASH_ONLY = { id: 'gw', name: 'Wash bay', instruments: [{ ...TEMP, id: 'p1', stageKey: 'WASH_IN', description: 'RO pressure' }] };
const Q = { id: 'q1', question: 'Filter intact?', questionType: 'YES_NO', required: true };
const CL1 = { id: 'cl1', name: 'Release check', version: 3, isActive: true, questions: [Q] };
const state = (o: { group?: any; final?: string | null } = {}) => ({
  currentState: 'DRY_IN',
  currentCycle: { id: 'c1', cleaningAreaId: 'b1', equipmentGroupId: o.group?.id ?? null, dryerStartedAt: ago(60), dryerDurationMinutes: 10, dryerReadingsSubmitted: false },
  equipmentGroup: o.group ?? null, blockEquipmentGroups: [],
  stageLookup: { DRY_IN: { nextStages: o.final === undefined ? ['DRY_OUT'] : [], leadsToEnd: o.final !== undefined, pendingChecklistProfileIds: o.final ? [o.final] : [], interlockGated: false } },
  disabledChecklistProfileIds: [],
});

function setup(st: unknown, o: { routes?: MockRoute[]; reauthActions?: string[] } = {}) {
  const api = mockApi([
    ...(o.routes ?? []),
    { path: '/api/filters/f1/current-state', body: st },
    { path: '/api/checklist-profiles', body: { data: [CL1] } },
    ...baseRoutes({ reauthActions: o.reauthActions }),
  ]);
  const props = {
    executeOrQueue: vi.fn(async (..._args: any[]) => ({ executed: true })),
    getCache: vi.fn(async () => null),
    cacheData: vi.fn(),
    onSuccess: vi.fn(),
    onError: vi.fn(),
    onAfterSubmit: vi.fn(),
  };
  renderPage(<DryingFiltersPanel filters={[{ id: 'f1', name: 'FLT-1' }]} online variant="desktop" {...props} />, { user: OPERATOR, api });
  return { ...props, api };
}
const submit = () => screen.getByRole('button', { name: /^Submit \(/ });
const ready = async () => {
  await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
  await waitFor(() => expect(submit()).toBeEnabled());
};
const pickTemp = async () => {
  fireEvent.change(await screen.findByDisplayValue('Temperature for selected (°C)'), { target: { value: '60' } });
  await waitFor(() => expect(screen.getAllByRole('combobox').some((c) => (c as HTMLSelectElement).value === '60')).toBe(true));
};
const answerAndSubmit = async () => {
  await screen.findByText('Checklist Required');
  await waitFor(() => {
    const yes = screen.getByRole('button', { name: 'Yes' });
    if (yes.getAttribute('aria-pressed') !== 'true') fireEvent.click(yes);
    expect(yes).toHaveAttribute('aria-pressed', 'true');
  });
  fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
};

describe('DryingFiltersPanel — a FINAL Dry In with a checklist after it', () => {
  it('asks the checklist first, then sends the readings AND the answers in ONE advance-with-checklist', async () => {
    const s = setup(state({ group: DRYER, final: 'cl1' }));
    await ready();
    await pickTemp();
    fireEvent.click(submit());
    await screen.findByText('Checklist Required');
    expect(s.executeOrQueue).not.toHaveBeenCalled(); // nothing written while the checklist is open
    await answerAndSubmit();
    await waitFor(() => expect(s.executeOrQueue).toHaveBeenCalledTimes(1));
    const [kind, id, , body, stage] = s.executeOrQueue.mock.calls[0];
    expect([kind, id, stage]).toEqual(['advance-with-checklist', 'f1', 'DRY_IN']);
    expect(body).toMatchObject({
      targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS', equipmentGroupId: 'gd', instrumentReadings: { t1: 60 },
      answers: { q1: 'Yes' }, expectedProfileVersions: { cl1: 3 },
    });
    await waitFor(() => expect(s.onSuccess).toHaveBeenCalledWith('1 filter(s) → Dry In complete, checklist submitted'));
    expect(s.onError).not.toHaveBeenCalled();
  });

  it('signed once for both writes; closing the checklist sends nothing and the row stays', async () => {
    const s = setup(state({ group: DRYER, final: 'cl1' }), {
      reauthActions: ['SUBMIT_CHECKLIST_WITH_SIGNATURE'],
      routes: [{ method: 'POST', path: '/api/auth/verify', body: { success: true } }],
    });
    await ready();
    await pickTemp();
    fireEvent.click(submit());
    await screen.findByText('Checklist Required');
    fireEvent.click(within(screen.getByRole('button', { name: /Submit Checklist/ }).parentElement as HTMLElement).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Checklist Required')).toBeNull());
    expect(s.executeOrQueue).not.toHaveBeenCalled();
    expect(screen.getByText('FLT-1')).toBeInTheDocument();

    fireEvent.click(submit());
    await answerAndSubmit();
    await passReauth();
    await waitFor(() => expect(s.executeOrQueue).toHaveBeenCalledTimes(1));
    expect(s.executeOrQueue.mock.calls[0][5]).toBe('Secret@123');
  });

  it('a mid-pipeline Dry In (unchanged): a plain SUBMIT_READINGS, no checklist', async () => {
    const s = setup(state({ group: DRYER }));
    await ready();
    await pickTemp();
    fireEvent.click(submit());
    await waitFor(() => expect(s.executeOrQueue).toHaveBeenCalledTimes(1));
    expect(s.executeOrQueue.mock.calls[0][0]).toBe('advance');
    expect(screen.queryByText('Checklist Required')).toBeNull();
  });
});

describe('DryingFiltersPanel — nothing to read', () => {
  it('no equipment group: the row can be submitted, with no readings', async () => {
    const s = setup(state());
    await ready();
    expect(screen.queryByText('No dryer temperature instrument configured')).toBeNull();
    expect(screen.getByText(/No reading to take/)).toBeInTheDocument();
    fireEvent.click(submit());
    await waitFor(() => expect(s.executeOrQueue).toHaveBeenCalledTimes(1));
    const [kind, , , body] = s.executeOrQueue.mock.calls[0];
    expect(kind).toBe('advance');
    expect(body).toMatchObject({ targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS' });
    expect(body.instrumentReadings).toBeUndefined();
    expect(body.equipmentGroupId).toBeUndefined();
    expect(s.onError).not.toHaveBeenCalled();
  });

  it('a group with no Dry In instrument: the same, and no group is sent', async () => {
    const s = setup(state({ group: WASH_ONLY }));
    await ready();
    fireEvent.click(submit());
    await waitFor(() => expect(s.executeOrQueue).toHaveBeenCalledTimes(1));
    const body = s.executeOrQueue.mock.calls[0][3];
    expect(body).toMatchObject({ targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS' });
    expect(body.instrumentReadings).toBeUndefined();
    expect(body.equipmentGroupId).toBeUndefined();
  });

  it('nothing to read at a FINAL Dry In with a checklist: the checklist, then ONE advance-with-checklist with no readings', async () => {
    const s = setup(state({ final: 'cl1' }));
    await ready();
    fireEvent.click(submit());
    await answerAndSubmit();
    await waitFor(() => expect(s.executeOrQueue).toHaveBeenCalledTimes(1));
    const [kind, , , body] = s.executeOrQueue.mock.calls[0];
    expect(kind).toBe('advance-with-checklist');
    expect(body).toMatchObject({ targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS', answers: { q1: 'Yes' } });
    expect(body.instrumentReadings).toBeUndefined();
  });
});
