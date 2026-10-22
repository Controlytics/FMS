import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { mockApi, renderPage, type MockRoute, type TestUser } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, reauthActions, commonConfigRoutes, type ConsoleCapture } from './support/page-findings';
import { holdRequests } from '@/routes/auth/__tests__/support';
import { expectAllControlsNamed } from '@/components/__tests__/support/a11y';
import { EditUserPage } from '../edit';

/**
 * Edit User through the real data path (SWR -> apiClient -> fetch), real
 * react-hook-form + zod, real useReauth. The load-failure states are covered by
 * edit-load-error.test.tsx; this file covers the loaded page.
 */

const CREATABLE = [
  { name: 'OPERATOR', displayName: 'Operator', color: 'bg-blue-600' },
  { name: 'QA', displayName: 'Quality Assurance', color: 'bg-emerald-600' },
];
const USER = {
  id: 'u-1', username: 'jdoe', fullName: 'Jane Doe', email: 'jane@x.io', department: 'QC',
  role: 'OPERATOR', status: 'ENABLED', createdAt: '2026-01-02T03:04:00.000Z', createdBy: 'root',
  lastLogin: '2026-10-15T10:30:00.000Z', passwordChangedAt: null,
};
const SA: TestUser = { id: 'u-test', role: 'SUPER_ADMIN', permissions: [] };

function routes(opts: { user?: Record<string, unknown>; reauth?: string[]; extra?: MockRoute[]; creatable?: unknown[] } = {}): MockRoute[] {
  return [
    ...(opts.extra ?? []),
    ...commonConfigRoutes(),
    reauthActions(opts.reauth ?? []),
    { path: '/api/config/password-policy/current', body: { minLength: 16 } },
    { path: /^\/api\/roles\/[A-Z_]+\/creatable$/, body: opts.creatable ?? CREATABLE },
    { path: '/api/config/field-ids/current', body: [] },
    { path: '/api/users/u-1', body: { ...USER, ...(opts.user ?? {}) } },
  ];
}

function open(api: ReturnType<typeof mockApi>, user: TestUser = SA) {
  // Descendant routes, so a navigate('/users') visibly lands on the list.
  return renderPage(
    <Routes>
      <Route path="/users/:id" element={<EditUserPage />} />
      <Route path="/users" element={<p>users-list-page</p>} />
    </Routes>,
    { route: '/users/u-1', user, api },
  );
}

const byValue = (v: string) => screen.getByDisplayValue(v) as HTMLInputElement;
const tempPassword = () => (document.querySelector('input[readonly]') as HTMLInputElement).value;

// Page flows run several real round trips; under a loaded machine (other
// agents run vitest in parallel) a few take longer than the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); vi.unstubAllGlobals(); });

describe('Edit User — loaded page', () => {
  it('shows the user, read-only User ID, form values and account activity', async () => {
    const api = mockApi(routes());
    open(api);
    expect(await screen.findByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    expect(screen.getByText('JD')).toBeInTheDocument();
    expect(screen.getByText('@jdoe')).toBeInTheDocument();
    expect(screen.getByText('ENABLED')).toBeInTheDocument();
    expect(byValue('jdoe')).toBeDisabled();
    await waitFor(() => expect(byValue('Jane Doe')).toBeEnabled());
    expect(byValue('jane@x.io')).toBeInTheDocument();
    expect(byValue('QC')).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Quality Assurance' })).toBeInTheDocument();
    expect(screen.getByText('by root')).toBeInTheDocument();
    // password never changed
    expect(screen.getByText('Password Changed').parentElement).toHaveTextContent('Never');
    expect(screen.getByText('Last Login').parentElement).not.toHaveTextContent('Never');
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate Temporary Password/ })).toBeInTheDocument();
    expect(api.unmatched).toEqual([]);
  });

  it('keeps the user\'s current role selectable when it is not a creatable role, and falls back for an odd status', async () => {
    const api = mockApi(routes({ user: { role: 'SHIFT_OFFICER', roleDisplayName: 'Shift Officer', status: 'SUSPENDED', createdBy: null, lastLogin: null, passwordChangedAt: '2026-09-01T08:00:00.000Z' } }));
    open(api);
    expect(await screen.findByRole('option', { name: 'Shift Officer' })).toBeInTheDocument();
    await waitFor(() => expect((screen.getByRole('option', { name: 'Shift Officer' }) as HTMLOptionElement).selected).toBe(true));
    expect(screen.getByText('SUSPENDED')).toBeInTheDocument();
    expect(screen.getByText('by system')).toBeInTheDocument();
    expect(screen.getByText('Last Login').parentElement).toHaveTextContent('Never');
    expect(screen.getByText('Password Changed').parentElement).not.toHaveTextContent('Never');
  });

  it('with an empty creatable list (403 for a USER_UPDATE-only editor) still shows the current role by its code', async () => {
    const api = mockApi(routes({ creatable: [] }));
    open(api, { role: 'MANAGER', permissions: ['USER_READ', 'USER_UPDATE'] });
    expect(await screen.findByRole('option', { name: 'OPERATOR' })).toBeInTheDocument();
  });
});

describe('Edit User — load refused by the server', () => {
  it('a 403 names the permission problem, offers no Retry, and Back to Users leaves', async () => {
    const api = mockApi([
      ...commonConfigRoutes(), reauthActions(),
      { path: '/api/config/password-policy/current', body: {} },
      { path: /^\/api\/roles\/[A-Z_]+\/creatable$/, body: [] },
      { path: '/api/config/field-ids/current', body: [] },
      { path: '/api/users/u-1', status: 403, body: { error: 'FORBIDDEN', message: 'Missing permission USER_READ' } },
    ]);
    open(api, { role: 'OPERATOR', permissions: [] });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You do not have permission to view this user');
    expect(alert).toHaveTextContent('Missing permission USER_READ');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Users' }));
    expect(await screen.findByText('users-list-page')).toBeInTheDocument();
  });
});

describe('Edit User — save', () => {
  it('PUTs the edited fields (no status) and returns to /users', async () => {
    const api = mockApi(routes({ extra: [{ method: 'PUT', path: '/api/users/u-1', body: { ok: true } }] }));
    open(api);
    await screen.findByRole('option', { name: 'Quality Assurance' });
    await waitFor(() => expect(byValue('Jane Doe')).toBeInTheDocument());
    fireEvent.change(byValue('jane@x.io'), { target: { value: 'jane.doe@x.io' } });
    fireEvent.change(byValue('QC'), { target: { value: 'QA Lab' } });
    fireEvent.change(screen.getByDisplayValue('Operator'), { target: { value: 'QA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(api.calls('PUT', '/api/users/u-1')).toHaveLength(1));
    expect(api.calls('PUT', '/api/users/u-1')[0].json).toEqual({ fullName: 'Jane Doe', email: 'jane.doe@x.io', department: 'QA Lab', role: 'QA' });
    expect(await screen.findByText('The user’s details were updated successfully.')).toBeInTheDocument();
    // React Router 7 runs navigate() in a transition, which commits AFTER the toast's
    // urgent update: on a busy CPU the toast can be on screen while /users is not yet.
    expect(await screen.findByText('users-list-page')).toBeInTheDocument();
  });

  it('an emailless user saves with email "" (schema accepts it)', async () => {
    const api = mockApi(routes({ user: { email: null, department: null }, extra: [{ method: 'PUT', path: '/api/users/u-1', body: { ok: true } }] }));
    open(api);
    await waitFor(() => expect(byValue('Jane Doe')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(api.calls('PUT', '/api/users/u-1')).toHaveLength(1));
    expect(api.calls('PUT', '/api/users/u-1')[0].json).toMatchObject({ email: '', department: '' });
  });

  it('client-side validation refuses a bad email and an empty name, sending nothing', async () => {
    const api = mockApi(routes());
    open(api);
    await waitFor(() => expect(byValue('Jane Doe')).toBeInTheDocument());
    fireEvent.change(byValue('jane@x.io'), { target: { value: 'a@b' } });
    fireEvent.change(byValue('Jane Doe'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('Invalid email address')).toBeInTheDocument();
    expect(screen.getByText(/at least 1 character/)).toBeInTheDocument();
    expect(api.calls('PUT', '/api/users/u-1')).toHaveLength(0);
  });

  it('a server refusal is shown in the banner and an error dialog; the page stays', async () => {
    const api = mockApi(routes({ extra: [{ method: 'PUT', path: '/api/users/u-1', status: 409, body: { error: 'EMAIL_TAKEN', message: 'Email already in use' } }] }));
    open(api);
    await waitFor(() => expect(byValue('Jane Doe')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('User update failed')).toBeInTheDocument();
    expect(screen.getAllByText('Email already in use')).toHaveLength(2);
    expect(screen.queryByText('users-list-page')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
  });

  it('UPDATE_USER under re-auth: prompt, then PUT carries the password', async () => {
    const api = mockApi(routes({ reauth: ['UPDATE_USER'], extra: [{ method: 'PUT', path: '/api/users/u-1', body: { ok: true } }] }));
    open(api);
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await waitFor(() => expect(byValue('Jane Doe')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('Confirm Your Identity')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'sig' } });
    fireEvent.click(screen.getByRole('button', { name: /^(Confirm|Verify)/ }));
    await waitFor(() => expect(api.calls('PUT', '/api/users/u-1')).toHaveLength(1));
    const put = api.calls('PUT', '/api/users/u-1')[0];
    expect(put.headers['x-reauth-password']).toBe('sig');
    expect(put.json).toMatchObject({ fullName: 'Jane Doe', _currentPassword: 'sig' });
    expect(await screen.findByText('users-list-page')).toBeInTheDocument();
  });

  it('cancelling the UPDATE_USER prompt saves nothing and stays on the page', async () => {
    const api = mockApi(routes({ reauth: ['UPDATE_USER'] }));
    open(api);
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await waitFor(() => expect(byValue('Jane Doe')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await screen.findByText('Confirm Your Identity');
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).slice(-1)[0]);
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(api.calls('PUT', '/api/users/u-1')).toHaveLength(0);
    expect(screen.queryByText('users-list-page')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    // E-1: a dismissed prompt is not an error — no dialog, no banner (D-OPS-8 pattern)
    expect(screen.queryByText('User update failed')).toBeNull();
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  });
});

describe('Edit User — permissions', () => {
  it('USER_READ only: no Save, "Back" instead of Cancel, and the reset button is replaced by a note', async () => {
    const api = mockApi(routes());
    open(api, { role: 'QA', permissions: ['USER_READ'] });
    expect(await screen.findByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Reset password requires USER_RESET_PASSWORD')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Save Changes' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate Temporary Password/ })).toBeNull();
  });

  it('ADMIN may change email/role but not the user-owned name and department', async () => {
    const api = mockApi(routes());
    open(api, { role: 'ADMIN', permissions: ['USER_READ', 'USER_UPDATE', 'USER_RESET_PASSWORD'] });
    await waitFor(() => expect(byValue('Jane Doe')).toBeDisabled());
    expect(byValue('QC')).toBeDisabled();
    expect(byValue('jane@x.io')).toBeEnabled();
    expect(screen.getAllByText('(User can edit)')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate Temporary Password/ })).toBeInTheDocument();
  });
});

describe('Edit User — temporary password', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
  });

  async function openDialog(api: ReturnType<typeof mockApi>) {
    open(api);
    await screen.findByRole('heading', { name: 'Jane Doe' });
    await waitFor(() => expect(api.calls('GET', '/api/config/password-policy/current').length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    fireEvent.click(screen.getByRole('button', { name: /Generate Temporary Password/ }));
    await screen.findByText(/A temporary password has been generated/);
  }

  it('generates a policy-length password; show/hide, copy, regenerate, cancel', async () => {
    const api = mockApi(routes());
    await openDialog(api);
    expect(tempPassword()).toHaveLength(16);
    const input = document.querySelector('input[readonly]') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(input.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(input.type).toBe('password');

    const first = tempPassword();
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(first);
    fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }));
    await waitFor(() => expect(tempPassword()).not.toBe(first));
    expect(screen.queryByText('Copied!')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).slice(-1)[0]);
    await waitFor(() => expect(screen.queryByText(/A temporary password has been generated/)).toBeNull());
    expect(api.calls('POST', '/api/users/u-1/reset-password')).toHaveLength(0);
  });

  it('Escape closes the temporary-password dialog without setting anything', async () => {
    const api = mockApi(routes());
    await openDialog(api);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText(/A temporary password has been generated/)).toBeNull());
    expect(api.calls('POST', '/api/users/u-1/reset-password')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
  });

  it('copy falls back to execCommand when the clipboard API is refused; Copied! resets', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    const api = mockApi(routes());
    await openDialog(api);
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
    expect(exec).toHaveBeenCalledWith('copy');
    await waitFor(() => expect(screen.queryByText('Copied!')).toBeNull(), { timeout: 3000 });
  });

  it('Confirm & Set Password shows "Setting Password..." while it runs, POSTs the shown password, closes and confirms (E-2)', async () => {
    const api = mockApi(routes({ extra: [{ method: 'POST', path: '/api/users/u-1/reset-password', body: { ok: true } }] }));
    await openDialog(api);
    const pw = tempPassword();
    const hold = holdRequests(/\/api\/users\/u-1\/reset-password/);
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Set Password/ }));
    // E-2: the in-flight state is visible (the dialog used to close before it rendered)
    expect(await screen.findByRole('button', { name: /Setting Password/ })).toBeDisabled();
    hold.release();
    await waitFor(() => expect(api.calls('POST', '/api/users/u-1/reset-password')).toHaveLength(1));
    expect(api.calls('POST', '/api/users/u-1/reset-password')[0].json).toEqual({ newPassword: pw });
    await waitFor(() => expect(screen.queryByText(/A temporary password has been generated/)).toBeNull());
    // E-2: a successful reset is acknowledged, like unlock on the Users list
    expect(await screen.findByText('Password reset')).toBeInTheDocument();
    expect(screen.getByText('User "jdoe" must sign in with the temporary password and change it.')).toBeInTheDocument();
    // the user is re-read so the activity panel reflects the change
    await waitFor(() => expect(api.calls('GET', '/api/users/u-1').length).toBeGreaterThan(1));
  });

  it('cancelling the RESET_PASSWORD prompt is silent and returns to the dialog (E-3)', async () => {
    const api = mockApi(routes({ reauth: ['RESET_PASSWORD'] }));
    await openDialog(api);
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    const pw = tempPassword();
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Set Password/ }));
    await screen.findByPlaceholderText('Enter your password');
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).slice(-1)[0]);
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(api.calls('POST', '/api/users/u-1/reset-password')).toHaveLength(0);
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    // still on the temporary-password dialog, same password, ready to confirm again
    expect(screen.getByText(/A temporary password has been generated/)).toBeInTheDocument();
    expect(tempPassword()).toBe(pw);
    expect(screen.getByRole('button', { name: /Confirm & Set Password/ })).toBeEnabled();
  });

  it('a refused reset is reported in the page banner', async () => {
    const api = mockApi(routes({ extra: [{ method: 'POST', path: '/api/users/u-1/reset-password', status: 400, body: { error: 'PASSWORD_REUSED', message: 'Password was used recently' } }] }));
    await openDialog(api);
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Set Password/ }));
    expect(await screen.findByText('Password was used recently')).toBeInTheDocument();
  });

  it('RESET_PASSWORD under re-auth sends newPassword plus the signature', async () => {
    const api = mockApi(routes({ reauth: ['RESET_PASSWORD'], extra: [{ method: 'POST', path: '/api/users/u-1/reset-password', body: { ok: true } }] }));
    await waitFor(() => true);
    await openDialog(api);
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    const pw = tempPassword();
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Set Password/ }));
    fireEvent.change(await screen.findByPlaceholderText('Enter your password'), { target: { value: 'adm' } });
    fireEvent.click(screen.getByRole('button', { name: /^(Confirm|Verify)/ }));
    await waitFor(() => expect(api.calls('POST', '/api/users/u-1/reset-password')).toHaveLength(1));
    const sent = api.calls('POST', '/api/users/u-1/reset-password')[0];
    expect(sent.json).toEqual({ newPassword: pw, _currentPassword: 'adm' });
    expect(sent.headers['x-reauth-password']).toBe('adm');
  });
});

describe('Edit User — accessibility + console', () => {
  it('every control is named by its label — form and temporary-password dialog — and the page logs nothing', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    const api = mockApi(routes());
    open(api);
    await waitFor(() => expect(byValue('Jane Doe')).toBeInTheDocument());
    expect(screen.getByLabelText(/^User ID/)).toHaveValue('jdoe');
    expect(screen.getByLabelText(/^Full Name/)).toHaveValue('Jane Doe');
    expect(screen.getByLabelText(/^Email/)).toHaveValue('jane@x.io');
    expect(screen.getByLabelText(/^Department/)).toHaveValue('QC');
    expect(screen.getByLabelText(/^Role/)).toHaveAttribute('name', 'role');
    expectAllControlsNamed();
    expect(unlabeledControls()).toEqual({ none: [], placeholderOnly: [] });
    fireEvent.click(screen.getByRole('button', { name: /Generate Temporary Password/ }));
    await screen.findByText(/A temporary password has been generated/);
    expect(screen.getByLabelText('Temporary Password')).toHaveAttribute('readonly');
    expectAllControlsNamed();
    expect(unlabeledControls()).toEqual({ none: [], placeholderOnly: [] });
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
