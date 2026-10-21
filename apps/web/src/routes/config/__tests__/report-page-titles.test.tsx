import { describe, it, expect, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { ReportPageTitlesPage } from '../report-page-titles';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth, ackMessage } from './config-test-helpers';

afterEach(resetEnv);

const PATH = '/api/config/report-page-titles';

function setup(user = SUPER_ADMIN, extra: Parameters<typeof mockApi>[0] = [], data: unknown = { companyName: 'Acme Pharma' }) {
  const api = mockApi([
    ...extra,
    { path: PATH, body: data },
    { path: '/api/config/branding', body: { companyName: 'Brand Co', appName: 'Brand App' } },
    ...commonRoutes(),
  ]);
  renderPage(<ReportPageTitlesPage />, { user, api });
  return api;
}

const companyInput = () => screen.getByPlaceholderText('Brand Co') as HTMLInputElement;
const appInput = () => screen.getByPlaceholderText('Brand App') as HTMLInputElement;
const saveBtn = () => screen.getByRole('button', { name: /Save Changes|Saving/ });

describe('Report identity (report-page-titles)', () => {
  it('loads the saved override and shows the Branding fallback for the blank field', async () => {
    setup();
    await waitFor(() => expect(companyInput().value).toBe('Acme Pharma'));
    expect(screen.getByText('Acme Pharma', { selector: 'span' })).toBeInTheDocument();
    // appName blank -> "Blank — using Branding: Brand App"
    expect(await screen.findByText('Brand App', { selector: 'span' })).toBeInTheDocument();
    expect(appInput().value).toBe('');
    // Nothing edited yet -> Save disabled.
    expect(saveBtn()).toBeDisabled();
  });

  it('saves the edited draft with PUT and confirms', async () => {
    const api = setup(SUPER_ADMIN, [{ method: 'PUT', path: PATH, body: { ok: true } }]);
    await waitFor(() => expect(companyInput().value).toBe('Acme Pharma'));
    fireEvent.change(appInput(), { target: { value: 'FilterOps' } });
    expect(saveBtn()).not.toBeDisabled();
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json).toEqual({ companyName: 'Acme Pharma', appName: 'FilterOps' });
    expect(await ackMessage('Saved')).toContain('Report identity updated.');
  });

  it('server demands a signature: prompts, then retries with the password', async () => {
    const api = setup(SUPER_ADMIN, [reauthRequired('PUT', PATH), { method: 'PUT', path: PATH, body: { ok: true } }]);
    await waitFor(() => expect(companyInput().value).toBe('Acme Pharma'));
    fireEvent.change(companyInput(), { target: { value: 'Acme 2' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await signReauth('pw-1');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(2));
    const retry = api.calls('PUT', PATH)[1];
    expect(retry.headers['x-reauth-password']).toBe('pw-1');
    expect(retry.json).toEqual({ companyName: 'Acme 2', _currentPassword: 'pw-1' });
    await ackMessage('Saved');
  });

  it('cancelling the signature does not report a failure', async () => {
    const api = setup(SUPER_ADMIN, [reauthRequired('PUT', PATH)]);
    await waitFor(() => expect(companyInput().value).toBe('Acme Pharma'));
    fireEvent.change(companyInput(), { target: { value: 'Acme 3' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(screen.queryByRole('heading', { name: 'Save failed' })).toBeNull();
    expect(api.calls('PUT', PATH)).toHaveLength(1);
    expect(saveBtn()).not.toBeDisabled();
  });

  it('a refused save shows the server message', async () => {
    setup(SUPER_ADMIN, [{ method: 'PUT', path: PATH, status: 400, body: { error: 'VALIDATION', message: 'Company name too long' } }]);
    await waitFor(() => expect(companyInput().value).toBe('Acme Pharma'));
    fireEvent.change(companyInput(), { target: { value: 'x' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await ackMessage('Save failed')).toContain('Company name too long');
  });

  it('a role without CONFIG_UPDATE gets read-only inputs and a disabled Save', async () => {
    setup({ role: 'QA', permissions: ['CONFIG_READ'] });
    await waitFor(() => expect(companyInput().value).toBe('Acme Pharma'));
    await waitFor(() => expect(companyInput()).toBeDisabled());
    expect(saveBtn()).toBeDisabled();
    expect(saveBtn()).toHaveAttribute('title', 'CONFIG_UPDATE permission required');
  });

  it('a role holding CONFIG_UPDATE can edit', async () => {
    setup({ role: 'ADMIN', permissions: ['CONFIG_READ', 'CONFIG_UPDATE'] });
    await waitFor(() => expect(companyInput().value).toBe('Acme Pharma'));
    await waitFor(() => expect(companyInput()).not.toBeDisabled());
  });
});
