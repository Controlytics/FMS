import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type MockRequest } from '@/test-utils/page-harness';
import { PaginationConfigPage } from '../pagination';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';
import { spyConsoleError, expectSilentCancel } from './reauth-cancel-assertions';

vi.setConfig({ testTimeout: 30000 });
afterEach(() => { vi.restoreAllMocks(); resetEnv(); });

const PATH = '/api/config/pagination';
const W = { timeout: 5000 };

function setup(opts: { data?: unknown; extra?: MockRoute[]; reauth?: string[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: PATH, body: opts.data ?? { limit: 200, count: 4, options: [10, 20, 50, 100] } },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<PaginationConfigPage />, { user: SUPER_ADMIN, api });
  return api;
}

const numberInputs = () => screen.getAllByRole('spinbutton') as HTMLInputElement[];
const limitInput = () => numberInputs()[0];
const countInput = () => numberInputs()[1];
const optionInputs = () => numberInputs().slice(2);
const optionValues = () => optionInputs().map((i) => i.value);
const saveBtn = () => screen.getByRole('button', { name: /Save Settings|Saving/ });
const previewChips = () => {
  const label = screen.getByText('Rows per page:');
  return Array.from(label.nextElementSibling!.querySelectorAll('span')).map((s) => s.textContent);
};

describe('Pagination settings page', () => {
  it('loads the stored limit, count and options; Save stays disabled until something changes', async () => {
    const api = setup();
    await waitFor(() => expect(limitInput().value).toBe('200'), W);
    expect(countInput().value).toBe('4');
    expect(optionValues()).toEqual(['10', '20', '50', '100']);
    expect(screen.getAllByText(/^Option \d$/)).toHaveLength(4);
    expect(previewChips()).toEqual(['10', '20', '50', '100']);
    expect(screen.getByText('(100 total records)')).toBeInTheDocument();
    expect(screen.getByText(/between 5 and the limit \(200\)/)).toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
    expect(api.unmatched).toEqual([]);
  });

  it('a stored row without `count` takes it from the options length and is not dirty on load', async () => {
    setup({ data: { limit: 100, options: [10, 25] } });
    await waitFor(() => expect(countInput().value).toBe('2'), W);
    expect(optionValues()).toEqual(['10', '25']);
    expect(saveBtn()).toBeDisabled();
  });

  it('an empty stored row falls back to the defaults (100 / 3 / 10,25,50)', async () => {
    setup({ data: {} });
    await waitFor(() => expect(screen.getByText(/between 5 and the limit \(100\)/)).toBeInTheDocument(), W);
    expect(limitInput().value).toBe('100');
    expect(countInput().value).toBe('3');
    expect(optionValues()).toEqual(['10', '25', '50']);
    expect(saveBtn()).toBeDisabled();
  });

  it('a stored count larger than its options grows the list in steps of 10, capped at the limit', async () => {
    setup({ data: { limit: 25, count: 4, options: [10, 20] } });
    await waitFor(() => expect(optionValues()).toEqual(['10', '20', '25', '25']), W);
    expect(saveBtn()).toBeDisabled();
  });

  it('an empty stored options list grows from 10 (first entry 20)', async () => {
    setup({ data: { limit: 100, count: 2, options: [] } });
    await waitFor(() => expect(optionValues()).toEqual(['20', '30']), W);
  });

  it('a stored count smaller than its options trims the list', async () => {
    setup({ data: { limit: 100, count: 2, options: [10, 20, 30] } });
    await waitFor(() => expect(optionValues()).toEqual(['10', '20']), W);
    expect(saveBtn()).toBeDisabled();
  });

  it('raising Count adds option inputs; out-of-range and non-numeric entries are ignored', async () => {
    setup();
    await waitFor(() => expect(countInput().value).toBe('4'), W);
    fireEvent.change(countInput(), { target: { value: '6' } });
    expect(countInput().value).toBe('6');
    expect(optionValues()).toEqual(['10', '20', '50', '100', '110', '120']);
    // 11 and 1 are outside 2..10 -> ignored
    fireEvent.change(countInput(), { target: { value: '11' } });
    expect(countInput().value).toBe('6');
    fireEvent.change(countInput(), { target: { value: '1' } });
    expect(countInput().value).toBe('6');
    // Non-numeric text in limit / option inputs is ignored
    fireEvent.change(limitInput(), { target: { value: '' } });
    expect(limitInput().value).toBe('200');
    fireEvent.change(optionInputs()[0], { target: { value: '' } });
    expect(optionValues()[0]).toBe('10');
    // Lowering Count trims again
    fireEvent.change(countInput(), { target: { value: '3' } });
    expect(optionValues()).toEqual(['10', '20', '50']);
    expect(saveBtn()).not.toBeDisabled();
  });

  it('Save sends the options SORTED, shows success, re-reads the config and disables again', async () => {
    let stored: any = { limit: 200, count: 4, options: [10, 20, 50, 100] };
    const api = mockApi([
      { method: 'PUT', path: PATH, body: (r: MockRequest) => { stored = { limit: r.json.limit, count: r.json.count, options: r.json.options }; return { ok: true }; } },
      { path: PATH, body: () => stored },
      ...commonRoutes(),
    ]);
    renderPage(<PaginationConfigPage />, { user: SUPER_ADMIN, api });
    await waitFor(() => expect(limitInput().value).toBe('200'), W);
    fireEvent.change(optionInputs()[0], { target: { value: '75' } });
    expect(previewChips()).toEqual(['20', '50', '75', '100']);
    expect(saveBtn()).not.toBeDisabled();
    const gets = api.calls('GET', PATH).length;
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), W);
    expect(api.calls('PUT', PATH)[0].json).toEqual({ limit: 200, count: 4, options: [20, 50, 75, 100] });
    expect(api.calls('PUT', PATH)[0].headers['x-reauth-password']).toBeUndefined();
    expect(await screen.findByText('Pagination settings saved successfully.', undefined, W)).toBeInTheDocument();
    // The page re-reads the row (bound mutate) and re-seeds its baseline.
    await waitFor(() => expect(api.calls('GET', PATH).length).toBeGreaterThan(gets), W);
    await waitFor(() => expect(optionValues()).toEqual(['20', '50', '75', '100']), W);
    await waitFor(() => expect(saveBtn()).toBeDisabled(), W);
  });

  it('refuses a limit below 1 without sending anything', async () => {
    const api = setup();
    await waitFor(() => expect(limitInput().value).toBe('200'), W);
    fireEvent.change(limitInput(), { target: { value: '0' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText('Limit must be at least 1.')).toBeInTheDocument();
    expect(api.calls('PUT', PATH)).toHaveLength(0);
  });

  it('refuses a stored count outside 2..10 once the row is edited', async () => {
    const api = setup({ data: { limit: 100, count: 1, options: [10, 25] } });
    await waitFor(() => expect(optionValues()).toEqual(['10']), W);
    fireEvent.change(optionInputs()[0], { target: { value: '15' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText('Count must be between 2 and 10.')).toBeInTheDocument();
    expect(api.calls('PUT', PATH)).toHaveLength(0);
  });

  it('refuses an option below 5 or above the limit, naming the option', async () => {
    const api = setup();
    await waitFor(() => expect(limitInput().value).toBe('200'), W);
    fireEvent.change(optionInputs()[1], { target: { value: '3' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText('Option 2 must be between 5 and 200.')).toBeInTheDocument();
    fireEvent.change(optionInputs()[1], { target: { value: '20' } });
    fireEvent.change(optionInputs()[3], { target: { value: '500' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText('Option 4 must be between 5 and 200.')).toBeInTheDocument();
    expect(api.calls('PUT', PATH)).toHaveLength(0);
  });

  it('refuses duplicate option values', async () => {
    const api = setup();
    await waitFor(() => expect(limitInput().value).toBe('200'), W);
    fireEvent.change(optionInputs()[1], { target: { value: '10' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText('All option values must be different.')).toBeInTheDocument();
    expect(api.calls('PUT', PATH)).toHaveLength(0);
  });

  it('Reset to Default restores 100 / 3 / 10,25,50 and makes the page dirty', async () => {
    setup();
    await waitFor(() => expect(limitInput().value).toBe('200'), W);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Default' }));
    expect(limitInput().value).toBe('100');
    expect(countInput().value).toBe('3');
    expect(optionValues()).toEqual(['10', '25', '50']);
    expect(saveBtn()).not.toBeDisabled();
  });

  it('a refused save shows the server message and keeps the edit', async () => {
    setup({ extra: [{ method: 'PUT', path: PATH, status: 400, body: { error: 'VALIDATION', message: 'limit too large' } }] });
    await waitFor(() => expect(limitInput().value).toBe('200'), W);
    fireEvent.change(optionInputs()[0], { target: { value: '15' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('limit too large', undefined, W)).toBeInTheDocument();
    expect(optionValues()[0]).toBe('15');
    expect(saveBtn()).not.toBeDisabled();
  });

  it('server demands a signature: prompts, then retries with the password', async () => {
    const api = setup({ extra: [reauthRequired('PUT', PATH), { method: 'PUT', path: PATH, body: { ok: true } }] });
    await waitFor(() => expect(limitInput().value).toBe('200'), W);
    fireEvent.change(optionInputs()[0], { target: { value: '15' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await signReauth('pw-p');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(2), W);
    const retry = api.calls('PUT', PATH)[1];
    expect(retry.headers['x-reauth-password']).toBe('pw-p');
    expect(retry.json).toEqual({ limit: 200, count: 4, options: [15, 20, 50, 100], _currentPassword: 'pw-p' });
    expect(await screen.findByText('Pagination settings saved successfully.', undefined, W)).toBeInTheDocument();
  });

  it('signature required up front: cancelling sends nothing and shows no error (item 9)', async () => {
    const consoleError = spyConsoleError();
    const api = setup({ reauth: ['UPDATE_CONFIG_PAGE'] });
    await waitFor(() => expect(limitInput().value).toBe('200'), W);
    fireEvent.change(optionInputs()[0], { target: { value: '15' } });
    // The re-auth catalogue must have loaded before Save decides whether to prompt.
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(screen.getByText(/Performing "Update Configuration Page" requires identity verification/)).toBeInTheDocument();
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(api.calls('PUT', PATH)).toHaveLength(0);
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expectSilentCancel(consoleError);
    expect(saveBtn()).not.toBeDisabled();
  });

  it('cancelling a server-demanded signature shows no error and frees Save (item 9)', async () => {
    const consoleError = spyConsoleError();
    const api = setup({ extra: [reauthRequired('PUT', PATH)] });
    await waitFor(() => expect(limitInput().value).toBe('200'), W);
    fireEvent.change(optionInputs()[0], { target: { value: '15' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expectSilentCancel(consoleError);
    expect(api.calls('PUT', PATH)).toHaveLength(1);
    expect(saveBtn()).not.toBeDisabled();
  });
});
