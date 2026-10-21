import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { DatetimeConfigPage } from '../datetime';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';
import { spyConsoleError, expectSilentCancel } from './reauth-cancel-assertions';

afterEach(() => { vi.restoreAllMocks(); resetEnv(); });

const PATH = '/api/config/datetime';
const SAVED = { dateFormat: 'DD/MM/YYYY', timeFormat: '24-hour', timezone: 'Asia/Kolkata' };

function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }

function setup(opts: { user?: any; extra?: MockRoute[]; data?: unknown; reauth?: string[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: PATH, body: opts.data ?? SAVED },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<><DatetimeConfigPage /><Where /></>, { user: opts.user ?? SUPER_ADMIN, api, route: '/config/datetime' });
  return api;
}

const dateSelect = () => screen.getAllByRole('combobox')[0] as HTMLSelectElement;
const timeSelect = () => screen.getAllByRole('combobox')[1] as HTMLSelectElement;
const saveBtn = () => screen.getByRole('button', { name: /Save Changes|Saving/ });
const loaded = () => waitFor(() => expect(dateSelect().value).toBe('DD/MM/YYYY'));

const tz = { timeZone: 'Asia/Kolkata' } as const;

describe('Date/Time format config page', () => {
  it('loads the saved formats and previews today in the configured timezone', async () => {
    const api = setup();
    await loaded();
    expect(timeSelect().value).toBe('24-hour');
    const today = new Date().toLocaleDateString('en-GB', tz);
    expect(screen.getAllByText(today).length).toBeGreaterThan(0);
    expect(saveBtn()).toBeDisabled();
    expect(api.unmatched).toEqual([]);
  });

  it('every date format option re-renders the live preview', async () => {
    setup();
    await loaded();
    const now = new Date();
    const cases: [string, string][] = [
      ['MM/DD/YYYY', now.toLocaleDateString('en-US', tz)],
      ['DD-MMM-YYYY', now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', ...tz }).replace(/ /g, '-')],
      ['MMM DD, YYYY', now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...tz })],
      ['YYYY-MM-DD', `${now.toLocaleString('en-US', { year: 'numeric', ...tz })}-${now.toLocaleString('en-US', { month: '2-digit', ...tz })}-${now.toLocaleString('en-US', { day: '2-digit', ...tz })}`],
    ];
    for (const [fmt, expected] of cases) {
      fireEvent.change(dateSelect(), { target: { value: fmt } });
      await waitFor(() => expect(screen.getAllByText(expected, { exact: false }).length).toBeGreaterThan(0));
    }
    // Any edit makes the form dirty.
    expect(saveBtn()).not.toBeDisabled();
  });

  it('switching to 12-hour shows an AM/PM time in the preview', async () => {
    setup();
    await loaded();
    fireEvent.change(timeSelect(), { target: { value: '12-hour' } });
    const t12 = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, ...tz });
    await waitFor(() => expect(screen.getAllByText(t12, { exact: false }).length).toBeGreaterThan(0));
    expect(t12).toMatch(/AM|PM/);
  });

  it('saves the whole form with PUT, shows success and becomes clean again', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.change(dateSelect(), { target: { value: 'YYYY-MM-DD' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json).toEqual({ dateFormat: 'YYYY-MM-DD', timeFormat: '24-hour', timezone: 'Asia/Kolkata' });
    expect(api.calls('PUT', PATH)[0].headers['x-reauth-password']).toBeUndefined();
    expect(await screen.findByText('Date/time format updated successfully')).toBeInTheDocument();
    await waitFor(() => expect(saveBtn()).toBeDisabled());
  });

  it('when UPDATE_DATETIME_CONFIG needs a signature, prompts first and sends the password', async () => {
    const api = setup({ reauth: ['UPDATE_DATETIME_CONFIG'], extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    // Wait for my-actions to land so the prompt opens up front.
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(timeSelect(), { target: { value: '12-hour' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await act(async () => { fireEvent.click(saveBtn()); });
    await screen.findByPlaceholderText('Enter your password');
    expect(api.calls('PUT', PATH)).toHaveLength(0);
    await signReauth('pw-dt');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    const put = api.calls('PUT', PATH)[0];
    expect(put.headers['x-reauth-password']).toBe('pw-dt');
    expect(put.json).toEqual({ ...SAVED, timeFormat: '12-hour', _currentPassword: 'pw-dt' });
    expect(await screen.findByText('Date/time format updated successfully')).toBeInTheDocument();
  });

  it('a server-side REAUTH_REQUIRED opens the prompt retroactively; cancelling it reports no failure (item 9)', async () => {
    const consoleError = spyConsoleError();
    const api = setup({ extra: [reauthRequired('PUT', PATH)] });
    await loaded();
    fireEvent.change(timeSelect(), { target: { value: '12-hour' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await act(async () => { fireEvent.click(saveBtn()); });
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expectSilentCancel(consoleError);
    expect(api.calls('PUT', PATH)).toHaveLength(1);
    // The edit is still pending and can be saved again.
    expect(timeSelect().value).toBe('12-hour');
    expect(saveBtn()).not.toBeDisabled();
  });

  it('cancelling an up-front signature sends nothing and reports no failure (item 9)', async () => {
    const consoleError = spyConsoleError();
    const api = setup({ reauth: ['UPDATE_DATETIME_CONFIG'] });
    await loaded();
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(timeSelect(), { target: { value: '12-hour' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await act(async () => { fireEvent.click(saveBtn()); });
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expectSilentCancel(consoleError);
    expect(api.calls('PUT', PATH)).toHaveLength(0);
    expect(saveBtn()).not.toBeDisabled();
  });

  it('a refused save shows the server message inline', async () => {
    setup({ extra: [{ method: 'PUT', path: PATH, status: 403, body: { error: 'FORBIDDEN', message: 'Super Admin only' } }] });
    await loaded();
    fireEvent.change(dateSelect(), { target: { value: 'MM/DD/YYYY' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('Super Admin only')).toBeInTheDocument();
    expect(screen.queryByText('Date/time format updated successfully')).toBeNull();
  });

  it('a refusal with no message names the status code', async () => {
    setup({ extra: [{ method: 'PUT', path: PATH, status: 400, body: {} }] });
    await loaded();
    fireEvent.change(dateSelect(), { target: { value: 'MM/DD/YYYY' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await act(async () => { fireEvent.click(saveBtn()); });
    // apiClient builds "Request failed: 400" when the body carries no message.
    expect(await screen.findByText('Request failed: 400')).toBeInTheDocument();
  });

  it('a refusal with an empty message falls back to "Failed to update"', async () => {
    setup({ extra: [{ method: 'PUT', path: PATH, status: 400, body: { error: 'X', message: '' } }] });
    await loaded();
    fireEvent.change(dateSelect(), { target: { value: 'MM/DD/YYYY' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('Failed to update')).toBeInTheDocument();
  });

  it('a stored date format the page does not know previews as DD/MM/YYYY', async () => {
    setup({ data: { ...SAVED, dateFormat: 'YYYY.MM.DD' } });
    await waitFor(() => expect(timeSelect().value).toBe('24-hour'));
    expect(screen.getAllByText(new Date().toLocaleDateString('en-GB', tz), { exact: false }).length).toBeGreaterThan(0);
  });

  it('a role without CONFIG_UPDATE cannot save, even after editing', async () => {
    setup({ user: { role: 'QA', permissions: ['CONFIG_READ'] } });
    await loaded();
    fireEvent.change(dateSelect(), { target: { value: 'MM/DD/YYYY' } });
    await waitFor(() => expect(saveBtn()).toHaveAttribute('title', 'CONFIG_UPDATE permission required'));
    expect(saveBtn()).toBeDisabled();
  });

  it('a non-super-admin holding CONFIG_UPDATE can save', async () => {
    setup({ user: { role: 'ADMIN', permissions: ['CONFIG_READ', 'CONFIG_UPDATE'] } });
    await loaded();
    fireEvent.change(dateSelect(), { target: { value: 'MM/DD/YYYY' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    expect(saveBtn()).not.toHaveAttribute('title');
  });

  it('an unusable stored timezone falls back to a plain preview instead of crashing', async () => {
    setup({ data: { ...SAVED, timeFormat: '12-hour', timezone: 'Mars/Olympus' } });
    await waitFor(() => expect(timeSelect().value).toBe('12-hour'));
    const now = new Date();
    // The preview reads watched values, which settle a render after the inputs.
    await waitFor(() => {
      expect(screen.getAllByText(now.toLocaleDateString('en-GB'), { exact: false }).length).toBeGreaterThan(0);
      expect(screen.getAllByText(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }), { exact: false }).length).toBeGreaterThan(0);
    });
    fireEvent.change(timeSelect(), { target: { value: '24-hour' } });
    const t24 = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    await waitFor(() => expect(screen.getAllByText(t24, { exact: false }).length).toBeGreaterThan(0));
  });

  it('Cancel goes back to the configuration index', async () => {
    setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/config');
    expect(screen.getByTestId('where').textContent).toBe('/config');
  });
});
