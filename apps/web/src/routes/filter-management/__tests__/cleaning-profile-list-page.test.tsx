import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, role, passReauth, expectSigned, type BaseRouteOpts } from './fm-test-kit';
import { CleaningProfileListPage } from '../cleaning-profile-list';

usePageTestLifecycle();

const PROFILES = [
  { id: 'p1', name: 'WET CLEAN', version: 3, flowMode: 'STRICT', status: 'ACTIVE', stageCount: 6, connectionCount: 7 },
  { id: 'p2', name: 'DRY STORAGE', version: 1, flowMode: 'FLEXIBLE', status: 'DRAFT', stageCount: 2, connectionCount: 3 },
  { id: 'p3', name: 'LEGACY', version: 2, flowMode: 'CUSTOM', status: 'INACTIVE', stageCount: 4, connectionCount: 4 },
  { id: 'p4', name: 'LINEAR ONE', version: 1, flowMode: 'LINEAR', status: 'ACTIVE', stageCount: 1, connectionCount: 1 },
];
const page = (data: any[], total = data.length, totalPages = 1) => ({ data, total, page: 1, limit: 10, totalPages });

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}</p>; }
const ui = () => <><CleaningProfileListPage /><Where /></>;

function setup(extra: MockRoute[] = [], base: BaseRouteOpts = {}, body: any = page(PROFILES, 4)) {
  return mockApi([...extra, { path: '/api/filter-cleaning-profiles', body }, ...baseRoutes(base)]);
}
const lastList = (api: ReturnType<typeof setup>) => api.calls('GET', '/api/filter-cleaning-profiles').at(-1)!;
const card = (name: string) => screen.getByRole('heading', { name }).closest('.rounded-2xl') as HTMLElement;

describe('Cleaning Profiles list', () => {
  it('cards show version, flow mode, stage/connection counts and status; stats sum the page', async () => {
    const api = setup();
    renderPage(ui(), { user: SA, route: '/filter-cleaning-profiles', api });
    expect(await screen.findByRole('heading', { name: 'WET CLEAN' })).toBeInTheDocument();
    expect(card('WET CLEAN')).toHaveTextContent('v3');
    expect(card('WET CLEAN')).toHaveTextContent('STRICT');
    expect(card('WET CLEAN')).toHaveTextContent('Active');
    expect(card('DRY STORAGE')).toHaveTextContent('Draft');
    expect(card('LEGACY')).toHaveTextContent('Inactive');
    expect(card('LEGACY')).toHaveTextContent('CUSTOM');
    // a draft cannot be toggled
    expect(within(card('DRY STORAGE')).queryByRole('button', { name: /activate profile/i })).toBeNull();
    expect(within(card('WET CLEAN')).getByRole('button', { name: 'Deactivate profile' })).toBeInTheDocument();
    expect(within(card('LEGACY')).getByRole('button', { name: 'Activate profile' })).toBeInTheDocument();
    expect(screen.getByText('Total Stages').parentElement).toHaveTextContent('13');
    expect(screen.getByText('Connections', { selector: 'div.text-xs' }).parentElement).toHaveTextContent('15');
    expect(screen.getByText('Active Profiles').parentElement).toHaveTextContent('4');
    expect(lastList(api).query.get('status')).toBe('ACTIVE');
    expect(lastList(api).query.get('page')).toBe('1');
    expect(api.unmatched).toEqual([]);
  });

  it('Create and card click navigate to the editor for a user who may edit', async () => {
    const api = setup();
    renderPage(ui(), { user: SA, route: '/filter-cleaning-profiles', api });
    await screen.findByRole('heading', { name: 'WET CLEAN' });
    fireEvent.mouseEnter(card('WET CLEAN'));
    fireEvent.mouseLeave(card('WET CLEAN'));
    fireEvent.click(card('WET CLEAN'));
    expect(screen.getByTestId('where')).toHaveTextContent('/filter-cleaning-profiles/p1/edit');
    fireEvent.click(screen.getByRole('button', { name: /Create Profile/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/filter-cleaning-profiles/new/edit');
  });

  it('a viewer without CP_PAGE_* sees no Create, toggle or delete, and a card click goes nowhere', async () => {
    const api = setup();
    renderPage(ui(), { user: role('OPERATOR', ['FCP_READ']), route: '/filter-cleaning-profiles', api });
    await screen.findByRole('heading', { name: 'WET CLEAN' });
    expect(screen.queryByRole('button', { name: /Create Profile/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /activate profile/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    fireEvent.mouseEnter(card('WET CLEAN'));
    fireEvent.click(card('WET CLEAN'));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/filter-cleaning-profiles$/);
  });

  it('a role with only CP_PAGE_EDIT gets the toggle but not delete; CP_TOGGLE alone grants nothing', async () => {
    const api = setup();
    const { unmount } = renderPage(ui(), { user: role('MANAGER', ['CP_PAGE_EDIT']), api });
    await screen.findByRole('heading', { name: 'WET CLEAN' });
    expect(within(card('WET CLEAN')).getByRole('button', { name: 'Deactivate profile' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    unmount();
    localStorage.clear(); // useAuth caches the previous user; start the second role cold
    const api2 = setup();
    renderPage(ui(), { user: role('MANAGER', ['CP_TOGGLE', 'FCP_READ']), api: api2 });
    await screen.findByRole('heading', { name: 'WET CLEAN' });
    await waitFor(() => expect(api2.calls('GET', '/api/auth/me').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /activate profile/i })).toBeNull();
  });

  it('status tabs and the debounced server-side search re-query from page 1', async () => {
    const api = setup([], {}, page(PROFILES, 40, 4));
    renderPage(ui(), { user: SA, api });
    await screen.findByRole('heading', { name: 'WET CLEAN' });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastList(api).query.get('page')).toBe('2'));
    fireEvent.click(screen.getByRole('button', { name: 'Inactive' }));
    await waitFor(() => expect(lastList(api).query.get('status')).toBe('INACTIVE'));
    expect(lastList(api).query.get('page')).toBe('1');
    expect(screen.getByText('Inactive Profiles')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search profiles...'), { target: { value: 'wet & dry' } });
    await waitFor(() => expect(lastList(api).query.get('search')).toBe('wet & dry'));
    expect(lastList(api).url).toContain('search=wet%20%26%20dry');
    // the new key shows the spinner until its response lands; the pager returns with it
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: '25' } });
    await waitFor(() => expect(lastList(api).query.get('limit')).toBe('25'));
  });

  it('empty results: "No active profiles", or "No profiles match your search" while searching; no pager', async () => {
    const api = setup([], {}, page([], 0));
    renderPage(ui(), { user: SA, api });
    expect(await screen.findByText('No active profiles')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search profiles...'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No profiles match your search')).toBeInTheDocument();
  });

  it('toggle sends PATCH {toggle:true} without opening the editor', async () => {
    const api = setup([{ method: 'PATCH', path: '/api/filter-cleaning-profiles/p1/toggle-status', body: { status: 'INACTIVE' } }]);
    renderPage(ui(), { user: SA, route: '/filter-cleaning-profiles', api });
    await screen.findByRole('heading', { name: 'WET CLEAN' });
    fireEvent.click(within(card('WET CLEAN')).getByRole('button', { name: 'Deactivate profile' }));
    await waitFor(() => expect(api.calls('PATCH', '/api/filter-cleaning-profiles/p1/toggle-status')).toHaveLength(1));
    expect(api.calls('PATCH', '/api/filter-cleaning-profiles/p1/toggle-status')[0].json).toEqual({ toggle: true });
    // the toggle does not open the editor (stopPropagation)
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/filter-cleaning-profiles$/);
    // (the list refresh uses swr's global mutate, which the harness's per-render cache cannot observe)
  });

  it('a refused toggle (409) is shown', async () => {
    const api = setup([{ method: 'PATCH', path: '/api/filter-cleaning-profiles/p3/toggle-status', status: 409, body: { error: 'CHECKLIST_DISABLED', message: 'Profile points at a disabled checklist' } }]);
    renderPage(ui(), { user: SA, api });
    await screen.findByRole('heading', { name: 'LEGACY' });
    fireEvent.click(within(card('LEGACY')).getByRole('button', { name: 'Activate profile' }));
    expect(await screen.findByText('Profile points at a disabled checklist')).toBeInTheDocument();
  });

  it('a gated toggle is signed', async () => {
    const api = setup([{ method: 'PATCH', path: '/api/filter-cleaning-profiles/p1/toggle-status', body: {} }], { reauthActions: ['UPDATE_CLEANING_PROFILE'] });
    renderPage(ui(), { user: SA, api });
    await screen.findByRole('heading', { name: 'WET CLEAN' });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(within(card('WET CLEAN')).getByRole('button', { name: 'Deactivate profile' }));
    await passReauth();
    await waitFor(() => expect(api.calls('PATCH', '/api/filter-cleaning-profiles/p1/toggle-status')).toHaveLength(1));
    expectSigned(api.calls('PATCH', '/api/filter-cleaning-profiles/p1/toggle-status')[0]);
  });

  it('delete: confirm dialog names the profile; Cancel and backdrop close it; Delete sends DELETE and toasts', async () => {
    const api = setup([{ method: 'DELETE', path: '/api/filter-cleaning-profiles/p4', status: 204 }]);
    renderPage(ui(), { user: SA, route: '/filter-cleaning-profiles', api });
    await screen.findByRole('heading', { name: 'LINEAR ONE' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete LINEAR ONE' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/filter-cleaning-profiles$/);
    expect(screen.getByText(/"LINEAR ONE" will be deleted/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/"LINEAR ONE" will be deleted/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete LINEAR ONE' }));
    // clicking inside the dialog does not close it; the backdrop does
    fireEvent.click(screen.getByRole('heading', { name: 'Delete cleaning profile' }));
    expect(screen.getByText(/"LINEAR ONE" will be deleted/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/"LINEAR ONE" will be deleted/).closest('.fixed')!);
    expect(screen.queryByText(/"LINEAR ONE" will be deleted/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete LINEAR ONE' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Cleaning profile "LINEAR ONE" deleted')).toBeInTheDocument();
    expect(api.calls('DELETE', '/api/filter-cleaning-profiles/p4')).toHaveLength(1);
    expect(screen.queryByText(/"LINEAR ONE" will be deleted/)).toBeNull();
  });

  it('delete refused as IN_USE gets the plain-language message and the dialog stays for another try', async () => {
    const api = setup([
      { method: 'DELETE', path: '/api/filter-cleaning-profiles/p1', status: 409, times: 1, body: { error: 'IN_USE', message: 'Profile bound' } },
      { method: 'DELETE', path: '/api/filter-cleaning-profiles/p1', status: 409, times: 1, body: { error: 'CONFLICT', message: 'Profile is in use by 3 cycles' } },
      { method: 'DELETE', path: '/api/filter-cleaning-profiles/p1', status: 500, body: { error: 'X', message: 'DB unavailable' } },
    ]);
    renderPage(ui(), { user: SA, api });
    await screen.findByRole('heading', { name: 'WET CLEAN' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete WET CLEAN' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Cannot delete — "WET CLEAN" is still in use by one or more filters or cycles.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.getByText(/"WET CLEAN" will be deleted/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Cannot delete — "WET CLEAN" is still in use by one or more filters or cycles.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('DB unavailable')).toBeInTheDocument();
  });

  it('a gated delete is signed; cancelling the prompt silently re-enables the dialog', async () => {
    const api = setup([{ method: 'DELETE', path: '/api/filter-cleaning-profiles/p1', status: 204 }], { reauthActions: ['DELETE_CLEANING_PROFILE'] });
    renderPage(ui(), { user: SA, api });
    await screen.findByRole('heading', { name: 'WET CLEAN' });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Delete WET CLEAN' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const pw = await screen.findByPlaceholderText('Enter your password');
    expect(screen.getByRole('button', { name: 'Deleting...' })).toBeDisabled();
    fireEvent.click(within(pw.closest('.max-w-lg') as HTMLElement).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Delete' })).toBeEnabled();
    // A dismissed prompt is a choice, not a failure: no error toast, the confirm stays for a retry.
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    expect(screen.getByText(/WET CLEAN/, { selector: 'strong, b, span, p' })).toBeInTheDocument();
    expect(api.calls('DELETE', '/api/filter-cleaning-profiles/p1')).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await passReauth();
    expect(await screen.findByText('Cleaning profile "WET CLEAN" deleted')).toBeInTheDocument();
    expectSigned(api.calls('DELETE', '/api/filter-cleaning-profiles/p1')[0]);
  });
});

describe('Cleaning Profiles list — configured page size (D6 class)', () => {
  it('starts at the first CONFIGURED rows-per-page option, not the pre-load fallback', async () => {
    const api = setup([], { pagination: { limit: 25, options: [25, 50, 100] } });
    renderPage(ui(), { user: SA, api });
    await screen.findByRole('heading', { name: 'WET CLEAN' });
    await waitFor(() => expect(lastList(api).query.get('limit')).toBe('25'));
    expect(screen.getByRole('combobox')).toHaveValue('25');
    expect(Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((o) => o.textContent)).toEqual(['25', '50', '100']);
  });
});

describe('Cleaning Profiles list — toggle under re-auth (D7)', () => {
  it('a server REAUTH_REQUIRED opens only the password prompt; a wrong password shows only "Incorrect password"; the signed retry succeeds', async () => {
    const api = setup([
      { method: 'PATCH', path: '/api/filter-cleaning-profiles/p1/toggle-status', status: 401, times: 1, body: { error: 'REAUTH_REQUIRED', message: 'Re-authentication required' } },
      { method: 'PATCH', path: '/api/filter-cleaning-profiles/p1/toggle-status', status: 401, times: 1, body: { error: 'REAUTH_FAILED', message: 'Invalid password' } },
      { method: 'PATCH', path: '/api/filter-cleaning-profiles/p1/toggle-status', body: { status: 'INACTIVE' } },
    ]);
    renderPage(ui(), { user: SA, api });
    await screen.findByRole('heading', { name: 'WET CLEAN' });
    fireEvent.click(within(card('WET CLEAN')).getByRole('button', { name: 'Deactivate profile' }));
    expect(await screen.findByPlaceholderText('Enter your password')).toBeInTheDocument();
    expect(screen.queryByText('Re-authentication required')).toBeNull();
    await passReauth('wrong');
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText('Invalid password')).toBeNull();
    await passReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    const calls = api.calls('PATCH', '/api/filter-cleaning-profiles/p1/toggle-status');
    expect(calls).toHaveLength(3);
    expectSigned(calls[2]);
  });

  it('cancelling the toggle prompt is silent', async () => {
    const api = setup([], { reauthActions: ['UPDATE_CLEANING_PROFILE'] });
    renderPage(ui(), { user: SA, api });
    await screen.findByRole('heading', { name: 'WET CLEAN' });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(within(card('WET CLEAN')).getByRole('button', { name: 'Deactivate profile' }));
    const pw = await screen.findByPlaceholderText('Enter your password');
    fireEvent.click(within(pw.closest('.max-w-lg') as HTMLElement).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    expect(api.calls('PATCH', '/api/filter-cleaning-profiles/p1/toggle-status')).toHaveLength(0);
  });
});
