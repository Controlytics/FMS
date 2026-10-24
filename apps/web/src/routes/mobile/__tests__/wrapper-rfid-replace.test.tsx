/**
 * Tablet shell — the three write screens: RFID Assign (assign / replace /
 * remove a tag), Replace Filter (single + bulk, scan-to-select) and the
 * Replacement Schedule tasks. Every write goes through the REAL useReauth +
 * apiClient, so the request bodies, the re-auth header and the server's
 * refusals are exactly what the page sends and shows.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { clearGlobalSwrCache, type MockRequest } from '@/test-utils/page-harness';
import { useMobileLifecycle, flush, passReauth, cancelReauth, OPERATOR, SA } from './support/mobile-kit';
import { renderWrapper, INSTANCES, IDENTIFIERS, F102 } from './support/wrapper-harness';
import { setOnline, back, emitSync } from './support/fakes';

vi.mock('@/lib/connectivity', async () => (await import('./support/fakes')).connectivityModule);
vi.mock('@/lib/sync-engine', async () => (await import('./support/fakes')).syncEngineModule);
vi.mock('@/lib/sync-since', async () => (await import('./support/fakes')).syncSinceModule);
vi.mock('@/lib/offline-sync-service', async (orig) => ({ ...(await orig() as any), syncAllDataForOffline: (await import('./support/fakes')).fakeSyncAllDataForOffline }));
vi.mock('@capacitor/app', async () => (await import('./support/fakes')).capacitorAppModule);
vi.mock('../mobile-operations', () => ({ MobileOperationsPage: () => <div data-testid="ops" /> }));

useMobileLifecycle();

const REPLACER = { ...OPERATOR, permissions: [...OPERATOR.permissions!, 'FILTER_REPLACE'] };
const selectUnder = (label: string) =>
  screen.getAllByText(label, { selector: 'label' })[0].parentElement!.querySelector('select') as HTMLSelectElement;
const pick = (label: string, value: string) => fireEvent.change(selectUnder(label), { target: { value } });
const listNames = () => screen.queryAllByText(/^F-\d{3}$/, { selector: 'div.font-display' }).map((e) => e.textContent);

// ─── RFID Assign ──────────────────────────────────────────────────────────
async function openAssign(o: Parameters<typeof renderWrapper>[0] = {}) {
  const view = renderWrapper(o);
  fireEvent.click(await screen.findByRole('button', { name: /RFID Assign/ }));
  await screen.findByRole('heading', { name: 'Select filter' });
  await waitFor(() => expect(listNames().length).toBeGreaterThan(0));
  return view;
}
const tagInput = () => screen.getByPlaceholderText('Scan or enter tag value...');
const typeTag = (v: string) => fireEvent.change(tagInput(), { target: { value: v } });

describe('RFID Assign — choosing a filter', () => {
  it('lists only APPROVED live filters, coloured by whether they carry an RFID tag', async () => {
    await openAssign();
    expect(listNames()).toEqual(['F-101', 'F-102', 'F-201', 'F-301']); // F-302 awaits approval
    const row = (n: string) => screen.getByText(n, { selector: 'div.font-display' }).closest('button')! as HTMLElement;
    expect(row('F-101')).toHaveTextContent('Tag Assigned|E200A1');
    expect(row('F-101').className).toContain('emerald');
    expect(row('F-201')).toHaveTextContent('E200B2+1');
    expect(row('F-102')).toHaveTextContent('Tag Not Assigned');
    expect(row('F-301')).toHaveTextContent('Tag Not Assigned'); // a QR identifier is not an RFID tag
  });

  it('the cascade and the name search narrow the list; "clear" resets the cascade', async () => {
    await openAssign();
    expect(screen.getByText(/^showing/)).toHaveTextContent('showing 4 of 4');
    pick('Block', 'b1');
    expect(listNames()).toEqual(['F-101', 'F-102', 'F-201']);
    expect(screen.getByText(/^showing/)).toHaveTextContent('showing 3 of 4'); // of the whole list, not of itself
    expect([...selectUnder('Area').options].map((o) => o.textContent)).toEqual(['All', 'Clean Room A']);
    expect([...selectUnder('AHU').options].map((o) => o.textContent)).toEqual(['All', 'AHU-01', 'AHU-02']);
    pick('AHU', 'h2');
    expect(listNames()).toEqual(['F-201']);
    pick('Filter', 'f201');
    pick('AHU', 'h2'); // same AHU keeps the filter
    expect(selectUnder('Filter').value).toBe('f201');
    pick('AHU', 'h1'); // filter not under AHU-01 → reset
    expect(selectUnder('Filter').value).toBe('all');
    pick('Filter', 'f101');
    pick('Area', 'a1'); // F-101 is in Clean Room A → kept
    expect(listNames()).toEqual(['F-101']);
    pick('Block', 'b1'); // and in North → kept
    expect(selectUnder('Filter').value).toBe('f101');
    pick('Block', 'b2'); // not in South: area, AHU and filter reset
    expect(selectUnder('Area').value).toBe('all');
    expect(selectUnder('AHU').value).toBe('all');
    expect(selectUnder('Filter').value).toBe('all');
    expect(listNames()).toEqual(['F-301']);
    pick('AHU', 'h3');
    pick('Area', 'a1'); // AHU-03 is not in Clean Room A → reset
    expect(selectUnder('AHU').value).toBe('all');
    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    fireEvent.change(screen.getByPlaceholderText('Type to narrow…'), { target: { value: '20' } });
    expect(listNames()).toEqual(['F-201']);
    fireEvent.change(screen.getByPlaceholderText('Type to narrow…'), { target: { value: 'zzz' } });
    expect(screen.getByText('No filters match.')).toBeInTheDocument();
  });

  it('offline the tile is disabled', async () => {
    renderWrapper({ online: false });
    await screen.findByText('Scan stations');
    expect(screen.queryByRole('button', { name: /RFID Assign/ })).toBeNull();
    expect(screen.getByText('RFID Assign').parentElement).toHaveTextContent('offline');
    await flush();
  });
});

describe('RFID Assign — writing a tag', () => {
  it('assigns a scanned tag to an untagged filter (normalised: upper-case) and shows the full filter detail', async () => {
    const { api } = await openAssign({ routes: [{ method: 'POST', path: '/api/assets/identifiers', status: 201, body: { id: 'new' } }] });
    fireEvent.click(screen.getByText('F-102', { selector: 'div.font-display' }));
    const detail = screen.getByText('Selected Filter').closest('div.bg-white')! as HTMLElement;
    expect(detail).toHaveTextContent('BlockNorth');
    expect(detail).toHaveTextContent('AreaClean Room A');
    expect(detail).toHaveTextContent('AHUAHU-01');
    expect(detail).toHaveTextContent('SetNA');
    expect(detail).toHaveTextContent('Last Cleaned20/10/2026');
    expect(detail).toHaveTextContent('DRY IN');
    expect(screen.getByText('No RFID tag assigned yet.')).toBeInTheDocument();
    const assign = screen.getByRole('button', { name: 'Assign Tag' });
    expect(assign).toBeDisabled();
    typeTag('e200zz01');
    fireEvent.click(assign);
    expect(await screen.findByText('Tag assigned to "F-102"')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/identifiers')[0].json).toEqual({ assetId: 'f102', identifierType: 'RFID', identifierValue: 'E200ZZ01' });
    expect(tagInput()).toHaveValue('');
    await waitFor(() => expect(api.calls('GET', '/api/assets/identifiers').length).toBeGreaterThan(1));
  });

  it('Enter submits a scan; a stuttered (doubled) EPC is collapsed; the server\'s refusal is shown', async () => {
    const { api } = await openAssign({ routes: [{ method: 'POST', path: '/api/assets/identifiers', status: 409, body: { error: 'IDENTIFIER_EXISTS', message: 'Tag E200A1 is assigned to F-101' } }] });
    fireEvent.click(screen.getByText('F-102', { selector: 'div.font-display' }));
    fireEvent.keyDown(tagInput(), { key: 'Enter' }); // empty: nothing
    typeTag('E200A1E200A1');
    fireEvent.keyDown(tagInput(), { key: 'x' });
    expect(api.calls('POST', '/api/assets/identifiers')).toHaveLength(0);
    fireEvent.keyDown(tagInput(), { key: 'Enter' });
    expect(await screen.findByText('Tag E200A1 is assigned to F-101')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/identifiers')[0].json.identifierValue).toBe('E200A1');
    expect(screen.getByRole('button', { name: 'Assign Tag' })).toBeEnabled();
  });

  it('a filter that already has a tag: the same tag is pointed out, a new one asks to REPLACE (replaceExisting)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-10-21T10:00:00Z');
    vi.setSystemTime(t0);
    const { api } = await openAssign({ routes: [{ method: 'POST', path: '/api/assets/identifiers', status: 201, body: {} }] });
    fireEvent.click(screen.getByText('F-101', { selector: 'div.font-display' }));
    expect(screen.getByText('E200A1', { selector: 'div.font-mono' })).toBeInTheDocument();
    typeTag('e200a1');
    fireEvent.click(screen.getByRole('button', { name: 'Replace Tag' }));
    expect(screen.getByText('Tag E200A1 is already assigned to this filter.')).toBeInTheDocument();
    vi.setSystemTime(new Date(t0.getTime() + 2000));
    typeTag('E200NEW1');
    fireEvent.click(screen.getByRole('button', { name: 'Replace Tag' }));
    const confirm = screen.getByTestId('rfid-replace-confirm');
    expect(confirm).toHaveTextContent('F-101 already has tag E200A1. Replace it with E200NEW1?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('rfid-replace-confirm')).toBeNull();
    expect(tagInput()).toHaveValue('');
    // a second scan reopens it; typing dismisses it
    vi.setSystemTime(new Date(t0.getTime() + 4000));
    typeTag('E200NEW2');
    fireEvent.keyDown(tagInput(), { key: 'Enter' });
    expect(screen.getByTestId('rfid-replace-confirm')).toBeInTheDocument();
    typeTag('E200NEW3');
    expect(screen.queryByTestId('rfid-replace-confirm')).toBeNull();
    vi.setSystemTime(new Date(t0.getTime() + 6000));
    fireEvent.keyDown(tagInput(), { key: 'Enter' });
    vi.setSystemTime(new Date(t0.getTime() + 6100));
    fireEvent.keyDown(tagInput(), { key: 'Enter' }); // the scanner double-fires: still ignored
    expect(api.calls('POST', '/api/assets/identifiers')).toHaveLength(0);
    // A deliberate tap on Replace Tag is never a scanner double-fire, however
    // soon after the scan it comes.
    vi.setSystemTime(new Date(t0.getTime() + 6500));
    fireEvent.click(within(screen.getByTestId('rfid-replace-confirm')).getByRole('button', { name: 'Replace Tag' }));
    expect(await screen.findByText('Tag E200A1 replaced by E200NEW3 on "F-101"')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/identifiers')[0].json).toEqual({ assetId: 'f101', identifierType: 'RFID', identifierValue: 'E200NEW3', replaceExisting: true });
  });

  it('removes a tag; a refused removal is shown', async () => {
    const { api } = await openAssign({ routes: [
      { method: 'DELETE', path: '/api/assets/identifiers/i2', body: {} },
      { method: 'DELETE', path: '/api/assets/identifiers/i3', status: 403, body: { error: 'FORBIDDEN', message: 'Not allowed to remove tags' } },
    ] });
    fireEvent.click(screen.getByText('F-201', { selector: 'div.font-display' }));
    const removes = screen.getAllByRole('button', { name: 'Remove' });
    expect(removes).toHaveLength(2);
    fireEvent.click(removes[0]);
    expect(await screen.findByText('Tag removed')).toBeInTheDocument();
    expect(api.calls('DELETE', '/api/assets/identifiers/i2')).toHaveLength(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]);
    expect(await screen.findByText('Not allowed to remove tags')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(await screen.findByRole('heading', { name: 'Select filter' })).toBeInTheDocument();
  });

  it('with re-auth on, assign and remove are signed with the password; a dismissed prompt is silent and frees the buttons', async () => {
    const { api } = await openAssign({
      reauthActions: ['CREATE_ASSET_IDENTIFIER', 'DELETE_ASSET_IDENTIFIER'],
      routes: [
        { method: 'POST', path: '/api/assets/identifiers', status: 201, body: {} },
        { method: 'DELETE', path: '/api/assets/identifiers/i1', body: {} },
      ],
    });
    fireEvent.click(screen.getByText('F-102', { selector: 'div.font-display' }));
    typeTag('E200SIG1');
    fireEvent.click(screen.getByRole('button', { name: 'Assign Tag' }));
    expect(await screen.findByText(/Assign RFID Tag/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assigning...' })).toBeDisabled();
    await cancelReauth();
    // A dismissed prompt is not an error (D-OPS-8): no message, the button is free again.
    expect(await screen.findByRole('button', { name: 'Assign Tag' })).toBeEnabled();
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(api.calls('POST', '/api/assets/identifiers')).toHaveLength(0);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2000);
    fireEvent.click(screen.getByRole('button', { name: 'Assign Tag' }));
    await passReauth();
    expect(await screen.findByText('Tag assigned to "F-102"')).toBeInTheDocument();
    const post = api.calls('POST', '/api/assets/identifiers')[0];
    expect(post.headers['x-reauth-password']).toBe('Secret@123');
    expect(post.json._currentPassword).toBe('Secret@123');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.click(await screen.findByText('F-101', { selector: 'div.font-display' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(/Remove RFID Tag/)).toBeInTheDocument();
    await cancelReauth(); // silent too, and Remove is usable again
    expect(await screen.findByRole('button', { name: 'Remove' })).toBeEnabled();
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(api.calls('DELETE', '/api/assets/identifiers/i1')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await passReauth();
    expect(await screen.findByText('Tag removed')).toBeInTheDocument();
    expect(api.calls('DELETE', '/api/assets/identifiers/i1')[0].headers['x-reauth-password']).toBe('Secret@123');
  });

  it('the Android back button cancels an open password prompt first', async () => {
    await openAssign({ reauthActions: ['CREATE_ASSET_IDENTIFIER'] });
    fireEvent.click(screen.getByText('F-102', { selector: 'div.font-display' }));
    typeTag('E200BACK');
    fireEvent.click(screen.getByRole('button', { name: 'Assign Tag' }));
    await screen.findByPlaceholderText('Enter your password');
    await waitFor(() => expect(back.handler).toBeTypeOf('function'));
    await act(async () => { back.handler!(); });
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(screen.getByRole('button', { name: 'Assign Tag' })).toBeEnabled();
    expect(screen.getByText('Selected Filter')).toBeInTheDocument(); // still on the view
    await act(async () => { back.handler!(); });
    expect(await screen.findByText('Scan stations')).toBeInTheDocument();
  });
});

// ─── Replace Filter ───────────────────────────────────────────────────────
async function openReplace(o: Parameters<typeof renderWrapper>[0] = {}) {
  const view = renderWrapper({ user: REPLACER, ...o });
  fireEvent.click(await screen.findByRole('button', { name: /Replace Filter/ }));
  await screen.findByRole('heading', { name: 'Replace — select filter' });
  await waitFor(() => expect(listNames().length).toBeGreaterThan(0));
  return view;
}
const replaceScanInput = () => screen.getByPlaceholderText('Scan or type RFID/QR tag, then Enter');

describe('Replace Filter — access', () => {
  it('needs FILTER_REPLACE (or SUPER_ADMIN); offline the tile is disabled', async () => {
    renderWrapper();
    await screen.findByText('Scan stations');
    expect(screen.queryByText('Replace Filter')).toBeNull();
    await flush();
  });
  it('SUPER_ADMIN sees it; offline it says it needs a connection', async () => {
    renderWrapper({ user: SA, online: false });
    expect(await screen.findByText('Replace Filter')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Replace Filter/ })).toBeNull();
    expect(screen.getAllByText('offline — needs connection')).toHaveLength(2);
    await flush();
  });
});

describe('Replace Filter — single', () => {
  it('scan-to-select opens the confirm panel; Replace sends the remarks and reports the new filter', async () => {
    const { api } = await openReplace({ routes: [
      { method: 'POST', path: '/api/filters/f101/replace', body: { success: true, newFilterName: 'F-101-R1', identifiersMoved: 1 } },
    ] });
    fireEvent.keyDown(replaceScanInput(), { key: 'Enter' }); // blank: nothing
    fireEvent.change(replaceScanInput(), { target: { value: 'nope' } });
    fireEvent.keyDown(replaceScanInput(), { key: 'Enter' });
    expect(screen.getByText(/No filter found for tag "NOPE"/)).toBeInTheDocument();
    fireEvent.change(replaceScanInput(), { target: { value: 'e200a1' } });
    fireEvent.keyDown(replaceScanInput(), { key: 'Enter' });
    expect(await screen.findByRole('heading', { name: 'Replace filter' })).toBeInTheDocument();
    const panel = screen.getByText('Filter ID').closest('div.bg-white')! as HTMLElement;
    expect(panel).toHaveTextContent('F-101');
    expect(panel).toHaveTextContent('WASH IN');
    expect(panel).toHaveTextContent('AHU TypeRecirc');
    expect(panel).toHaveTextContent('Filter TypeHEPA');
    expect(panel).toHaveTextContent('SetSet A');
    expect(panel).toHaveTextContent('Dimensions610x610');
    expect(panel).toHaveTextContent('Micron Size0.3');
    // the server's last-cleaned (instances row), never re-derived from a cycle read
    await waitFor(() => expect(panel).toHaveTextContent('Last Cleaned20/10/2026'));
    expect(api.calls('GET', '/api/filters/cycles')).toEqual([]);
    expect(panel).toHaveTextContent('RFID tag (carries over)E200A1');
    const go = screen.getByRole('button', { name: 'Replace Filter' });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Reason for replacement…'), { target: { value: '  Torn media  ' } });
    fireEvent.click(go);
    expect(await screen.findByText('"F-101" replaced → F-101-R1 · tag carried over')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f101/replace')[0].json).toEqual({ remarks: 'Torn media' });
    expect(screen.getByRole('heading', { name: 'Replace — select filter' })).toBeInTheDocument();
  });

  it('picking from the list; a refusal is shown; back and Cancel return to the list', async () => {
    await openReplace({ routes: [{ method: 'POST', path: '/api/filters/f102/replace', status: 409, body: { error: 'DUPLICATE_FILTER_NAME', message: 'F-102-R1 already exists' } }] });
    fireEvent.click(screen.getByText('F-102', { selector: 'div.font-display' }));
    expect(screen.getByText('Filter ID').closest('div.bg-white')).toHaveTextContent('none assigned');
    fireEvent.change(screen.getByPlaceholderText('Reason for replacement…'), { target: { value: 'Damaged' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace Filter' }));
    expect(await screen.findByText('F-102-R1 already exists')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back to list/ }));
    expect(await screen.findByRole('heading', { name: 'Replace — select filter' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('F-201', { selector: 'div.font-display' }));
    expect(screen.getByText('Filter ID').closest('div.bg-white')).toHaveTextContent('E200B2, E200B3');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Replace — select filter' })).toBeInTheDocument();
  });

  it('with re-auth on, a dismissed password prompt is silent and leaves Replace usable (D-OPS-8)', async () => {
    const { api } = await openReplace({ reauthActions: ['REPLACE_FILTER'], routes: [{ method: 'POST', path: '/api/filters/f301/replace', body: { success: true, newFilterName: 'F-301-R1' } }] });
    fireEvent.click(screen.getByText('F-301', { selector: 'div.font-display' }));
    fireEvent.change(screen.getByPlaceholderText('Reason for replacement…'), { target: { value: 'End of life' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace Filter' }));
    await cancelReauth();
    expect(await screen.findByRole('button', { name: 'Replace Filter' })).toBeEnabled();
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(api.calls('POST', '/api/filters/f301/replace')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Replace Filter' }));
    await passReauth();
    expect(await screen.findByText('"F-301" replaced → F-301-R1')).toBeInTheDocument();
  });

  it('a replacement with no tag moved and no new name says so plainly', async () => {
    await openReplace({ routes: [{ method: 'POST', path: '/api/filters/f301/replace', body: { success: true } }] });
    fireEvent.click(screen.getByText('F-301', { selector: 'div.font-display' }));
    fireEvent.change(screen.getByPlaceholderText('Reason for replacement…'), { target: { value: 'End of life' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace Filter' }));
    expect(await screen.findByText('"F-301" replaced → new filter')).toBeInTheDocument();
  });

  it('going offline mid-way disables the replace and says why', async () => {
    await openReplace();
    fireEvent.click(screen.getByText('F-102', { selector: 'div.font-display' }));
    fireEvent.change(screen.getByPlaceholderText('Reason for replacement…'), { target: { value: 'Damaged' } });
    await act(async () => { setOnline(false); });
    expect(screen.getByRole('button', { name: 'Replace Filter' })).toBeDisabled();
    expect(screen.getByText('Offline — replacement needs a connection.')).toBeInTheDocument();
  });

  it('the cascade resets everything below the level that changed', async () => {
    await openReplace();
    pick('Block', 'b1');
    pick('Area', 'a1');
    pick('AHU', 'h1');
    pick('Filter', 'f102');
    expect(listNames()).toEqual(['F-102']);
    pick('AHU', 'h1');
    expect(selectUnder('Filter').value).toBe('all');
    pick('Filter', 'f101');
    pick('Area', 'a1');
    expect(selectUnder('AHU').value).toBe('all');
    expect(selectUnder('Filter').value).toBe('all');
    pick('Block', 'b2');
    expect(selectUnder('Area').value).toBe('all');
    expect(listNames()).toEqual(['F-301']);
    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    expect(listNames()).toHaveLength(4);
    expect(screen.getByText(/^showing/)).toHaveTextContent('showing 4 of 4');
    fireEvent.change(screen.getByPlaceholderText('Type to narrow…'), { target: { value: 'q' } });
    expect(screen.getByText('No filters match.')).toBeInTheDocument();
    expect(screen.getByText(/^showing/)).toHaveTextContent('showing 0 of 4');
  });
});

describe('Replace Filter — bulk', () => {
  it('ticks build a batch; one remarks, one signature; per-filter refusals are listed and the rest still go', async () => {
    const { api } = await openReplace({
      reauthActions: ['REPLACE_FILTER'],
      routes: [
        { method: 'POST', path: '/api/filters/f101/replace', body: { success: true, identifiersMoved: 1 } },
        { method: 'POST', path: '/api/filters/f102/replace', body: { success: true } },
        { method: 'POST', path: '/api/filters/f201/replace', body: { success: true, identifiersMoved: 2 } },
        { method: 'POST', path: '/api/filters/f301/replace', status: 409, body: { error: 'DUPLICATE_FILTER_NAME', message: 'F-301-R1 exists' } },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Select all (4)' }));
    expect(screen.getByText('4 filters selected for replacement')).toBeInTheDocument();
    const go = screen.getByRole('button', { name: 'Replace 4 selected' });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/applies to every selected filter/), { target: { value: 'Annual swap' } });
    fireEvent.click(go);
    expect(await screen.findByText(/Replace Filter/, { selector: 'span, p, div, strong' })).toBeInTheDocument();
    await passReauth();
    expect(await screen.findByText('3 filters replaced · 2 tags carried over')).toBeInTheDocument();
    expect(screen.getByText('1 not replaced — F-301: F-301-R1 exists')).toBeInTheDocument();
    for (const id of ['f101', 'f102', 'f201', 'f301']) {
      const req = api.calls('POST', `/api/filters/${id}/replace`)[0];
      expect(req.json).toEqual({ remarks: 'Annual swap', _currentPassword: 'Secret@123' });
    }
    // with a failure the remarks are kept for the retry; the ticks are cleared
    expect(screen.queryByText(/selected for replacement/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select F-301' }));
    expect(screen.getByPlaceholderText(/applies to every selected filter/)).toHaveValue('Annual swap');
  });

  it('a clean single-filter batch reads in the singular and clears the remarks; Clear and narrowing drop ticks', async () => {
    await openReplace({ routes: [{ method: 'POST', path: '/api/filters/f102/replace', body: { success: true, identifiersMoved: 1 } }] });
    fireEvent.click(screen.getByRole('button', { name: 'Select F-101' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select F-101' })); // untick
    expect(screen.queryByText(/selected for replacement/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select F-101' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText(/selected for replacement/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select F-101' }));
    fireEvent.change(screen.getByPlaceholderText('Type to narrow…'), { target: { value: 'F-1' } }); // narrowing clears ticks
    expect(screen.queryByText(/selected for replacement/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select all (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select F-102' }));
    expect(screen.getByText('1 filter selected for replacement')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/applies to every selected filter/), { target: { value: 'Swap' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace 1 selected' }));
    expect(await screen.findByText('1 filter replaced · 1 tag carried over')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select F-101' }));
    expect(screen.getByPlaceholderText(/applies to every selected filter/)).toHaveValue('');
  });

  it('a filter the server refuses with no message is still named', async () => {
    await openReplace();
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      if (String(input).includes('/replace')) throw {};
      return (real as any)(input, init);
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Select F-102' }));
    fireEvent.change(screen.getByPlaceholderText(/applies to every selected filter/), { target: { value: 'Swap' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace 1 selected' }));
    expect(await screen.findByText('1 not replaced — F-102: failed')).toBeInTheDocument();
  });

  it('a server that asks for the password mid-batch gets it, and the batch is re-run from the top', async () => {
    const { api } = await openReplace({ routes: [
      { method: 'POST', path: '/api/filters/f101/replace', status: 401, times: 1, body: { error: 'REAUTH_REQUIRED', message: 'Re-authentication required' } },
      { method: 'POST', path: '/api/filters/f101/replace', body: { success: true } },
    ] });
    fireEvent.click(screen.getByRole('button', { name: 'Select F-101' }));
    fireEvent.change(screen.getByPlaceholderText(/applies to every selected filter/), { target: { value: 'Swap' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace 1 selected' }));
    await passReauth();
    expect(await screen.findByText('1 filter replaced')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f101/replace')).toHaveLength(2);
  });

  it('cancelling the password prompt frees the button', async () => {
    await openReplace({ reauthActions: ['REPLACE_FILTER'] });
    fireEvent.click(screen.getByRole('button', { name: 'Select F-101' }));
    fireEvent.change(screen.getByPlaceholderText(/applies to every selected filter/), { target: { value: 'Swap' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace 1 selected' }));
    expect(await screen.findByRole('button', { name: 'Replacing…' })).toBeDisabled();
    await cancelReauth();
    expect(await screen.findByRole('button', { name: 'Replace 1 selected' })).toBeEnabled();
  });
});

// ─── Replacement Schedule tasks ───────────────────────────────────────────
const RT_DUE = { id: 'rt1', ahuId: 'h1', ahuName: 'AHU-01', computedStatus: 'DUE', filterMicron: '0.3', filterSize: { x: 1 }, windowEnd: '2026-10-30', qty: 3, qtyRemaining: 2, total: 3, replaced: 1, replacedNewFilterIds: ['f999'] };
const RT_MISSED = { id: 'rt2', ahuId: 'h3', ahuName: 'AHU-03', computedStatus: 'MISSED', filterMicron: null, filterSize: '[object Object]', windowEnd: null, qty: 1, qtyRemaining: 1, replaced: 0 };
const RT_ODD = { id: 'rt3', ahuId: 'h2', ahuName: 'AHU-02', computedStatus: 'SOMETHING', qty: 1, replaced: 0, replacedNewFilterIds: ['f201'] };
const RT_DONE = { id: 'rt4', ahuId: 'h1', ahuName: 'AHU-01', computedStatus: 'COMPLETED', windowEnd: '2026-09-30', qty: 2, qtyRemaining: 0, total: 2, replaced: 2 };

async function openTasks(o: Parameters<typeof renderWrapper>[0] = {}) {
  const tasks = o.replTasks ?? [RT_DUE, RT_MISSED, RT_ODD, RT_DONE];
  const view = renderWrapper({ ...o, replTasks: tasks });
  const tileBtn = await screen.findByRole('button', { name: /Replacement Tasks/ });
  const pending = tasks.filter((t) => t.computedStatus !== 'COMPLETED').length;
  await waitFor(() => expect(tileBtn).toHaveTextContent(String(pending)));
  fireEvent.click(tileBtn);
  await screen.findByRole('heading', { name: 'Replacement Tasks' });
  return view;
}
const taskButton = (ahu: string) => screen.getAllByText(ahu, { selector: 'div.font-display' })[0].closest('button')! as HTMLElement;

describe('Replacement tasks — list', () => {
  it('Pending and Completed tabs with status, spec (NA when missing), due date and how many are left', async () => {
    await openTasks();
    expect(screen.getByRole('button', { name: 'Pending (3)' })).toBeInTheDocument();
    expect(taskButton('AHU-01')).toHaveTextContent('Due');
    expect(taskButton('AHU-01')).toHaveTextContent('micron 0.3 · dimensions NA');
    expect(taskButton('AHU-01')).toHaveTextContent('due by 30/10/2026');
    expect(taskButton('AHU-01')).toHaveTextContent('2 of 3 left');
    expect(taskButton('AHU-03')).toHaveTextContent('Overdue');
    expect(taskButton('AHU-03')).toHaveTextContent('micron NA · dimensions NA');
    expect(taskButton('AHU-03')).toHaveTextContent('due by —');
    expect(taskButton('AHU-02')).toHaveTextContent('Upcoming');
    fireEvent.click(screen.getByRole('button', { name: 'Completed (1)' }));
    expect(taskButton('AHU-01')).toHaveTextContent('scheduled 30/09/2026');
    expect(taskButton('AHU-01')).toHaveTextContent('2/2 done');
    expect(taskButton('AHU-01')).toBeDisabled();
    fireEvent.click(screen.getAllByRole('button', { name: /Home/ }).find((b) => b.className.includes('text-[12px]'))!);
    expect(await screen.findByText('Scan stations')).toBeInTheDocument();
  });

  it('empty tabs say so', async () => {
    renderWrapper();
    fireEvent.click(await screen.findByRole('button', { name: /Replacement Tasks/ }));
    expect(await screen.findByText('No pending replacement tasks.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Completed (0)' }));
    expect(screen.getByText('No completed replacement tasks yet.')).toBeInTheDocument();
  });
});

describe('Replacement tasks — performing one', () => {
  it('lists the AHU\'s still-to-replace filters with details; select up to the quantity left; replace them', async () => {
    const { api } = await openTasks({ routes: [
      { method: 'POST', path: '/api/replacement-schedules/entries/rt1/execute', body: (r: MockRequest) => ({ ok: true, echo: r.json }) },
    ] });
    fireEvent.click(taskButton('AHU-01'));
    expect(await screen.findByText('2 of 3 filters still to replace')).toBeInTheDocument();
    expect(screen.getByText('1 already replaced for this task')).toBeInTheDocument();
    expect(screen.getByText(/scheduled spec: micron 0\.3 · dimensions NA/)).toBeInTheDocument();
    const cand = (n: string) => screen.getByText(n, { selector: 'div.font-display' }).closest('button')! as HTMLElement;
    expect(cand('F-101')).toHaveTextContent('Make: Camfil');
    expect(cand('F-101')).toHaveTextContent('Dimensions: 610x610');
    expect(cand('F-101')).toHaveTextContent('Micron: 0.3');
    expect(cand('F-101')).toHaveTextContent('AHU Type: Recirc');
    expect(cand('F-101')).not.toHaveTextContent('Note'); // objects are not shown
    expect(cand('F-101')).toHaveTextContent('Tag: E200A1');
    expect(cand('F-102')).toHaveTextContent('Tag: none');
    const go = screen.getByRole('button', { name: 'Select filters to replace' });
    expect(go).toBeDisabled();
    fireEvent.click(cand('F-101'));
    fireEvent.click(cand('F-101'));
    fireEvent.click(screen.getByRole('button', { name: 'Select all (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(cand('F-101'));
    fireEvent.click(cand('F-102'));
    fireEvent.change(screen.getByPlaceholderText('Replaced via schedule task (AHU AHU-01)'), { target: { value: '  Media torn  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace 2 selected filters' }));
    expect(await screen.findByText('2 filters replaced (AHU AHU-01) · tags carried over')).toBeInTheDocument();
    const calls = api.calls('POST', '/api/replacement-schedules/entries/rt1/execute');
    expect(calls.map((c) => c.json)).toEqual([{ oldFilterId: 'f101', remarks: 'Media torn' }, { oldFilterId: 'f102', remarks: 'Media torn' }]);
    expect(screen.getByRole('button', { name: 'Pending (3)' })).toBeInTheDocument(); // back on the list
  });

  it('at the cap the other filters cannot be ticked; a partial failure keeps the task open with the reason', async () => {
    const one = { ...RT_DUE, qtyRemaining: 1 };
    await openTasks({ replTasks: [one], routes: [
      { method: 'POST', path: '/api/replacement-schedules/entries/rt1/execute', status: 409, body: { error: 'X', message: 'Already replaced' } },
    ] });
    fireEvent.click(taskButton('AHU-01'));
    const cand = (n: string) => screen.getByText(n, { selector: 'div.font-display' }).closest('button')! as HTMLElement;
    fireEvent.click(cand('F-101'));
    expect(cand('F-102')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Replace 1 selected filter' }));
    expect(await screen.findByText('Replaced 0, 1 failed — F-101: Already replaced')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 filters still to replace')).toBeInTheDocument();
  });

  it('search narrows the candidates; an AHU with nothing left says so', async () => {
    await openTasks();
    fireEvent.click(taskButton('AHU-01'));
    fireEvent.change(await screen.findByPlaceholderText('Search by filter name…'), { target: { value: '102' } });
    expect(screen.queryByText('F-101', { selector: 'div.font-display' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search by filter name…'), { target: { value: 'zzz' } });
    expect(screen.getByText('No filters match your search.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back to tasks/ }));
    fireEvent.click(taskButton('AHU-02')); // its only filter was already replaced under this task
    expect(await screen.findByText('No active filters found under this AHU.')).toBeInTheDocument();
    expect(screen.getByText('1 of 1 filters still to replace')).toBeInTheDocument();
  });

  // 2026-10-24 (operator): a scan SELECTS its filter and moves it to the top of
  // the list; nothing is replaced until Replace is tapped. It used to replace
  // the scanned filter at once.
  const F103 = { id: 'f103', name: 'F-103', templateId: 'tpl-filter', parentId: 'h1', attributes: {} };
  const F104 = { id: 'f104', name: 'F-104', templateId: 'tpl-filter', parentId: 'h1', approvalStatus: 'PENDING_REVIEW', attributes: {} };
  const F105 = { id: 'f105', name: 'F-105', templateId: 'tpl-filter', parentId: 'h1', attributes: {} };
  const tag = (id: string, value: string, f: { id: string; name: string }) =>
    ({ id, identifierType: 'RFID', identifierValue: value, assetId: f.id, asset: { id: f.id, name: f.name } });
  const scanOpts = (routes: any[] = []) => ({
    instances: [...INSTANCES, F103, F104, F105],
    identifiers: [...IDENTIFIERS, tag('i7', 'E200A2', F102), tag('i8', 'E200A3', F103), tag('i9', 'E200A4', F104), tag('i10', 'E200A5', F105)],
    // F-103 is already replaced for this task, so it is not offered.
    replTasks: [{ ...RT_DUE, replacedNewFilterIds: ['f103'] }],
    routes,
  });
  const listed = () => screen.getAllByText(/^F-\d+$/, { selector: 'div.font-display' }).map((el) => el.textContent);
  const scanTag = async (value: string) => {
    const scan = await screen.findByPlaceholderText("Scan or type the old filter's tag, then Enter");
    fireEvent.change(scan, { target: { value } });
    fireEvent.keyDown(scan, { key: 'Enter' });
  };

  it('a scan selects its filter and pins it to the top; Replace sends the selection; every refusal names the filter', async () => {
    const { api } = await openTasks({ reauthActions: ['REPLACE_FILTER'], ...scanOpts([
      { method: 'POST', path: '/api/replacement-schedules/entries/rt1/execute', body: { ok: true } },
    ]) });
    fireEvent.click(taskButton('AHU-01'));
    expect(await screen.findByText('Scan filter to select')).toBeInTheDocument();
    expect(listed()).toEqual(['F-101', 'F-102', 'F-105']); // by name

    await scanTag('');
    expect(screen.getByText('Scan a filter tag to select it.')).toBeInTheDocument();
    await scanTag('ZZZ');
    expect(screen.getByText('No filter found for tag "ZZZ".')).toBeInTheDocument();
    await scanTag('E200H1');
    expect(screen.getByText('Tag "E200H1" belongs to AHU-01, which is not a filter.')).toBeInTheDocument();
    await scanTag('E200B2');
    expect(screen.getByText("F-201 is not in AHU-01 — this task covers that AHU's filters only.")).toBeInTheDocument();
    await scanTag('E200A3');
    expect(screen.getByText('F-103 is already replaced for this task.')).toBeInTheDocument();
    await scanTag('E200A4');
    expect(screen.getByText('F-104 has not been approved yet, so it cannot be replaced.')).toBeInTheDocument();

    // A name search that hides the scanned filter is cleared by the scan.
    fireEvent.change(screen.getByPlaceholderText('Search by filter name…'), { target: { value: '101' } });
    await scanTag('e200a5');
    expect(screen.queryByText('F-104 has not been approved yet, so it cannot be replaced.')).toBeNull(); // the error clears
    expect(screen.getByPlaceholderText('Search by filter name…')).toHaveValue('');
    expect(listed()).toEqual(['F-105', 'F-101', 'F-102']);
    await scanTag('E200A2');
    expect(listed()).toEqual(['F-102', 'F-105', 'F-101']); // newest scan on top
    expect(screen.getByRole('button', { name: 'Replace 2 selected filters' })).toBeInTheDocument();
    await scanTag('E200A1');
    expect(screen.getByText('Only 2 filters still to replace — untick one to select F-101.')).toBeInTheDocument();
    await scanTag('E200A5'); // already selected: just back on top
    expect(listed()).toEqual(['F-105', 'F-102', 'F-101']);

    // Unticking unpins.
    fireEvent.click(screen.getByText('F-102', { selector: 'div.font-display' }).closest('button')!);
    expect(listed()).toEqual(['F-105', 'F-101', 'F-102']);
    expect(api.calls('POST', '/api/replacement-schedules/entries/rt1/execute')).toHaveLength(0); // scans replace nothing

    fireEvent.click(screen.getByRole('button', { name: 'Replace 1 selected filter' }));
    await passReauth();
    expect(await screen.findByText('1 filter replaced (AHU AHU-01) · tags carried over')).toBeInTheDocument();
    expect(api.calls('POST', '/api/replacement-schedules/entries/rt1/execute').map((c) => c.json)).toEqual([
      { oldFilterId: 'f105', remarks: 'Replaced via schedule task (AHU AHU-01)', _currentPassword: 'Secret@123' },
    ]);
  });

  it('a refused replacement of a scanned filter shows the reason and stays on the task', async () => {
    await openTasks(scanOpts([
      { method: 'POST', path: '/api/replacement-schedules/entries/rt1/execute', status: 422, body: { error: 'X', message: 'Filter is not under this AHU' } },
    ]));
    fireEvent.click(taskButton('AHU-01'));
    await scanTag('E200A1');
    fireEvent.click(screen.getByRole('button', { name: 'Replace 1 selected filter' }));
    expect(await screen.findByText('Replaced 0, 1 failed — F-101: Filter is not under this AHU')).toBeInTheDocument();
    expect(screen.getByText('2 of 3 filters still to replace')).toBeInTheDocument();
  });

  it('a batch whose password prompt is dismissed sends nothing and says nothing (D-OPS-8)', async () => {
    const { api } = await openTasks({ reauthActions: ['REPLACE_FILTER'] });
    fireEvent.click(taskButton('AHU-01'));
    fireEvent.click(await screen.findByText('F-102', { selector: 'div.font-display' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace 1 selected filter' }));
    await cancelReauth();
    expect(await screen.findByRole('button', { name: 'Replace 1 selected filter' })).toBeEnabled();
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(api.calls('POST', '/api/replacement-schedules/entries/rt1/execute')).toHaveLength(0);
  });

  it('a password demanded mid-batch re-runs the whole batch with the password', async () => {
    const { api } = await openTasks({ routes: [
      { method: 'POST', path: '/api/replacement-schedules/entries/rt1/execute', status: 401, times: 1, body: { error: 'REAUTH_REQUIRED', message: 'Re-authentication required' } },
      { method: 'POST', path: '/api/replacement-schedules/entries/rt1/execute', body: { ok: true } },
    ] });
    fireEvent.click(taskButton('AHU-01'));
    fireEvent.click(await screen.findByText('F-102', { selector: 'div.font-display' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace 1 selected filter' }));
    await passReauth();
    expect(await screen.findByText('1 filter replaced (AHU AHU-01) · tags carried over')).toBeInTheDocument();
    expect(api.calls('POST', '/api/replacement-schedules/entries/rt1/execute')).toHaveLength(2);
  });
});

describe('master data is refreshed after a write (global SWR cache)', () => {
  // These pages refresh /api/assets/instances through swr's GLOBAL mutate(key);
  // only a render on the default cache can see that request. The page is
  // unmounted before the shared cache is emptied, so nothing re-renders.
  const headerBack = () => screen.getAllByRole('button').find((b) => b.querySelector('path[d="M15 19l-7-7 7-7"]'))!;

  it('a replacement re-reads the filter list, so the retired filter drops out', async () => {
    await clearGlobalSwrCache();
    const view = await openReplace({ globalCache: true, routes: [{ method: 'POST', path: '/api/filters/f102/replace', body: { success: true, newFilterName: 'F-102-R1' } }] });
    fireEvent.click(screen.getByText('F-102', { selector: 'div.font-display' }));
    fireEvent.change(screen.getByPlaceholderText('Reason for replacement…'), { target: { value: 'Damaged' } });
    const before = view.api.calls('GET', '/api/assets/instances').length;
    fireEvent.click(screen.getByRole('button', { name: 'Replace Filter' }));
    expect(await screen.findByText('"F-102" replaced → F-102-R1')).toBeInTheDocument();
    await waitFor(() => expect(view.api.calls('GET', '/api/assets/instances').length).toBeGreaterThan(before));
    await flush(60);
    view.unmount();
    await clearGlobalSwrCache();
  });

  it('returning Home, and a completed operation sync, re-read it too', async () => {
    await clearGlobalSwrCache();
    const view = renderWrapper({ globalCache: true });
    fireEvent.click(await screen.findByRole('button', { name: /Filter Cleaning Record/ }));
    await screen.findByRole('heading', { name: 'Filter Cleaning Record' });
    await flush(60);
    const count = () => view.api.calls('GET', '/api/assets/instances').length;
    const before = count();
    fireEvent.click(headerBack());
    await waitFor(() => expect(count()).toBeGreaterThan(before));
    const afterHome = count();
    await act(async () => { emitSync({ type: 'complete', synced: 2 }); });
    await waitFor(() => expect(count()).toBeGreaterThan(afterHome));
    await flush(60);
    view.unmount();
    await clearGlobalSwrCache();
  });
});
