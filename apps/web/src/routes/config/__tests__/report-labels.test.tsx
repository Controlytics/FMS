import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type MockApi } from '@/test-utils/page-harness';
import { ReportLabelsPage } from '../report-labels';
import { REPORT_DEFS } from '@/lib/report-labels';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth, ackMessage } from './config-test-helpers';

vi.setConfig({ testTimeout: 30000 });
afterEach(resetEnv);

const GET = '/api/config/report-labels/current';
const PUT = '/api/config/report-labels';
const W = { timeout: 5000 };
const STORED = { 'audit-trail': { title: 'Audit Log', columns: { action: 'Event' } } };

function setup(opts: { data?: unknown; extra?: MockRoute[]; reauth?: string[]; user?: any } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: GET, body: opts.data === undefined ? STORED : opts.data },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<ReportLabelsPage />, { user: opts.user ?? SUPER_ADMIN, api });
  return api;
}

async function catalogLoaded(api: MockApi) {
  await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

const card = (name: string) => screen.getByRole('heading', { name, level: 2 }).parentElement as HTMLElement;
const titleInput = (name: string) => within(card(name)).getByPlaceholderText(REPORT_DEFS.find((d) => d.name === name)!.defaultTitle) as HTMLInputElement;
const subtitleInput = (name: string) => within(card(name)).getByPlaceholderText('Auto-generated') as HTMLInputElement;
const columnInput = (name: string, colDefault: string) => within(card(name)).getByPlaceholderText(colDefault) as HTMLInputElement;
const saveBtns = () => screen.getAllByRole('button', { name: /Save Changes|Saving/ });
const resetBtn = () => screen.getByRole('button', { name: 'Reset all' });
async function ready() {
  await waitFor(() => expect(titleInput('Audit Trail').value).toBe('Audit Log'), W);
}

describe('Report labels panel', () => {
  it('renders one card per report and fills stored overrides; both Saves start disabled', async () => {
    const api = setup();
    await ready();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(REPORT_DEFS.map((d) => d.name));
    expect(columnInput('Audit Trail', 'Action').value).toBe('Event');
    expect(columnInput('Audit Trail', 'Timestamp').value).toBe('');
    expect(subtitleInput('Audit Trail').value).toBe('');
    expect(saveBtns()).toHaveLength(2);
    for (const b of saveBtns()) expect(b).toBeDisabled();
    expect(api.unmatched).toEqual([]);
  });

  it('a non-object stored value is ignored (blank overrides)', async () => {
    const api = setup({ data: 'legacy' });
    await waitFor(() => expect(api.calls('GET', GET)).toHaveLength(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(titleInput('Audit Trail').value).toBe('');
    for (const b of saveBtns()) expect(b).toBeDisabled();
  });

  it('title, subtitle and column edits are sent together on Save, then the row is re-read', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PUT, body: { ok: true } }] });
    await ready();
    fireEvent.change(subtitleInput('Audit Trail'), { target: { value: 'Q3 period' } });
    fireEvent.change(columnInput('Audit Trail', 'User'), { target: { value: 'Operator' } });
    fireEvent.change(titleInput('Filter Cleaning Record'), { target: { value: 'Cleaning Log' } });
    for (const b of saveBtns()) expect(b).not.toBeDisabled();
    const gets = api.calls('GET', GET).length;
    await act(async () => { fireEvent.click(saveBtns()[1]); });
    await waitFor(() => expect(api.calls('PUT', PUT)).toHaveLength(1), W);
    expect(api.calls('PUT', PUT)[0].json).toEqual({
      'audit-trail': { title: 'Audit Log', subtitle: 'Q3 period', columns: { action: 'Event', user: 'Operator' } },
      'cleaning-cycles': { title: 'Cleaning Log' },
    });
    expect(await ackMessage('Saved')).toContain('Report labels updated');
    await waitFor(() => expect(api.calls('GET', GET).length).toBeGreaterThan(gets), W);
    for (const b of saveBtns()) expect(b).toBeDisabled();
  });

  it('Reset all clears every override and saving it sends an empty object', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PUT, body: { ok: true } }] });
    await ready();
    fireEvent.click(resetBtn());
    expect(titleInput('Audit Trail').value).toBe('');
    expect(columnInput('Audit Trail', 'Action').value).toBe('');
    await act(async () => { fireEvent.click(saveBtns()[0]); });
    await waitFor(() => expect(api.calls('PUT', PUT)).toHaveLength(1), W);
    expect(api.calls('PUT', PUT)[0].json).toEqual({});
    await ackMessage('Saved');
  });

  it('a refused save shows the error and keeps the edit savable', async () => {
    setup({ extra: [{ method: 'PUT', path: PUT, status: 400, body: { error: 'VALIDATION', message: 'title too long' } }] });
    await ready();
    fireEvent.change(titleInput('Audit Trail'), { target: { value: 'x'.repeat(10) } });
    await act(async () => { fireEvent.click(saveBtns()[0]); });
    expect(await ackMessage('Error')).toContain('title too long');
    expect(saveBtns()[0]).not.toBeDisabled();
  });

  it('server demands a signature: prompts, then retries with the password', async () => {
    const api = setup({ extra: [reauthRequired('PUT', PUT), { method: 'PUT', path: PUT, body: { ok: true } }] });
    await ready();
    fireEvent.change(titleInput('Audit Trail'), { target: { value: 'Audit' } });
    await act(async () => { fireEvent.click(saveBtns()[0]); });
    await signReauth('pw-lbl');
    await waitFor(() => expect(api.calls('PUT', PUT)).toHaveLength(2), W);
    const retry = api.calls('PUT', PUT)[1];
    expect(retry.headers['x-reauth-password']).toBe('pw-lbl');
    expect(retry.json).toEqual({ 'audit-trail': { title: 'Audit', columns: { action: 'Event' } }, _currentPassword: 'pw-lbl' });
    await ackMessage('Saved');
  });

  it('signature required up front: cancel sends nothing and shows no error', async () => {
    const api = setup({ reauth: ['UPDATE_CONFIG_PAGE'] });
    await ready();
    await catalogLoaded(api);
    fireEvent.change(titleInput('Audit Trail'), { target: { value: 'Audit' } });
    await act(async () => { fireEvent.click(saveBtns()[0]); });
    expect(screen.getByText(/Performing "Update Configuration Page" requires identity verification/)).toBeInTheDocument();
    await cancelReauth();
    await waitFor(() => expect(saveBtns()[0]).toHaveTextContent('Save Changes'));
    expect(api.calls('PUT', PUT)).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Error' })).toBeNull();
    expect(saveBtns()[0]).not.toBeDisabled();
  });

  it('a role without CONFIG_UPDATE cannot reset or save', async () => {
    setup({ user: { role: 'QA', permissions: ['CONFIG_READ'] } });
    await ready();
    await waitFor(() => expect(resetBtn()).toBeDisabled());
    fireEvent.change(titleInput('Audit Trail'), { target: { value: 'Audit' } });
    for (const b of saveBtns()) expect(b).toBeDisabled();
    expect(saveBtns()[0]).toHaveAttribute('title', 'CONFIG_UPDATE permission required');
  });

  it('a role holding CONFIG_UPDATE can save', async () => {
    setup({ user: { role: 'ADMIN', permissions: ['CONFIG_UPDATE'] } });
    await ready();
    await waitFor(() => expect(resetBtn()).not.toBeDisabled());
    fireEvent.change(titleInput('Audit Trail'), { target: { value: 'Audit' } });
    expect(saveBtns()[0]).not.toBeDisabled();
  });
});
