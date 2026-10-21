import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { AhuFilterSetConfigPage } from '../ahu-filter-set-config';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';

vi.setConfig({ testTimeout: 30000 });
afterEach(() => { resetEnv(); window.history.replaceState(null, ''); });

const LIST = '/api/pm-schedules/ahu-configs';
const PAGE = '/config/ahu-filter-set-config';
const WAIT = { timeout: 5000 };
const AHUS = [
  { ahuId: 'a1', ahuName: 'AHU-0A', mode: 'BOTH', setACount: 4, setBCount: 3, noSetCount: 1, totalFilters: 8, hasActiveSchedule: true },
  { ahuId: 'a2', ahuName: 'AHU-0B', mode: 'SET_A', setACount: 2, setBCount: 0, noSetCount: 0, totalFilters: 2, hasActiveSchedule: false },
  { ahuId: 'a3', ahuName: 'AHU-1C', mode: 'SET_B', setACount: 0, setBCount: 5, noSetCount: 0, totalFilters: 5, hasActiveSchedule: true },
  { ahuId: 'a4', ahuName: 'AHU-2D', mode: 'DISABLED', setACount: 0, setBCount: 0, noSetCount: 0, totalFilters: 0, hasActiveSchedule: false },
];

/** Where the router is, plus a start page that pushes into the config page so a history step exists. */
function Shell() {
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="loc">{loc.pathname}</p>
      <Routes>
        <Route path="/start" element={<button onClick={() => navigate(PAGE)}>open page</button>} />
        <Route path={PAGE} element={<AhuFilterSetConfigPage />} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </>
  );
}

function setup(opts: { user?: any; extra?: MockRoute[]; data?: unknown; reauth?: string[]; route?: string } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: LIST, body: opts.data === undefined ? { ahus: AHUS } : opts.data },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<Shell />, { user: opts.user ?? SUPER_ADMIN, api, route: opts.route ?? PAGE });
  return api;
}

const loaded = () => screen.findByText('AHU-0A', undefined, WAIT);
const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
const selectOf = (name: string) => within(rowOf(name)).getByRole('combobox') as HTMLSelectElement;
/** A stat tile's number: the label div's preceding sibling. */
const statValue = (label: string) => screen.getByText(label, { selector: 'div' }).previousElementSibling?.textContent;
const loc = () => screen.getByTestId('loc').textContent;

describe('AHU Filter Set Configuration', () => {
  it('shows skeleton rows while loading, then each AHU with counts, schedule and mode', async () => {
    const api = setup();
    expect(document.querySelectorAll('.animate-pulse').length).toBe(5);
    await loaded();
    expect(document.querySelectorAll('.animate-pulse').length).toBe(0);

    const a = within(rowOf('AHU-0A'));
    expect(a.getByText('Set A · 4')).toBeInTheDocument();
    expect(a.getByText('Set B · 3')).toBeInTheDocument();
    expect(a.getByText('Unclassified · 1')).toBeInTheDocument();
    expect(a.getByText('Scheduled')).toBeInTheDocument();
    expect(selectOf('AHU-0A').value).toBe('BOTH');

    const b = within(rowOf('AHU-0B'));
    expect(b.getByText('Set A · 2')).toBeInTheDocument();
    expect(b.queryByText(/Set B ·/)).toBeNull();
    expect(b.queryByText(/Unclassified/)).toBeNull();
    expect(b.getByText('—')).toBeInTheDocument();
    expect(selectOf('AHU-0B').value).toBe('SET_A');

    expect(within(rowOf('AHU-1C')).getByText('Set B · 5')).toBeInTheDocument();
    expect(selectOf('AHU-1C').value).toBe('SET_B');
    expect(within(rowOf('AHU-2D')).getByText('No filters')).toBeInTheDocument();
    expect(selectOf('AHU-2D').value).toBe('DISABLED');

    // Stat tiles: total 4, one of each mode.
    expect(statValue('Total AHUs')).toContain('4');
    for (const l of ['Both Sets', 'Only Set A', 'Only Set B', 'Disabled']) expect(statValue(l)).toContain('1');
    expect(api.unmatched).toEqual([]);
  });

  it('empty organisation shows the create-AHUs hint', async () => {
    setup({ data: { ahus: [] } });
    expect(await screen.findByText('No AHUs in your organization', undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByText('Create AHUs in the Assets page first')).toBeInTheDocument();
  });

  it('a response without `ahus` is treated as empty', async () => {
    setup({ data: {} });
    expect(await screen.findByText('No AHUs in your organization', undefined, WAIT)).toBeInTheDocument();
    expect(statValue('Total AHUs')).toContain('0');
  });

  it('search filters by name (case-insensitive, trimmed) and explains an empty result', async () => {
    setup();
    await loaded();
    const search = screen.getByPlaceholderText('Search AHU name...');
    fireEvent.change(search, { target: { value: '  ahu-0b ' } });
    expect(screen.getByText('AHU-0B')).toBeInTheDocument();
    expect(screen.queryByText('AHU-0A')).toBeNull();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No matching AHUs')).toBeInTheDocument();
    expect(screen.getByText('Try a different search term')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '   ' } });
    expect(screen.getByText('AHU-0A')).toBeInTheDocument();
    expect(screen.getByText('AHU-2D')).toBeInTheDocument();
  });

  it('changing a mode PUTs it, locks that row while saving, refetches the list and flashes Saved', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: `${LIST}/a2`, body: { ok: true } }] });
    await loaded();
    const before = api.calls('GET', LIST).length;
    fireEvent.change(selectOf('AHU-0B'), { target: { value: 'DISABLED' } });
    // The row is locked immediately (spinner + disabled select); other rows are not.
    expect(selectOf('AHU-0B')).toBeDisabled();
    expect(rowOf('AHU-0B').querySelector('.animate-spin')).not.toBeNull();
    expect(selectOf('AHU-0A')).not.toBeDisabled();

    await waitFor(() => expect(api.calls('PUT', `${LIST}/a2`)).toHaveLength(1), WAIT);
    expect(api.calls('PUT', `${LIST}/a2`)[0].json).toEqual({ mode: 'DISABLED' });
    expect(await screen.findByText('Saved', undefined, WAIT)).toBeInTheDocument();
    expect(api.calls('GET', LIST).length).toBeGreaterThan(before);
    expect(selectOf('AHU-0B')).not.toBeDisabled();
    // The Saved flash clears itself after 2 s.
    await waitFor(() => expect(screen.queryByText('Saved')).toBeNull(), { timeout: 4000 });
  });

  it('a refused change shows the server message and unlocks the row', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: `${LIST}/a1`, status: 409, body: { error: 'SCHEDULE_ACTIVE', message: 'AHU has an open PM window' } }] });
    await loaded();
    fireEvent.change(selectOf('AHU-0A'), { target: { value: 'SET_B' } });
    expect(await screen.findByText('AHU has an open PM window', undefined, WAIT)).toBeInTheDocument();
    expect(api.calls('PUT', `${LIST}/a1`)).toHaveLength(1);
    expect(selectOf('AHU-0A')).not.toBeDisabled();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('server demands a signature: prompts, then retries with the password', async () => {
    const api = setup({ extra: [reauthRequired('PUT', `${LIST}/a3`), { method: 'PUT', path: `${LIST}/a3`, body: { ok: true } }] });
    await loaded();
    fireEvent.change(selectOf('AHU-1C'), { target: { value: 'BOTH' } });
    await signReauth('pw-ahu');
    await waitFor(() => expect(api.calls('PUT', `${LIST}/a3`)).toHaveLength(2), WAIT);
    const retry = api.calls('PUT', `${LIST}/a3`)[1];
    expect(retry.headers['x-reauth-password']).toBe('pw-ahu');
    expect(retry.json).toEqual({ mode: 'BOTH', _currentPassword: 'pw-ahu' });
    expect(await screen.findByText('Saved', undefined, WAIT)).toBeInTheDocument();
  });

  it('an up-front signature that is cancelled sends nothing and unlocks the row', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = setup({ reauth: ['UPDATE_CONFIG_PAGE'] });
    await loaded();
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0), WAIT);
    fireEvent.change(selectOf('AHU-0A'), { target: { value: 'SET_A' } });
    await screen.findByPlaceholderText('Enter your password', undefined, WAIT);
    expect(selectOf('AHU-0A')).toBeDisabled();
    await cancelReauth();
    await waitFor(() => expect(selectOf('AHU-0A')).not.toBeDisabled(), WAIT);
    expect(api.calls('PUT', `${LIST}/a1`)).toHaveLength(0);
    err.mockRestore();
  });

  it('PM_READ alone: every mode dropdown is disabled with the reason', async () => {
    setup({ user: { role: 'SUPERVISOR', permissions: ['PM_READ'] } });
    await loaded();
    await waitFor(() => expect(selectOf('AHU-0A')).toBeDisabled(), WAIT);
    for (const n of ['AHU-0A', 'AHU-0B', 'AHU-1C', 'AHU-2D']) {
      expect(selectOf(n)).toBeDisabled();
      expect(selectOf(n)).toHaveAttribute('title', 'PM_UPDATE permission required');
    }
  });

  it.each([['PM_UPDATE'], ['CONFIG_UPDATE']])('%s unlocks the mode dropdowns', async (perm) => {
    setup({ user: { role: 'MANAGER', permissions: ['PM_READ', perm] } });
    await loaded();
    await waitFor(() => expect(selectOf('AHU-0A')).not.toBeDisabled(), WAIT);
    expect(selectOf('AHU-0A')).not.toHaveAttribute('title');
  });

  it('Back goes to /config for a role that can open it', async () => {
    setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: /Back to Settings/ }));
    expect(loc()).toBe('/config');
  });

  it('Back without CONFIG_READ goes back in history when there is history', async () => {
    setup({ user: { role: 'SUPERVISOR', permissions: ['PM_READ'] }, route: '/start' });
    fireEvent.click(await screen.findByRole('button', { name: 'open page' }, WAIT));
    await loaded();
    window.history.replaceState({ idx: 1 }, '');
    fireEvent.click(screen.getByRole('button', { name: /Back to Settings/ }));
    expect(loc()).toBe('/start');
  });

  it('Back without CONFIG_READ and no history falls back to the dashboard', async () => {
    setup({ user: { role: 'SUPERVISOR', permissions: ['PM_READ'] } });
    await loaded();
    // Wait for the real user so the back hook sees the role.
    await waitFor(() => expect(selectOf('AHU-0A')).toBeDisabled(), WAIT);
    window.history.replaceState({ idx: 0 }, '');
    fireEvent.click(screen.getByRole('button', { name: /Back to Settings/ }));
    expect(loc()).toBe('/');
  });
});
