import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { CleaningReasonsConfigPage } from '../filter-cleaning-reasons';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';

vi.setConfig({ testTimeout: 30000 });
afterEach(resetEnv);

const PATH = '/api/config/dynamic/filter-cleaning-reasons';
const WAIT = { timeout: 5000 };
const REASONS = [
  { key: 'PM', name: 'Preventive Maintenance', description: 'Scheduled PM visit', requiresJustification: false, isActive: true, sortOrder: 1 },
  { key: 'BREAKDOWN', name: 'Breakdown', description: '', requiresJustification: true, isActive: true, sortOrder: 2 },
];

function setup(opts: { user?: any; extra?: MockRoute[]; data?: unknown; reauth?: string[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: PATH, body: opts.data === undefined ? { value: REASONS } : opts.data },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<CleaningReasonsConfigPage />, { user: opts.user ?? SUPER_ADMIN, api, route: '/config/filter-setup' });
  return api;
}

const saveBtn = () => screen.getByRole('button', { name: /Save Changes|Saving/ });
const addBtn = () => screen.getByRole('button', { name: '+ Add Reason' });
const loaded = () => screen.findByText('Breakdown', undefined, WAIT);
const rowOf = (name: string) => (screen.getByText(name).closest('div.px-5') as HTMLElement);
const activeBox = (name: string) => within(rowOf(name)).getByRole('checkbox') as HTMLInputElement;
const modal = () => (screen.getByRole('heading', { name: /Add Reason|Edit Reason/ }).parentElement as HTMLElement);
const nameInput = () => within(modal()).getByPlaceholderText('e.g. Scheduled Cleaning') as HTMLInputElement;
const keyInput = () => within(modal()).getByPlaceholderText('e.g. SCHEDULED_CLEANING') as HTMLInputElement;
const descInput = () => within(modal()).getByPlaceholderText('Describe when this reason should be used') as HTMLTextAreaElement;

describe('Filter Cleaning Reasons config', () => {
  it('lists the stored reasons with their badges and starts clean', async () => {
    const api = setup();
    await loaded();
    expect(screen.getByText('Preventive Maintenance')).toBeInTheDocument();
    expect(screen.getByText('Scheduled PM visit')).toBeInTheDocument();
    // Only BREAKDOWN requires justification.
    expect(screen.getAllByText('Requires Justification')).toHaveLength(1);
    expect(within(rowOf('Breakdown')).getByText('Requires Justification')).toBeInTheDocument();
    // PM can never be deactivated.
    expect(activeBox('Preventive Maintenance')).toBeDisabled();
    expect(activeBox('Breakdown')).not.toBeDisabled();
    expect(saveBtn()).toBeDisabled();
    expect(api.unmatched).toEqual([]);
  });

  it('shows the empty state when nothing is configured (and for a non-array value)', async () => {
    setup({ data: { value: 'garbage' } });
    expect(await screen.findByText(/No cleaning reasons configured yet/, undefined, WAIT)).toBeInTheDocument();
    // A non-array stored value compares equal to the empty list: not dirty.
    expect(saveBtn()).toBeDisabled();
  });

  it('toggling Active then saving PUTs the whole list under `value`', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.click(activeBox('Breakdown'));
    expect(activeBox('Breakdown').checked).toBe(false);
    expect(saveBtn()).not.toBeDisabled();
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), WAIT);
    expect(api.calls('PUT', PATH)[0].json).toEqual({
      value: [REASONS[0], { ...REASONS[1], isActive: false }],
    });
    expect(api.calls('PUT', PATH)[0].headers['x-reauth-password']).toBeUndefined();
    await waitFor(() => expect(saveBtn()).toHaveTextContent('Save Changes'), WAIT);
    expect(screen.queryByText(/Failed to save/)).toBeNull();
  });

  it('adds a reason: the key follows the name until edited, and the new row is saved trimmed', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.click(addBtn());
    expect(screen.getByRole('heading', { name: 'Add Reason' })).toBeInTheDocument();
    // Key auto-derives from the name while it still matches.
    fireEvent.change(nameInput(), { target: { value: 'D' } });
    expect(keyInput().value).toBe('D');
    fireEvent.change(nameInput(), { target: { value: 'Deep clean' } });
    expect(keyInput().value).toBe('DEEP_CLEAN');
    // Once the operator types their own key it is kept.
    fireEvent.change(keyInput(), { target: { value: ' DEEP ' } });
    fireEvent.change(nameInput(), { target: { value: ' Deep clean  ' } });
    expect(keyInput().value).toBe(' DEEP ');
    fireEvent.change(descInput(), { target: { value: '  after spill  ' } });
    fireEvent.click(within(modal()).getByRole('checkbox'));
    fireEvent.click(within(modal()).getByRole('button', { name: 'Add' }));
    expect(screen.queryByRole('heading', { name: 'Add Reason' })).toBeNull();
    expect(screen.getByText('Deep clean')).toBeInTheDocument();
    expect(screen.getByText('DEEP')).toBeInTheDocument();
    expect(screen.getAllByText('Requires Justification')).toHaveLength(2);

    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), WAIT);
    expect(api.calls('PUT', PATH)[0].json.value[2]).toEqual({
      key: 'DEEP', name: 'Deep clean', description: 'after spill', requiresJustification: true, isActive: true, sortOrder: 3,
    });
  });

  it('refuses a new reason without a key, without a name, or with a duplicate key', async () => {
    setup();
    await loaded();
    fireEvent.click(addBtn());
    fireEvent.click(within(modal()).getByRole('button', { name: 'Add' }));
    expect(within(modal()).getByText('Key is required.')).toBeInTheDocument();

    fireEvent.change(keyInput(), { target: { value: 'X' } });
    fireEvent.click(within(modal()).getByRole('button', { name: 'Add' }));
    expect(within(modal()).getByText('Name is required.')).toBeInTheDocument();

    fireEvent.change(keyInput(), { target: { value: ' PM ' } });
    fireEvent.change(nameInput(), { target: { value: 'Another PM' } });
    fireEvent.click(within(modal()).getByRole('button', { name: 'Add' }));
    expect(within(modal()).getByText('A reason with key "PM" already exists.')).toBeInTheDocument();
    // Nothing was added and the page is still clean.
    expect(screen.queryByText('Another PM', { selector: 'span' })).toBeNull();
    expect(saveBtn()).toBeDisabled();
  });

  it('edits a reason in place: key locked, name/description trimmed; Cancel and backdrop discard', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.click(within(rowOf('Breakdown')).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('heading', { name: 'Edit Reason' })).toBeInTheDocument();
    expect(keyInput()).toBeDisabled();
    expect(screen.getByText('Key cannot be changed after creation.')).toBeInTheDocument();
    // Editing the name does not touch the key.
    fireEvent.change(nameInput(), { target: { value: 'Breakdown repair ' } });
    expect(keyInput().value).toBe('BREAKDOWN');
    // Cancel discards.
    fireEvent.click(within(modal()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Edit Reason' })).toBeNull();
    expect(screen.getByText('Breakdown')).toBeInTheDocument();

    // Backdrop click discards too.
    fireEvent.click(within(rowOf('Breakdown')).getByRole('button', { name: 'Edit' }));
    const backdrop = modal().parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(screen.queryByRole('heading', { name: 'Edit Reason' })).toBeNull();

    // A click inside the dialog does not close it.
    fireEvent.click(within(rowOf('Breakdown')).getByRole('button', { name: 'Edit' }));
    fireEvent.click(modal());
    expect(screen.getByRole('heading', { name: 'Edit Reason' })).toBeInTheDocument();
    fireEvent.change(nameInput(), { target: { value: '  Breakdown repair ' } });
    fireEvent.change(descInput(), { target: { value: ' Unplanned ' } });
    fireEvent.click(within(modal()).getByRole('checkbox'));
    fireEvent.click(within(modal()).getByRole('button', { name: 'Update' }));
    expect(screen.getByText('Breakdown repair')).toBeInTheDocument();
    expect(screen.getByText('Unplanned')).toBeInTheDocument();

    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), WAIT);
    expect(api.calls('PUT', PATH)[0].json.value[1]).toEqual({
      key: 'BREAKDOWN', name: 'Breakdown repair', description: 'Unplanned', requiresJustification: false, isActive: true, sortOrder: 2,
    });
  });

  it('a refused save shows the server message, which can be dismissed; Save stays available', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = setup({ extra: [{ method: 'PUT', path: PATH, status: 400, body: { error: 'VALIDATION_ERROR', message: 'value must be an array' } }] });
    await loaded();
    fireEvent.click(activeBox('Breakdown'));
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('value must be an array', undefined, WAIT)).toBeInTheDocument();
    expect(api.calls('PUT', PATH)).toHaveLength(1);
    expect(saveBtn()).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '×' }));
    expect(screen.queryByText('value must be an array')).toBeNull();
    err.mockRestore();
  });

  it('server demands a signature: prompts, retries with the password, then clears the banner', async () => {
    const api = setup({ extra: [reauthRequired('PUT', PATH), { method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.click(activeBox('Breakdown'));
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText(/Update Cleaning Reasons|Configuration Page|requires identity verification/, undefined, WAIT)).toBeInTheDocument();
    await signReauth('pw-9');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(2), WAIT);
    const retry = api.calls('PUT', PATH)[1];
    expect(retry.headers['x-reauth-password']).toBe('pw-9');
    expect(retry.json._currentPassword).toBe('pw-9');
    expect(retry.json.value[1].isActive).toBe(false);
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull(), WAIT);
  });

  it('an up-front signature (my-actions) is asked before any request; cancel sends nothing and frees Save', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = setup({ reauth: ['UPDATE_CONFIG_PAGE'] });
    await loaded();
    fireEvent.click(activeBox('Breakdown'));
    // Wait for the reauth catalogue to arrive so the prompt is up-front.
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0), WAIT);
    await act(async () => { fireEvent.click(saveBtn()); });
    await screen.findByPlaceholderText('Enter your password', undefined, WAIT);
    expect(saveBtn()).toHaveTextContent('Saving...');
    await cancelReauth();
    await waitFor(() => expect(saveBtn()).toHaveTextContent('Save Changes'), WAIT);
    expect(saveBtn()).not.toBeDisabled();
    expect(api.calls('PUT', PATH)).toHaveLength(0);
    err.mockRestore();
  });

  it('a role without CONFIG_UPDATE cannot add or save', async () => {
    setup({ user: { role: 'ADMIN', permissions: ['CONFIG_READ'] } });
    await loaded();
    await waitFor(() => expect(addBtn()).toBeDisabled(), WAIT);
    expect(addBtn()).toHaveAttribute('title', 'CONFIG_UPDATE permission required');
    fireEvent.click(activeBox('Breakdown'));
    expect(saveBtn()).toBeDisabled();
    expect(saveBtn()).toHaveAttribute('title', 'CONFIG_UPDATE permission required');
  });

  it('a role holding CONFIG_UPDATE can add', async () => {
    setup({ user: { role: 'ADMIN', permissions: ['CONFIG_READ', 'CONFIG_UPDATE'] } });
    await loaded();
    await waitFor(() => expect(addBtn()).not.toBeDisabled(), WAIT);
    expect(addBtn()).not.toHaveAttribute('title');
  });
});
