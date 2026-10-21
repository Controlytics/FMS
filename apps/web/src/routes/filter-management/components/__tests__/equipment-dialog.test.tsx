import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { usePageTestLifecycle } from '../../__tests__/fm-test-kit';
import { EquipmentDialog } from '../equipment-dialog';

usePageTestLifecycle();
afterEach(() => { vi.useRealTimers(); });

const G1 = {
  id: 'g1', name: 'Washer Bay 1',
  instruments: [
    { id: 'i1', instrumentId: 'PG-01', description: 'RO water pressure', stageKey: 'WASH_IN', uom: 'bar', operatingMin: 1, operatingMax: 2, leastCount: 0.5 },
    { id: 'i2', instrumentId: 'PG-02', description: 'Compressed air pressure', stageKey: 'WASH_IN', uom: 'kg/cm2', operatingMin: 4, operatingMax: 6, leastCount: 1 },
    { id: 'i3', instrumentId: 'TG-01', description: 'Dryer temperature', stageKey: 'DRY_IN', uom: '°C', operatingMin: 60, operatingMax: 62, leastCount: 1 },
  ],
};
const G2 = { id: 'g2', name: 'Washer Bay 2', instruments: [{ id: 'j1', instrumentId: 'PG-11', description: 'RO water pressure', stageKey: 'WASH_IN', uom: 'bar', operatingMin: 1, operatingMax: 3, leastCount: 1 }] };
// Auto-fetch group: a1 has a stepped range (dropdown fallback exists), a2 has no least count (no dropdown).
const GA = {
  id: 'ga', name: 'Auto Bay',
  instruments: [
    { id: 'a1', instrumentId: 'PT-01', description: 'RO water pressure', stageKey: 'WASH_IN', uom: 'bar', operatingMin: 1, operatingMax: 2, leastCount: 0.5, autoFetchEnabled: true },
    { id: 'a2', instrumentId: 'PT-02', description: 'Compressed air pressure', stageKey: 'WASH_IN', uom: 'bar', operatingMin: 4, operatingMax: 6, leastCount: 0, autoFetchEnabled: true },
  ],
};
const WASH = { key: 'WASH_IN', label: 'Wash In', color: 'x' };
const mkDialog = (over: any = {}) => ({ filterId: 'f1', filterName: 'FLT-1', stage: WASH, groups: [G1, G2], ...over });

function Host({ initial, online = false, onSubmit, error = '', loading = false }: { initial: any; online?: boolean; onSubmit: any; error?: string; loading?: boolean }) {
  const [dialog, setDialog] = useState<any>(initial);
  return (
    <>
      <button onClick={() => setDialog(null)}>host-close</button>
      <EquipmentDialog dialog={dialog} onClose={() => setDialog(null)} onSubmit={onSubmit} loading={loading} error={error} online={online} />
    </>
  );
}

const submitBtn = () => screen.getByRole('button', { name: /Submit/ });

describe('EquipmentDialog — manual readings', () => {
  it('renders nothing when there is no dialog', () => {
    renderPage(<EquipmentDialog dialog={null} onClose={vi.fn()} onSubmit={vi.fn()} loading={false} error="" online />);
    expect(screen.queryByText(/Readings|Reading/)).toBeNull();
  });

  it('pick a group, choose each stage reading from the least-count dropdown, submit', () => {
    const onSubmit = vi.fn();
    renderPage(<Host initial={mkDialog()} onSubmit={onSubmit} />);
    expect(screen.getByText('Equipment & Pressure Readings')).toBeInTheDocument();
    expect(screen.getByText('FLT-1 → Wash In')).toBeInTheDocument();
    expect(screen.getByText('PG-01, PG-02, TG-01')).toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Washer Bay 1/ }));
    expect(screen.getByText('Record pressure readings:')).toBeInTheDocument();
    // Only this stage's instruments; the Dry In one is not asked for here.
    expect(screen.queryByText('Dryer temperature')).toBeNull();
    expect(screen.getByText('1.0–2.0 bar')).toBeInTheDocument();
    const [ro, air] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect([...ro.options].map((o) => o.textContent)).toEqual(['Select value...', '1.0 bar', '1.5 bar', '2.0 bar']);
    expect([...air.options].map((o) => o.textContent)).toEqual(['Select value...', '4 kg/cm2', '5 kg/cm2', '6 kg/cm2']);
    // no Get Values offline/manual
    expect(screen.queryByRole('button', { name: /Get Values/ })).toBeNull();

    fireEvent.change(ro, { target: { value: '1.5' } });
    expect(submitBtn()).toBeDisabled();
    fireEvent.change(air, { target: { value: '5' } });
    expect(submitBtn()).toBeEnabled();
    // clearing a reading disables Submit again
    fireEvent.change(air, { target: { value: '' } });
    expect(submitBtn()).toBeDisabled();
    fireEvent.change(air, { target: { value: '6' } });
    fireEvent.click(submitBtn());
    expect(onSubmit).toHaveBeenCalledWith('g1', { i1: 1.5, i2: 6 });
  });

  it('switching group discards the readings entered for the previous one', () => {
    renderPage(<Host initial={mkDialog()} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Washer Bay 1/ }));
    const [ro, air] = screen.getAllByRole('combobox');
    fireEvent.change(ro, { target: { value: '1' } });
    fireEvent.change(air, { target: { value: '4' } });
    expect(submitBtn()).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Washer Bay 2/ }));
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
    expect(submitBtn()).toBeDisabled();
  });

  it('a cycle-pinned group skips the chooser; Dry In uses the dryer wording', () => {
    const onSubmit = vi.fn();
    renderPage(<Host initial={mkDialog({ stage: { key: 'DRY_IN', label: 'Dry In', color: 'x' }, cycleEquipmentGroup: G1 })} onSubmit={onSubmit} />);
    expect(screen.getByText('Dryer Temperature Reading')).toBeInTheDocument();
    expect(screen.getByText('Record dryer temperature:')).toBeInTheDocument();
    expect(screen.queryByText('Select Equipment Group:')).toBeNull();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '61' } });
    fireEvent.click(submitBtn());
    expect(onSubmit).toHaveBeenCalledWith('g1', { i3: 61 });
  });

  it('shows the parent error; loading disables Submit; Cancel closes the dialog', () => {
    const { rerender } = renderPage(<EquipmentDialog dialog={mkDialog({ cycleEquipmentGroup: G2 })} onClose={vi.fn()} onSubmit={vi.fn()} loading error="Pressure out of spec" online={false} />);
    expect(screen.getByText('Pressure out of spec')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons[buttons.length - 1]).toBeDisabled();
    const onClose = vi.fn();
    rerender(<EquipmentDialog dialog={mkDialog({ cycleEquipmentGroup: G2 })} onClose={onClose} onSubmit={vi.fn()} loading={false} error="" online={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('an auto-fetch instrument is manual (dropdown, no Get Values) while offline', () => {
    renderPage(<Host initial={mkDialog({ groups: [GA] })} online={false} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Auto Bay/ }));
    expect(screen.queryByRole('button', { name: /Get Values/ })).toBeNull();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
  });
});

describe('EquipmentDialog — out-of-range confirmation', () => {
  it('an out-of-range value is flagged, and Submit asks to confirm (refuse = not sent, accept = sent)', () => {
    const onSubmit = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage(<Host initial={mkDialog({ groups: [GA] })} online onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /Auto Bay/ }));
    const [a1, a2] = screen.getAllByPlaceholderText('Enter or fetch value');
    fireEvent.change(a1, { target: { value: '9.5' } });
    fireEvent.change(a2, { target: { value: '5' } });
    expect(screen.getByText('9.5 bar is out of the operating range (1.0–2.0). You can submit after confirming.')).toBeInTheDocument();
    fireEvent.click(submitBtn());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain('• RO water pressure: 9.5 bar (range 1–2)');
    expect(onSubmit).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(submitBtn());
    expect(onSubmit).toHaveBeenCalledWith('ga', { a1: 9.5, a2: 5 });
  });

  it('a typed non-number clears that reading', () => {
    renderPage(<Host initial={mkDialog({ groups: [GA] })} online onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Auto Bay/ }));
    const [a1, a2] = screen.getAllByPlaceholderText('Enter or fetch value');
    fireEvent.change(a1, { target: { value: '1.5' } });
    fireEvent.change(a2, { target: { value: '5' } });
    expect(submitBtn()).toBeEnabled();
    fireEvent.change(a2, { target: { value: '' } });
    expect(submitBtn()).toBeDisabled();
  });
});

describe('EquipmentDialog — Get Values (auto-fetch)', () => {
  it('fetches per stage, fills arriving values, retries the rest, then locks fetched values', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = mockApi([
      { method: 'POST', path: '/api/equipment-groups/fetch-readings', times: 1, body: { results: [{ instrumentId: 'a1', ok: true, value: 1.7 }, { instrumentId: 'a2', ok: false }] } },
      { method: 'POST', path: '/api/equipment-groups/fetch-readings', body: { results: [{ instrumentId: 'a2', ok: true, value: 5.25 }, { instrumentId: 'zz', ok: true, value: 1 }] } },
    ]);
    const onSubmit = vi.fn();
    renderPage(<Host initial={mkDialog({ groups: [GA] })} online onSubmit={onSubmit} />, { api });
    fireEvent.click(screen.getByRole('button', { name: /Auto Bay/ }));
    fireEvent.click(screen.getByRole('button', { name: /Get Values/ }));
    expect(screen.getByRole('button', { name: /Fetching…/ })).toBeDisabled();
    expect(await screen.findByText('Got 1/2. Retrying the rest…')).toBeInTheDocument();
    expect(api.calls('POST', '/api/equipment-groups/fetch-readings')[0].json).toEqual({ filterId: 'f1', groupId: 'ga', stageKey: 'WASH_IN' });
    // Submit stays disabled while a fetch is running.
    expect(submitBtn()).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(await screen.findByText('All readings fetched.')).toBeInTheDocument();
    expect(api.calls('POST', '/api/equipment-groups/fetch-readings')).toHaveLength(2);
    expect(screen.getAllByText('Auto · locked')).toHaveLength(2);
    const [a1] = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    expect(a1).toHaveAttribute('readonly');
    expect(a1.value).toBe('1.7');
    // A locked value ignores typing.
    fireEvent.change(a1, { target: { value: '1.9' } });
    expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value).toBe('1.7');
    fireEvent.click(submitBtn());
    expect(onSubmit).toHaveBeenCalledWith('ga', { a1: 1.7, a2: 5.25 });
  });

  it('after a minute without values: stepped instruments fall back to the dropdown, a stepless one stays typeable; retry clears it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = mockApi([
      { method: 'POST', path: '/api/equipment-groups/fetch-readings', times: 1, status: 500, body: { error: 'INTERNAL', message: 'gateway down' } },
      { method: 'POST', path: '/api/equipment-groups/fetch-readings', body: { results: [] } },
    ]);
    renderPage(<Host initial={mkDialog({ groups: [GA] })} online onSubmit={vi.fn()} />, { api });
    fireEvent.click(screen.getByRole('button', { name: /Auto Bay/ }));
    fireEvent.click(screen.getByRole('button', { name: /Get Values/ }));
    await waitFor(() => expect(api.calls('POST', '/api/equipment-groups/fetch-readings')).toHaveLength(1));
    for (let i = 0; i < 13; i++) await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(await screen.findByText("2 reading(s) couldn't be fetched in 1 minute — select them manually below.")).toBeInTheDocument();
    // a1 (least count 0.5) → dropdown; a2 (no least count, no options) → still a number box.
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
    const before = api.calls('POST', '/api/equipment-groups/fetch-readings').length;
    expect(before).toBeGreaterThanOrEqual(12);
    fireEvent.click(screen.getByRole('button', { name: /Get Values/ }));
    // Retrying puts the timed-out instrument back on the auto input.
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    await waitFor(() => expect(api.calls('POST', '/api/equipment-groups/fetch-readings').length).toBe(before + 1));
  });

  it('closing the dialog mid-fetch stops the poll loop', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = mockApi([{ method: 'POST', path: '/api/equipment-groups/fetch-readings', body: { results: [] } }]);
    renderPage(<Host initial={mkDialog({ groups: [GA] })} online onSubmit={vi.fn()} />, { api });
    fireEvent.click(screen.getByRole('button', { name: /Auto Bay/ }));
    fireEvent.click(screen.getByRole('button', { name: /Get Values/ }));
    await waitFor(() => expect(api.calls('POST', '/api/equipment-groups/fetch-readings')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'host-close' }));
    expect(screen.queryByText('Equipment & Pressure Readings')).toBeNull();
    for (let i = 0; i < 4; i++) await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(api.calls('POST', '/api/equipment-groups/fetch-readings')).toHaveLength(1);
  });

  it('closing via Cancel while the request is in flight drops its late result', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const api = mockApi([{ method: 'POST', path: '/api/equipment-groups/fetch-readings', body: { results: [{ instrumentId: 'a1', ok: true, value: 1.5 }] } }]);
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (...a: any[]) => { await gate; return (realFetch as any)(...a); }));
    renderPage(<Host initial={mkDialog({ groups: [GA] })} online onSubmit={vi.fn()} />, { api });
    fireEvent.click(screen.getByRole('button', { name: /Auto Bay/ }));
    fireEvent.click(screen.getByRole('button', { name: /Get Values/ }));
    fireEvent.click(within(screen.getByText('Equipment & Pressure Readings').closest('.rounded-2xl')!).getByRole('button', { name: 'Cancel' }));
    await act(async () => { release(); await gate; });
    await waitFor(() => expect(api.calls('POST', '/api/equipment-groups/fetch-readings')).toHaveLength(1));
    expect(screen.queryByText('Equipment & Pressure Readings')).toBeNull();
  });
});
