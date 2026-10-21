import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { usePageTestLifecycle, allowConsoleError } from '../../../__tests__/fm-test-kit';
import { StatusUpdatePanel } from '../StatusUpdatePanel';
import { BulkStatusUpdatePanel } from '../BulkStatusUpdatePanel';
import type { StatusPanelFilter } from '../../types';

usePageTestLifecycle();

const optionTexts = (sel: HTMLElement) => within(sel).getAllByRole('option').map((o) => o.textContent);

// ─── StatusUpdatePanel ───────────────────────────────────────────────────────

function Single({ filter, onSubmit = vi.fn(), onClose = vi.fn(), submitting = false }: { filter: StatusPanelFilter; onSubmit?: (x?: any) => void; onClose?: () => void; submitting?: boolean }) {
  const [state, setState] = useState('');
  const [remarks, setRemarks] = useState('');
  return <StatusUpdatePanel filter={filter} state={state} remarks={remarks} submitting={submitting}
    onStateChange={setState} onRemarksChange={setRemarks} onClose={onClose} onSubmit={onSubmit} />;
}

const PROFILE = {
  hasProfile: true, hasActiveCycle: true, profileName: 'Standard Wash', currentStage: 'WASH_OUT',
  orderedStages: ['WASH_IN', 'WASH_OUT', 'DRY_IN'], immediateNext: ['DRY_IN'],
  options: [
    { state: 'WASH_IN', classification: 'BACKWARD', allowed: true, isCurrent: false, startsCycle: true },
    { state: 'WASH_OUT', classification: 'SAME', allowed: false, isCurrent: true, startsCycle: false },
    { state: 'DRY_IN', classification: 'FORWARD', allowed: true, isCurrent: false, startsCycle: false },
    { state: 'STORAGE_IN', classification: 'SKIP', allowed: false, isCurrent: false, startsCycle: false },
    { state: 'IN_USE', classification: 'NON_CLEANING', allowed: true, isCurrent: false, startsCycle: false },
    { state: 'CUSTOM_STAGE', classification: 'COMPLETE', allowed: true, isCurrent: false, startsCycle: false },
  ],
  cleaningReasons: [
    { key: 'PM', name: 'Preventive Maintenance' },
    { key: 'OOS', name: 'Out of specification', requiresJustification: true },
  ],
};

describe('StatusUpdatePanel', () => {
  it('without a cleaning profile: the full manual list; "To Be Cleaned" when no state; remarks gate submit', async () => {
    const api = mockApi([{ path: '/api/filters/f1/stage-options', body: { hasProfile: false, options: [], cleaningReasons: [] } }]);
    const onSubmit = vi.fn();
    renderPage(<Single filter={{ id: 'f1', name: 'FLT-001', currentState: null }} onSubmit={onSubmit} />, { api });
    await waitFor(() => expect(api.calls('GET', '/api/filters/f1/stage-options')).toHaveLength(1));
    expect(screen.getByDisplayValue('FLT-001')).toBeInTheDocument();
    expect(screen.getByDisplayValue('To Be Cleaned')).toBeInTheDocument();
    const sel = screen.getByRole('combobox');
    expect(optionTexts(sel)).toEqual(['Select status…', 'Wash In', 'Wash Out', 'Dry In', 'Dry Out', 'Storage In', 'Storage Out', 'Cleaning Cycle Completed']);
    expect(screen.queryByText(/Cleaning profile:/)).toBeNull();
    const submit = screen.getByRole('button', { name: 'Update Status' });
    expect(submit).toBeDisabled();
    fireEvent.change(sel, { target: { value: 'DRY_OUT' } });
    expect(submit).toBeDisabled(); // remarks still empty
    fireEvent.change(screen.getByPlaceholderText('Enter reason for status change...'), { target: { value: 'Correcting a missed scan' } });
    expect(submit).toBeEnabled();
    expect(screen.getByText(/Continuing will require your password confirmation/)).toBeInTheDocument();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(undefined);
  });

  it('choosing the current state is refused with a message', async () => {
    const api = mockApi([{ path: '/api/filters/f1/stage-options', body: { hasProfile: false } }]);
    renderPage(<Single filter={{ id: 'f1', name: 'FLT-001', currentState: 'DRY_IN' }} />, { api });
    expect(screen.getByDisplayValue('Dry In')).toBeInTheDocument();
    await waitFor(() => expect(api.requests.length).toBeGreaterThan(0));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'DRY_IN' } });
    fireEvent.change(screen.getByPlaceholderText('Enter reason for status change...'), { target: { value: 'x' } });
    expect(screen.getByText('Please select a different status from the current one.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update Status' })).toBeDisabled();
  });

  it('an unknown stored state is shown humanised', async () => {
    const api = mockApi([{ path: '/api/filters/f1/stage-options', body: { hasProfile: false } }]);
    renderPage(<Single filter={{ id: 'f1', name: 'FLT-001', currentState: 'QUARANTINE_HOLD' }} />, { api });
    expect(screen.getByDisplayValue('QUARANTINE HOLD')).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET', '/api/filters/f1/stage-options')).toHaveLength(1));
  });

  it('a failed stage-options read falls back to the manual list (server still validates)', async () => {
    allowConsoleError(/\[SWR Error\]/);
    const api = mockApi([{ path: '/api/filters/f1/stage-options', status: 500, body: { error: 'INTERNAL', message: 'stage lookup failed' } }]);
    renderPage(<Single filter={{ id: 'f1', name: 'FLT-001', currentState: null }} />, { api });
    expect(await screen.findByText('stage lookup failed')).toBeInTheDocument();
    expect(optionTexts(screen.getByRole('combobox'))).toHaveLength(8);
  });

  it('with a profile: options follow the sequence; current is disabled; labels mark out-of-sequence and back moves', async () => {
    const api = mockApi([{ path: '/api/filters/f1/stage-options', body: PROFILE }]);
    renderPage(<Single filter={{ id: 'f1', name: 'FLT-001', currentState: 'WASH_OUT' }} />, { api });
    expect(await screen.findByText('Cleaning profile: Standard Wash')).toBeInTheDocument();
    const sel = screen.getByRole('combobox');
    expect(optionTexts(sel)).toEqual([
      'Select status…', 'Wash In (back)', 'Wash Out (current)', 'Dry In', 'Storage In — out of sequence', 'In Use', 'CUSTOM STAGE',
    ]);
    expect(screen.getByRole('option', { name: 'Wash Out (current)' })).toBeDisabled();
  });

  it('a SKIP move is blocked as an invalid stage movement', async () => {
    const api = mockApi([{ path: '/api/filters/f1/stage-options', body: PROFILE }]);
    renderPage(<Single filter={{ id: 'f1', name: 'FLT-001', currentState: 'WASH_OUT' }} />, { api });
    await screen.findByText('Cleaning profile: Standard Wash');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'STORAGE_IN' } });
    fireEvent.change(screen.getByPlaceholderText('Enter reason for status change...'), { target: { value: 'skip it' } });
    expect(screen.getByText(/Invalid stage movement/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update Status' })).toBeDisabled();
  });

  it('a FORWARD move needs no cleaning reason and submits without extras', async () => {
    const api = mockApi([{ path: '/api/filters/f1/stage-options', body: PROFILE }]);
    const onSubmit = vi.fn();
    renderPage(<Single filter={{ id: 'f1', name: 'FLT-001', currentState: 'WASH_OUT' }} onSubmit={onSubmit} />, { api });
    await screen.findByText('Cleaning profile: Standard Wash');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'DRY_IN' } });
    expect(screen.queryByText('Cleaning Reason')).toBeNull();
    expect(screen.queryByText(/start a new cleaning cycle/)).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Enter reason for status change...'), { target: { value: 'Missed scan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Status' }));
    expect(onSubmit).toHaveBeenCalledWith(undefined);
  });

  it('a BACKWARD move with an active cycle warns about interruption and needs a reason (+ justification when the reason requires it)', async () => {
    const api = mockApi([{ path: '/api/filters/f1/stage-options', body: PROFILE }]);
    const onSubmit = vi.fn();
    renderPage(<Single filter={{ id: 'f1', name: 'FLT-001', currentState: 'WASH_OUT' }} onSubmit={onSubmit} />, { api });
    await screen.findByText('Cleaning profile: Standard Wash');
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'WASH_IN' } });
    expect(screen.getByText(/close the current cleaning cycle as/)).toBeInTheDocument();
    expect(screen.queryByText('This will start a new cleaning cycle.')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Enter reason for status change...'), { target: { value: 'Re-wash required' } });
    const submit = screen.getByRole('button', { name: 'Update Status' });
    expect(submit).toBeDisabled(); // no cleaning reason yet
    const reasonSel = screen.getAllByRole('combobox')[1];
    expect(optionTexts(reasonSel)).toEqual(['Select reason…', 'Preventive Maintenance', 'Out of specification']);
    fireEvent.change(reasonSel, { target: { value: 'OOS' } });
    const just = screen.getByPlaceholderText('Min 10 characters…');
    fireEvent.change(just, { target: { value: 'too short' } });
    expect(submit).toBeDisabled();
    fireEvent.change(just, { target: { value: '  Particle count high  ' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ cleaningReasonKey: 'OOS', cleaningJustification: 'Particle count high' });
  });

  it('a START move (no active cycle) says a cycle will start; a reason without justification submits justification undefined', async () => {
    const api = mockApi([{ path: '/api/filters/f2/stage-options', body: { ...PROFILE, hasActiveCycle: false } }]);
    const onSubmit = vi.fn();
    renderPage(<Single filter={{ id: 'f2', name: 'FLT-002', currentState: 'WASH_OUT' }} onSubmit={onSubmit} />, { api });
    await screen.findByText('Cleaning profile: Standard Wash');
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'WASH_IN' } });
    expect(screen.getByText('This will start a new cleaning cycle.')).toBeInTheDocument();
    expect(screen.queryByText(/close the current cleaning cycle/)).toBeNull();
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'PM' } });
    expect(screen.queryByPlaceholderText('Min 10 characters…')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Enter reason for status change...'), { target: { value: 'Scheduled PM' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Status' }));
    expect(onSubmit).toHaveBeenCalledWith({ cleaningReasonKey: 'PM', cleaningJustification: undefined });
  });

  it('changing the target state resets a chosen cleaning reason', async () => {
    const api = mockApi([{ path: '/api/filters/f2/stage-options', body: { ...PROFILE, hasActiveCycle: false, options: [
      ...PROFILE.options, { state: 'DRY_OUT', classification: 'START', allowed: true, isCurrent: false, startsCycle: true },
    ] } }]);
    renderPage(<Single filter={{ id: 'f2', name: 'FLT-002', currentState: 'WASH_OUT' }} />, { api });
    await screen.findByText('Cleaning profile: Standard Wash');
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'WASH_IN' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'PM' } });
    expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('PM');
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'DRY_OUT' } });
    expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('');
  });

  it('submitting shows Processing; backdrop, X and Cancel close', async () => {
    const api = mockApi([{ path: '/api/filters/f1/stage-options', body: { hasProfile: false } }]);
    const onClose = vi.fn();
    const { container } = renderPage(<Single filter={{ id: 'f1', name: 'FLT-001', currentState: null }} onClose={onClose} submitting />, { api });
    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Processing...' })).toBeDisabled();
    fireEvent.click(container.querySelector('.bg-black\\/20') as HTMLElement);
    fireEvent.click(screen.getAllByRole('button')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('no filter id: nothing is fetched', () => {
    const api = mockApi([]);
    renderPage(<Single filter={{ id: '', name: 'X', currentState: null }} />, { api });
    expect(api.requests).toEqual([]);
  });
});

// ─── BulkStatusUpdatePanel ───────────────────────────────────────────────────

function Bulk({ selected, onSubmit = vi.fn(), onClose = vi.fn(), submitting = false }: { selected: { id: string; name: string }[]; onSubmit?: (x?: any) => void; onClose?: () => void; submitting?: boolean }) {
  const [state, setState] = useState('');
  const [remarks, setRemarks] = useState('');
  return <BulkStatusUpdatePanel selectedCount={selected.length} selectedFilters={selected} state={state} remarks={remarks} submitting={submitting}
    onStateChange={setState} onRemarksChange={setRemarks} onClose={onClose} onSubmit={onSubmit} />;
}

const opt = (state: string, allowed = true, isCurrent = false) => ({ state, allowed, isCurrent, classification: 'FORWARD' });
const REASONS = [{ key: 'PM', name: 'Preventive Maintenance' }, { key: 'OOS', name: 'Out of specification', requiresJustification: true }];
const THREE = [{ id: 'f1', name: 'FLT-001' }, { id: 'f2', name: 'FLT-002' }, { id: 'f3', name: 'FLT-003' }];

function threeFilterApi() {
  return mockApi([
    // f1 has no reasons configured, f2 does: the panel takes the first non-empty list
    { path: '/api/filters/f1/stage-options', body: { hasProfile: true, options: [opt('WASH_IN'), opt('DRY_IN'), opt('WASH_OUT', true, true), opt('STORAGE_IN', false)], cleaningReasons: [] } },
    { path: '/api/filters/f2/stage-options', body: { hasProfile: true, options: [opt('WASH_IN'), opt('CLEANING_CYCLE_COMPLETED')], cleaningReasons: REASONS } },
    { path: '/api/filters/f3/stage-options', status: 500, body: { error: 'INTERNAL', message: 'profile missing' } },
  ]);
}

describe('BulkStatusUpdatePanel', () => {
  it('fetches stage options for every selected filter and labels each stage by how many can take it', async () => {
    const api = threeFilterApi();
    renderPage(<Bulk selected={THREE} />, { api });
    expect(screen.getByText('Checking which stages are valid for the selected filters…')).toBeInTheDocument();
    expect(screen.getByText(/Updating/)).toHaveTextContent('Updating 3 filter(s) to the selected status.');
    THREE.forEach((f) => expect(screen.getByText(f.name)).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText(/Checking which stages/)).toBeNull());
    expect(api.calls('GET', /stage-options/).map((r) => r.path).sort()).toEqual(['/api/filters/f1/stage-options', '/api/filters/f2/stage-options', '/api/filters/f3/stage-options']);
    const sel = screen.getByRole('combobox');
    expect(optionTexts(sel)).toEqual([
      'Select status…',
      'Wash In — valid for 2 of 3',
      'Wash Out — out of sequence', // f1 holds it as CURRENT: not a valid target
      'Dry In — valid for 1 of 3',
      'Dry Out — out of sequence',
      'Storage In — out of sequence', // not allowed
      'Storage Out — out of sequence',
      'Cleaning Cycle Completed — valid for 1 of 3',
    ]);
    expect(screen.getByRole('option', { name: 'Dry Out — out of sequence' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Wash In — valid for 2 of 3' })).toBeEnabled();
  });

  it('a partially valid cleaning stage warns how many will be skipped and requires a reason (+ justification)', async () => {
    const onSubmit = vi.fn();
    renderPage(<Bulk selected={THREE} onSubmit={onSubmit} />, { api: threeFilterApi() });
    await waitFor(() => expect(screen.queryByText(/Checking which stages/)).toBeNull());
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'DRY_IN' } });
    expect(screen.getByText(/Only/)).toHaveTextContent('Only 1 of 3 selected filters can move to this stage — the other 2 will be skipped.');
    expect(screen.getByText(/a cleaning reason is required/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Enter reason for status change...'), { target: { value: 'Bulk correction' } });
    const submit = screen.getByRole('button', { name: 'Update 3 Filter(s)' });
    expect(submit).toBeDisabled();
    const reasonSel = screen.getAllByRole('combobox')[1];
    expect(optionTexts(reasonSel)).toEqual(['Select reason…', 'Preventive Maintenance', 'Out of specification']);
    fireEvent.change(reasonSel, { target: { value: 'OOS' } });
    fireEvent.change(screen.getByPlaceholderText('Min 10 characters…'), { target: { value: 'short' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Min 10 characters…'), { target: { value: 'Particle count out of limits' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ cleaningReasonKey: 'OOS', cleaningJustification: 'Particle count out of limits' });
  });

  it('a cleaning stage with a reason that needs no justification submits justification undefined', async () => {
    const onSubmit = vi.fn();
    renderPage(<Bulk selected={THREE} onSubmit={onSubmit} />, { api: threeFilterApi() });
    await waitFor(() => expect(screen.queryByText(/Checking which stages/)).toBeNull());
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'WASH_IN' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'PM' } });
    expect(screen.queryByPlaceholderText('Min 10 characters…')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Enter reason for status change...'), { target: { value: 'Scheduled PM' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update 3 Filter(s)' }));
    expect(onSubmit).toHaveBeenCalledWith({ cleaningReasonKey: 'PM', cleaningJustification: undefined });
  });

  it('Cleaning Cycle Completed needs no reason and submits without extras', async () => {
    const onSubmit = vi.fn();
    renderPage(<Bulk selected={THREE} onSubmit={onSubmit} />, { api: threeFilterApi() });
    await waitFor(() => expect(screen.queryByText(/Checking which stages/)).toBeNull());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'CLEANING_CYCLE_COMPLETED' } });
    expect(screen.queryByText(/a cleaning reason is required/)).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Enter reason for status change...'), { target: { value: 'Close out' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update 3 Filter(s)' }));
    expect(onSubmit).toHaveBeenCalledWith(undefined);
  });

  it('a stage no selected filter can take is refused with an explanation', async () => {
    renderPage(<Bulk selected={THREE} />, { api: threeFilterApi() });
    await waitFor(() => expect(screen.queryByText(/Checking which stages/)).toBeNull());
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'STORAGE_OUT' } });
    fireEvent.change(screen.getByPlaceholderText('Enter reason for status change...'), { target: { value: 'x' } });
    expect(screen.getByText(/None of the selected filters can move to this stage/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update 3 Filter(s)' })).toBeDisabled();
  });

  it('when every filter can take a stage the label is plain; with no reasons configured it says so', async () => {
    const api = mockApi([
      { path: '/api/filters/f1/stage-options', body: { hasProfile: true, options: [opt('WASH_IN')] } },
      { path: '/api/filters/f2/stage-options', body: { hasProfile: true, options: [opt('WASH_IN')] } },
    ]);
    renderPage(<Bulk selected={THREE.slice(0, 2)} />, { api });
    await waitFor(() => expect(screen.queryByText(/Checking which stages/)).toBeNull());
    expect(screen.getByRole('option', { name: 'Wash In' })).toBeEnabled();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'WASH_IN' } });
    expect(screen.queryByText(/Only/)).toBeNull();
    expect(screen.getByText("No cleaning reasons configured for this block's profile.")).toBeInTheDocument();
  });

  it('a changed selection re-fetches and ignores the stale answer', async () => {
    const api = mockApi([
      { path: '/api/filters/f1/stage-options', body: { hasProfile: true, options: [opt('WASH_IN')] } },
      { path: '/api/filters/f2/stage-options', body: { hasProfile: true, options: [opt('DRY_IN')] } },
    ]);
    const view = renderPage(<Bulk selected={[THREE[0]]} />, { api });
    view.rerender(<Bulk selected={THREE.slice(0, 2)} />);
    await waitFor(() => expect(screen.queryByText(/Checking which stages/)).toBeNull());
    expect(screen.getByRole('option', { name: 'Wash In — valid for 1 of 2' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Dry In — valid for 1 of 2' })).toBeInTheDocument();
  });

  it('with nothing selected nothing is fetched and no stage is offered', async () => {
    const api = mockApi([]);
    renderPage(<Bulk selected={[]} />, { api });
    expect(screen.queryByText(/Checking which stages/)).toBeNull();
    expect(screen.getByRole('option', { name: 'Wash In' })).toBeDisabled();
    expect(api.requests).toEqual([]);
  });

  it('submitting shows Processing; backdrop, X and Cancel close', async () => {
    const api = mockApi([{ path: /stage-options/, body: { hasProfile: false } }]);
    const onClose = vi.fn();
    const { container } = renderPage(<Bulk selected={[THREE[0]]} onClose={onClose} submitting />, { api });
    await waitFor(() => expect(screen.queryByText(/Checking which stages/)).toBeNull());
    expect(screen.getByRole('button', { name: 'Processing...' })).toBeDisabled();
    fireEvent.click(container.querySelector('.bg-black\\/20') as HTMLElement);
    fireEvent.click(screen.getAllByRole('button')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
