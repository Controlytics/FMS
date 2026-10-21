import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type MockApi } from '@/test-utils/page-harness';
import { FilterFieldOptionsConfigPage } from '../filter-field-options';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';

vi.setConfig({ testTimeout: 30000 });
afterEach(resetEnv);

const PATH = '/api/config/dynamic/filter-field-options';
const W = { timeout: 5000 };
const STORED = { value: { ahuType: ['Process', 'Non Process'], filterType: ['HEPA', 'Pre-filter'], micronSize: ['0.3'] } };

function setup(opts: { data?: unknown; extra?: MockRoute[]; reauth?: string[]; user?: any } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: PATH, body: opts.data ?? STORED },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<FilterFieldOptionsConfigPage />, { user: opts.user ?? SUPER_ADMIN, api });
  return api;
}

async function catalogLoaded(api: MockApi) {
  await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

const section = (title: string) => screen.getByRole('heading', { name: title }).closest('div.px-5') as HTMLElement;
const items = (title: string) => within(section(title)).queryAllByRole('listitem').map((li) => li.querySelector('span')!.textContent);
const addInput = (placeholder: string) => screen.getByPlaceholderText(placeholder) as HTMLInputElement;
const addBtn = (title: string) => within(section(title)).getByRole('button', { name: '+ Add' });
const saveBtn = () => screen.getByRole('button', { name: /Save Changes|Saving/ });
const itemButtons = (title: string, value: string) => {
  const li = within(section(title)).getByText(value).closest('li') as HTMLElement;
  return { up: within(li).getByRole('button', { name: '↑' }), down: within(li).getByRole('button', { name: '↓' }), remove: within(li).getByRole('button', { name: 'Remove' }) };
};

describe('Filter field options panel', () => {
  it('loads the three lists with counts; Save is disabled until a list changes', async () => {
    const api = setup();
    await waitFor(() => expect(items('Filter Type')).toEqual(['HEPA', 'Pre-filter']), W);
    expect(items('AHU Type')).toEqual(['Process', 'Non Process']);
    expect(items('Micron Size')).toEqual(['0.3']);
    expect(within(section('Micron Size')).getByText('1 value')).toBeInTheDocument();
    expect(within(section('Filter Type')).getByText('2 values')).toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
    // First row cannot move up, last row cannot move down.
    expect(itemButtons('Filter Type', 'HEPA').up).toBeDisabled();
    expect(itemButtons('Filter Type', 'Pre-filter').down).toBeDisabled();
    expect(api.unmatched).toEqual([]);
  });

  it('a stored list that is not an array shows as empty', async () => {
    setup({ data: { value: { ahuType: 'oops', filterType: null } } });
    await waitFor(() => expect(within(section('AHU Type')).getByText('No values configured yet.')).toBeInTheDocument(), W);
    expect(within(section('Filter Type')).getByText('No values configured yet.')).toBeInTheDocument();
    expect(within(section('AHU Type')).getByText('0 values')).toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
  });

  it('before (or without) a stored row it shows the built-in default and is not dirty', async () => {
    const api = setup({ data: {} });
    await waitFor(() => expect(api.calls('GET', PATH)).toHaveLength(1));
    expect(items('AHU Type')).toEqual(['Process', 'Non Process']);
    expect(within(section('Filter Type')).getByText('No values configured yet.')).toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
  });

  it('adds a value with the button and with Enter; blank input adds nothing', async () => {
    setup();
    await waitFor(() => expect(items('Filter Type')).toEqual(['HEPA', 'Pre-filter']), W);
    expect(addBtn('Filter Type')).toBeDisabled();
    fireEvent.change(addInput('e.g. HEPA'), { target: { value: '  ULPA  ' } });
    expect(addBtn('Filter Type')).not.toBeDisabled();
    fireEvent.click(addBtn('Filter Type'));
    expect(items('Filter Type')).toEqual(['HEPA', 'Pre-filter', 'ULPA']);
    expect(addInput('e.g. HEPA').value).toBe('');
    fireEvent.change(addInput('e.g. 0.3'), { target: { value: '5' } });
    fireEvent.keyDown(addInput('e.g. 0.3'), { key: 'Enter' });
    expect(items('Micron Size')).toEqual(['0.3', '5']);
    // Enter on a blank box and other keys do nothing.
    fireEvent.keyDown(addInput('e.g. 0.3'), { key: 'Enter' });
    fireEvent.keyDown(addInput('e.g. 0.3'), { key: 'a' });
    expect(items('Micron Size')).toEqual(['0.3', '5']);
    expect(saveBtn()).not.toBeDisabled();
  });

  it('refuses a duplicate (case-insensitive) with a dismissable message', async () => {
    setup();
    await waitFor(() => expect(items('Filter Type')).toEqual(['HEPA', 'Pre-filter']), W);
    fireEvent.change(addInput('e.g. HEPA'), { target: { value: 'hepa' } });
    fireEvent.click(addBtn('Filter Type'));
    expect(screen.getByText('"hepa" already exists in filterType')).toBeInTheDocument();
    expect(items('Filter Type')).toEqual(['HEPA', 'Pre-filter']);
    expect(saveBtn()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '×' }));
    expect(screen.queryByText(/already exists/)).toBeNull();
  });

  it('moves and removes values; moving back to the saved order is not dirty', async () => {
    setup();
    await waitFor(() => expect(items('AHU Type')).toEqual(['Process', 'Non Process']), W);
    fireEvent.click(itemButtons('AHU Type', 'Process').down);
    expect(items('AHU Type')).toEqual(['Non Process', 'Process']);
    expect(saveBtn()).not.toBeDisabled();
    fireEvent.click(itemButtons('AHU Type', 'Process').up);
    expect(items('AHU Type')).toEqual(['Process', 'Non Process']);
    expect(saveBtn()).toBeDisabled();
    fireEvent.click(itemButtons('Micron Size', '0.3').remove);
    expect(within(section('Micron Size')).getByText('No values configured yet.')).toBeInTheDocument();
    expect(saveBtn()).not.toBeDisabled();
  });

  it('Save PUTs the whole {value} object', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await waitFor(() => expect(items('Filter Type')).toEqual(['HEPA', 'Pre-filter']), W);
    fireEvent.click(itemButtons('Filter Type', 'Pre-filter').remove);
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), W);
    expect(api.calls('PUT', PATH)[0].json).toEqual({ value: { ahuType: ['Process', 'Non Process'], filterType: ['HEPA'], micronSize: ['0.3'] } });
    await waitFor(() => expect(saveBtn()).toHaveTextContent('Save Changes'));
    expect(screen.queryByText(/Failed/)).toBeNull();
  });

  it('a refused save shows the server message', async () => {
    setup({ extra: [{ method: 'PUT', path: PATH, status: 400, body: { error: 'VALIDATION', message: 'micronSize must be numeric' } }] });
    await waitFor(() => expect(items('Filter Type')).toEqual(['HEPA', 'Pre-filter']), W);
    fireEvent.click(itemButtons('Micron Size', '0.3').remove);
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('micronSize must be numeric', undefined, W)).toBeInTheDocument();
    expect(saveBtn()).not.toBeDisabled();
  });

  it('server demands a signature: prompts, then retries with the password', async () => {
    const api = setup({ extra: [reauthRequired('PUT', PATH), { method: 'PUT', path: PATH, body: { ok: true } }] });
    await waitFor(() => expect(items('Filter Type')).toEqual(['HEPA', 'Pre-filter']), W);
    fireEvent.click(itemButtons('Micron Size', '0.3').remove);
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText(/Performing "Update Configuration Page"|This action requires/)).toBeInTheDocument();
    await signReauth('pw-ffo');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(2), W);
    const retry = api.calls('PUT', PATH)[1];
    expect(retry.headers['x-reauth-password']).toBe('pw-ffo');
    expect(retry.json).toEqual({ value: { ahuType: ['Process', 'Non Process'], filterType: ['HEPA', 'Pre-filter'], micronSize: [] }, _currentPassword: 'pw-ffo' });
  });

  it('signature required up front names the action; cancel sends nothing and frees Save', async () => {
    const api = setup({ reauth: ['UPDATE_CONFIG_PAGE'] });
    await waitFor(() => expect(items('Filter Type')).toEqual(['HEPA', 'Pre-filter']), W);
    await catalogLoaded(api);
    fireEvent.click(itemButtons('Micron Size', '0.3').remove);
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(screen.getByText(/Performing "Update Configuration Page" requires identity verification/)).toBeInTheDocument();
    expect(saveBtn()).toHaveTextContent('Saving…');
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(api.calls('PUT', PATH)).toHaveLength(0);
    expect(saveBtn()).toHaveTextContent('Save Changes');
    expect(saveBtn()).not.toBeDisabled();
  });

  it('a role without CONFIG_UPDATE sees read-only lists', async () => {
    setup({ user: { role: 'QA', permissions: ['CONFIG_READ'] } });
    await waitFor(() => expect(items('Filter Type')).toEqual(['HEPA', 'Pre-filter']), W);
    await waitFor(() => expect(addInput('e.g. HEPA')).toBeDisabled());
    expect(itemButtons('Filter Type', 'HEPA').remove).toBeDisabled();
    expect(itemButtons('Filter Type', 'HEPA').down).toBeDisabled();
    expect(saveBtn()).toBeDisabled();
    expect(saveBtn()).toHaveAttribute('title', 'CONFIG_UPDATE permission required');
  });

  it('a role holding CONFIG_UPDATE can edit', async () => {
    setup({ user: { role: 'ADMIN', permissions: ['CONFIG_UPDATE'] } });
    await waitFor(() => expect(items('Filter Type')).toEqual(['HEPA', 'Pre-filter']), W);
    await waitFor(() => expect(addInput('e.g. HEPA')).not.toBeDisabled());
    expect(saveBtn()).not.toHaveAttribute('title');
  });
});
