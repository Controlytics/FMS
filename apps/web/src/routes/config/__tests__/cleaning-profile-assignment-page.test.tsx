import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { CleaningProfileAssignmentPage } from '../cleaning-profile-assignment';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth, ackMessage } from './config-test-helpers';

afterEach(() => { vi.restoreAllMocks(); resetEnv(); });

const CFG = '/api/config/cleaning-profile-assignment';
const PROFILES = [
  { id: 'p1', name: 'Standard Wash', status: 'ACTIVE' },
  { id: 'p2', name: 'Old Dry', status: 'ARCHIVED' },
  { id: 'p3', name: 'Unversioned' },
];
const FILTERS = [
  { id: 'f1', name: 'FLT-001', attributes: { micronSize: '10' } },
  { id: 'f2', name: null, attributes: { micronSize: '5' } },
  { id: 'f3', name: 'FLT-003', attributes: null },
];
const AHUS = [{ id: 'a1', name: 'AHU-01' }, { id: 'a2', name: null }];
const BLOCKS = [{ id: 'b1', name: 'Block A' }];
const AREAS = [{ id: 'r1', name: 'Area 1' }];

function setup(opts: { extra?: MockRoute[]; config?: unknown; profiles?: unknown; filters?: unknown[]; reauth?: string[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: CFG, body: opts.config ?? { mode: 'BY_ENTITY', rules: [{ matchValue: 'f1', profileId: 'p1' }] } },
    { path: '/api/filter-cleaning-profiles', body: opts.profiles ?? { data: PROFILES } },
    { path: '/api/hierarchy/blocks', body: { data: BLOCKS } },
    { path: '/api/hierarchy/areas', body: { data: AREAS } },
    { path: '/api/hierarchy/ahus', body: { data: AHUS } },
    { path: '/api/hierarchy/filters', body: { data: opts.filters ?? FILTERS } },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<CleaningProfileAssignmentPage />, { user: SUPER_ADMIN, api, route: '/config/filter-setup' });
  return api;
}

const saveBtn = () => screen.getByRole('button', { name: /Save Configuration|Saving/ });
const addBtn = () => screen.getByRole('button', { name: /Add Rule/ });
const radio = (label: RegExp) => screen.getByRole('radio', { name: label });
const rows = () => screen.queryAllByRole('row').slice(1); // minus header
const selectsIn = (row: HTMLElement) => within(row).getAllByRole('combobox') as HTMLSelectElement[];
const optionTexts = (sel: HTMLSelectElement) => Array.from(sel.options).map((o) => o.textContent);

describe('Cleaning profile assignment panel', () => {
  it('loads the stored mode and rules; only active (or referenced) profiles are offered', async () => {
    const api = setup({ config: { mode: 'BY_ENTITY', rules: [{ matchValue: 'f1', profileId: 'p2' }] } });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(radio(/^By Individual Filter/)).toBeChecked();
    expect(screen.getByText('1 rule configured')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Filter' })).toBeInTheDocument();
    await waitFor(() => expect(selectsIn(rows()[0])[0].value).toBe('f1'));
    // Filter options: name, else id.
    expect(optionTexts(selectsIn(rows()[0])[0])).toEqual(['Select filter...', 'FLT-001', 'f2', 'FLT-003']);
    // Archived p2 stays visible because the rule references it, labelled as such.
    await waitFor(() => expect(optionTexts(selectsIn(rows()[0])[1])).toEqual(['Select profile...', 'Standard Wash', 'Old Dry (archived)', 'Unversioned']));
    expect(selectsIn(rows()[0])[1].value).toBe('p2');
    expect(saveBtn()).toBeDisabled();
    expect(api.calls('GET', '/api/filter-cleaning-profiles')[0].query.get('limit')).toBe('1000000');
    expect(api.unmatched).toEqual([]);
  });

  it('an archived profile no rule references is not offered; a bare-array profile feed is accepted', async () => {
    setup({ config: { mode: 'BY_AHU', rules: [{ matchValue: 'a1', profileId: '' }] }, profiles: PROFILES });
    await waitFor(() => expect(rows()).toHaveLength(1));
    await waitFor(() => expect(optionTexts(selectsIn(rows()[0])[1])).toEqual(['Select profile...', 'Standard Wash', 'Unversioned']));
    expect(screen.getByRole('columnheader', { name: 'AHU' })).toBeInTheDocument();
    expect(optionTexts(selectsIn(rows()[0])[0])).toEqual(['Select AHU...', 'AHU-01', 'a2']);
  });

  it('an empty config starts in By Individual Filter with an empty-state hint', async () => {
    setup({ config: {} });
    expect(await screen.findByText('No assignment rules yet')).toBeInTheDocument();
    expect(screen.getByText('No rules configured. Add rules to map values to cleaning profiles.')).toBeInTheDocument();
    expect(radio(/^By Individual Filter/)).toBeChecked();
    expect(saveBtn()).toBeDisabled();
  });

  it('Add Rule, pick a filter + profile, Save sends {mode, rules} and confirms', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: CFG, body: { ok: true } }] });
    await waitFor(() => expect(rows()).toHaveLength(1));
    await waitFor(() => expect(selectsIn(rows()[0])[0].value).toBe('f1'));
    fireEvent.click(addBtn());
    expect(screen.getByText('2 rules configured')).toBeInTheDocument();
    const [match, profile] = selectsIn(rows()[1]);
    // f1 is taken by row 1, so the new row cannot pick it.
    expect(optionTexts(match)).toEqual(['Select filter...', 'f2', 'FLT-003']);
    fireEvent.change(match, { target: { value: 'f3' } });
    fireEvent.change(profile, { target: { value: 'p3' } });
    // Row 1 can no longer pick f3 either, but keeps its own value.
    expect(optionTexts(selectsIn(rows()[0])[0])).toEqual(['Select filter...', 'FLT-001', 'f2']);
    expect(saveBtn()).not.toBeDisabled();
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', CFG)).toHaveLength(1));
    expect(api.calls('PUT', CFG)[0].json).toEqual({
      mode: 'BY_ENTITY',
      rules: [{ matchValue: 'f1', profileId: 'p1' }, { matchValue: 'f3', profileId: 'p3' }],
    });
    expect(await ackMessage('Configuration saved')).toContain('Cleaning profile assignment updated successfully.');
  });

  it('Add Rule disables once every filter has a rule; removing one re-enables it', async () => {
    setup({ config: { mode: 'BY_ENTITY', rules: [{ matchValue: 'f1', profileId: 'p1' }, { matchValue: 'f2', profileId: 'p1' }] } });
    await waitFor(() => expect(rows()).toHaveLength(2));
    await waitFor(() => expect(addBtn()).not.toBeDisabled());
    fireEvent.click(addBtn());
    fireEvent.change(selectsIn(rows()[2])[0], { target: { value: 'f3' } });
    expect(addBtn()).toBeDisabled();
    expect(addBtn()).toHaveAttribute('title', 'Every filter already has a rule');
    fireEvent.click(within(rows()[0]).getByTitle('Remove rule'));
    expect(rows()).toHaveLength(2);
    expect(addBtn()).not.toBeDisabled();
  });

  it('switching mode with configured rules asks first; declining keeps everything', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    setup();
    await waitFor(() => expect(selectsIn(rows()[0])[1].value).toBe('p1'));
    fireEvent.click(radio(/^By AHU/));
    expect(confirm).toHaveBeenCalledWith('Switching mode will reset the 1 currently-configured rule. Continue?');
    expect(radio(/^By Individual Filter/)).toBeChecked();
    expect(rows()).toHaveLength(1);
  });

  it('accepting the switch to Filter Set seeds Set A / Set B with no add / remove', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = setup({
      config: { mode: 'BY_ENTITY', rules: [{ matchValue: 'f1', profileId: 'p1' }, { matchValue: 'f2', profileId: 'p1' }] },
      extra: [{ method: 'PUT', path: CFG, body: { ok: true } }],
    });
    await waitFor(() => expect(selectsIn(rows()[1])[1].value).toBe('p1'));
    fireEvent.click(radio(/^By Filter Set/));
    expect(confirm).toHaveBeenCalledWith('Switching mode will reset the 2 currently-configured rules. Continue?');
    expect(radio(/^By Filter Set/)).toBeChecked();
    expect(screen.getByRole('columnheader', { name: 'Filter Set' })).toBeInTheDocument();
    expect(screen.getByText('Set A')).toBeInTheDocument();
    expect(screen.getByText('Set B')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add Rule/ })).toBeNull();
    expect(screen.queryByTitle('Remove rule')).toBeNull();
    fireEvent.change(selectsIn(rows()[0])[0], { target: { value: 'p1' } });
    fireEvent.change(selectsIn(rows()[1])[0], { target: { value: 'p3' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', CFG)).toHaveLength(1));
    expect(api.calls('PUT', CFG)[0].json).toEqual({
      mode: 'BY_FILTER_SET',
      rules: [{ matchValue: 'SET_A', profileId: 'p1' }, { matchValue: 'SET_B', profileId: 'p3' }],
    });
    await ackMessage('Configuration saved');
  });

  it('a legacy A/B filter-set config still reads as Set A / Set B', async () => {
    setup({ config: { mode: 'BY_FILTER_SET', rules: [{ matchValue: 'A', profileId: 'p1' }, { matchValue: 'B', profileId: '' }] } });
    expect(await screen.findByText('Set A')).toBeInTheDocument();
    expect(screen.getByText('Set B')).toBeInTheDocument();
  });

  it('switching with no configured rules needs no confirmation; each mode offers its own pool', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    setup({ config: { mode: 'BY_ENTITY', rules: [] } });
    await screen.findByText('No assignment rules yet');

    fireEvent.click(radio(/^By Micron Size/));
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(addBtn());
    expect(screen.getByRole('columnheader', { name: 'Filter Dimensions' })).toBeInTheDocument();
    await waitFor(() => expect(optionTexts(selectsIn(rows()[0])[0])).toEqual(['Select filter dimensions...', '10', '5']));
    fireEvent.change(selectsIn(rows()[0])[0], { target: { value: '5' } });
    fireEvent.click(addBtn());
    expect(optionTexts(selectsIn(rows()[1])[0])).toEqual(['Select filter dimensions...', '10']);
    fireEvent.change(selectsIn(rows()[1])[0], { target: { value: '10' } });
    expect(addBtn()).toBeDisabled();
    expect(addBtn()).toHaveAttribute('title', 'Every filter dimensions already has a rule');

    // No profiles chosen -> switching does not ask.
    fireEvent.click(radio(/^By Block \/ Area/));
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(addBtn());
    expect(screen.getByRole('columnheader', { name: 'Block / Area' })).toBeInTheDocument();
    expect(optionTexts(selectsIn(rows()[0])[0])).toEqual(['Select block / area...', 'Block A', 'Area 1']);
    fireEvent.change(selectsIn(rows()[0])[0], { target: { value: 'r1' } });
    fireEvent.click(addBtn());
    fireEvent.change(selectsIn(rows()[1])[0], { target: { value: 'b1' } });
    expect(addBtn()).toBeDisabled();

    fireEvent.click(radio(/^By AHU/));
    fireEvent.click(addBtn());
    fireEvent.change(selectsIn(rows()[0])[0], { target: { value: 'a2' } });
    fireEvent.click(addBtn());
    expect(optionTexts(selectsIn(rows()[1])[0])).toEqual(['Select AHU...', 'AHU-01']);
  });

  it('with no micron sizes recorded, Add Rule stays usable (empty pool never locks it)', async () => {
    setup({ config: { mode: 'BY_FILTER_SIZE', rules: [] }, filters: [{ id: 'f9', name: 'F9', attributes: {} }] });
    await screen.findByText('No assignment rules yet');
    await waitFor(() => expect(radio(/^By Micron Size/)).toBeChecked());
    expect(addBtn()).not.toBeDisabled();
    fireEvent.click(addBtn());
    expect(optionTexts(selectsIn(rows()[0])[0])).toEqual(['Select filter dimensions...']);
  });

  it('an unknown stored mode renders generic rows without crashing', async () => {
    setup({ config: { mode: 'BY_LEGACY', rules: [{ matchValue: 'x', profileId: 'p1' }] } });
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Match' })).toBeInTheDocument());
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    // Only the profile select renders in the row.
    expect(selectsIn(rows()[0])).toHaveLength(1);
    expect(addBtn()).not.toBeDisabled();
  });

  it('UPDATE_CONFIG_PAGE signature: prompt, then PUT with the password', async () => {
    const api = setup({ reauth: ['UPDATE_CONFIG_PAGE'], extra: [{ method: 'PUT', path: CFG, body: { ok: true } }] });
    await waitFor(() => expect(selectsIn(rows()[0])[1].value).toBe('p1'));
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(selectsIn(rows()[0])[1], { target: { value: 'p3' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText(/Performing "Update Cleaning Profile Assignment" requires identity verification/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await signReauth('pw-cpa');
    await waitFor(() => expect(api.calls('PUT', CFG)).toHaveLength(1));
    const put = api.calls('PUT', CFG)[0];
    expect(put.headers['x-reauth-password']).toBe('pw-cpa');
    expect(put.json).toEqual({ mode: 'BY_ENTITY', rules: [{ matchValue: 'f1', profileId: 'p3' }], _currentPassword: 'pw-cpa' });
    await ackMessage('Configuration saved');
  });

  it('cancelling the signature frees Save and sends nothing', async () => {
    const api = setup({ extra: [reauthRequired('PUT', CFG)] });
    await waitFor(() => expect(selectsIn(rows()[0])[1].value).toBe('p1'));
    fireEvent.change(selectsIn(rows()[0])[1], { target: { value: 'p3' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await cancelReauth();
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    expect(api.calls('PUT', CFG)).toHaveLength(1);
  });

  it('a refused save shows the server message in an error dialog', async () => {
    setup({ extra: [{ method: 'PUT', path: CFG, status: 409, body: { error: 'CONFLICT', message: 'Profile p3 is archived' } }] });
    await waitFor(() => expect(selectsIn(rows()[0])[1].value).toBe('p1'));
    fireEvent.change(selectsIn(rows()[0])[1], { target: { value: 'p3' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await ackMessage('Save failed')).toContain('Profile p3 is archived');
    expect(saveBtn()).not.toBeDisabled();
  });
});
