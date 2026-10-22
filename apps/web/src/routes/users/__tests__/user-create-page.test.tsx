import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type TestUser } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, reauthActions, commonConfigRoutes, type ConsoleCapture } from './support/page-findings';
import { holdRequests, LocationProbe } from '@/routes/auth/__tests__/support';
import { CreateUserPage } from '../create';

/** Create User. Real react-hook-form + zod, SWR, apiClient, useReauth; fetch stubbed. */

const CREATABLE = [
  { name: 'OPERATOR', displayName: 'Operator', color: 'bg-blue-600' },
  { name: 'QA', displayName: 'Quality Assurance', color: 'bg-emerald-600' },
];
const SA: TestUser = { id: 'u-test', role: 'SUPER_ADMIN', permissions: [] };

function routes(opts: { reauth?: string[]; extra?: MockRoute[]; policy?: Record<string, unknown> } = {}): MockRoute[] {
  return [
    ...(opts.extra ?? []),
    ...commonConfigRoutes(),
    reauthActions(opts.reauth ?? []),
    { path: '/api/config/password-policy/current', body: opts.policy ?? { minLength: 14 } },
    { path: '/api/roles/SUPER_ADMIN/creatable', body: CREATABLE },
    { path: '/api/roles/ADMIN/creatable', body: CREATABLE.slice(0, 1) },
    { path: '/api/config/field-ids/current', body: [{ fieldId: 'FLD_USER_001', displayName: 'Employee ID' }] },
  ];
}

function Page() {
  return <><CreateUserPage /><LocationProbe /></>;
}

const fill = (placeholder: string | RegExp, value: string) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

async function fillValid() {
  await screen.findByRole('option', { name: 'Quality Assurance' });
  fill(/Enter employee id/, 'emp1001');
  fill('Enter full name', 'Asha Rao');
  fill('user@example.com (optional)', 'asha@example.com');
  fill('Enter department (optional)', 'QC');
  fireEvent.change(screen.getByDisplayValue('Select a role'), { target: { value: 'QA' } });
}

const tempPassword = () => (document.querySelector('input[readonly]') as HTMLInputElement).value;

// Page flows run several real round trips; under a loaded machine (other
// agents run vitest in parallel) a few take longer than the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); vi.unstubAllGlobals(); });

describe('Create User — form', () => {
  it('loads the roles this user may create and the configured field label', async () => {
    const api = mockApi(routes());
    renderPage(<Page />, { route: '/users/create', user: SA, api });
    expect(await screen.findByRole('option', { name: 'Operator' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Quality Assurance' })).toBeInTheDocument();
    expect(await screen.findByPlaceholderText('Enter employee id (6-50 characters)')).toBeInTheDocument();
    expect(api.calls('GET', '/api/roles/SUPER_ADMIN/creatable')).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: /Back to Users|Cancel/ }).every((a) => a.getAttribute('href') === '/users')).toBe(true);
  });

  it('asks the creatable-roles endpoint for the CALLER\'s role', async () => {
    const api = mockApi(routes());
    renderPage(<Page />, { route: '/users/create', user: { role: 'ADMIN', permissions: ['USER_CREATE'] }, api });
    expect(await screen.findByRole('option', { name: 'Operator' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Quality Assurance' })).toBeNull();
    expect(api.calls('GET', '/api/roles/ADMIN/creatable')).toHaveLength(1);
    expect(api.calls('GET', '/api/roles/SUPER_ADMIN/creatable')).toHaveLength(0);
  });

  it('refuses an empty / invalid form client-side and sends nothing', async () => {
    const api = mockApi(routes());
    renderPage(<Page />, { route: '/users/create', user: SA, api });
    await screen.findByRole('option', { name: 'Operator' });
    fill(/Enter employee id/, 'abc');
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
    expect(await screen.findByText('Minimum 6 characters')).toBeInTheDocument();
    expect(screen.getByText('Full name is required')).toBeInTheDocument();
    expect(screen.getByText('Role is required')).toBeInTheDocument();
    expect(api.calls('POST', '/api/users')).toHaveLength(0);
  });

  it('an address the browser accepts but zod rejects (a@b) is refused with "Invalid email address"', async () => {
    const api = mockApi(routes());
    renderPage(<Page />, { route: '/users/create', user: SA, api });
    await fillValid();
    fill('user@example.com (optional)', 'a@b');
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
    expect(await screen.findByText('Invalid email address')).toBeInTheDocument();
    expect(api.calls('POST', '/api/users')).toHaveLength(0);
  });

  it('a valid form POSTs the user with the generated temporary password, then goes to /users', async () => {
    const api = mockApi(routes({ extra: [{ method: 'POST', path: '/api/users', status: 201, body: { id: 'new' } }] }));
    renderPage(<Page />, { route: '/users/create', user: SA, api });
    await fillValid();
    // the generator honours the policy length once the policy arrives
    await waitFor(() => expect(tempPassword().length).toBe(14));
    const pw = tempPassword();

    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
    await waitFor(() => expect(api.calls('POST', '/api/users')).toHaveLength(1));
    expect(api.calls('POST', '/api/users')[0].json).toEqual({
      username: 'emp1001', fullName: 'Asha Rao', email: 'asha@example.com', department: 'QC',
      role: 'QA', password: pw, confirmPassword: pw, status: 'ENABLED',
    });
    expect(await screen.findByText('User "emp1001" was created successfully.')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/users');
  });

  it('shows "Creating..." and disables submit while the request is in flight', async () => {
    const api = mockApi(routes({ extra: [{ method: 'POST', path: '/api/users', status: 201, body: { id: 'new' } }] }));
    renderPage(<Page />, { route: '/users/create', user: SA, api });
    await fillValid();
    const hold = holdRequests(/\/api\/users$/);
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
    expect(await screen.findByRole('button', { name: 'Creating...' })).toBeDisabled();
    hold.release();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/users'));
  });

  it('a server refusal shows the message in the page banner and an error dialog, and stays on the form', async () => {
    const api = mockApi(routes({ extra: [{ method: 'POST', path: '/api/users', status: 409, body: { error: 'USERNAME_TAKEN', message: 'User ID already exists' } }] }));
    renderPage(<Page />, { route: '/users/create', user: SA, api });
    await fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
    expect(await screen.findByText('User creation failed')).toBeInTheDocument();
    expect(screen.getAllByText('User ID already exists')).toHaveLength(2); // banner + dialog
    expect(screen.getByTestId('location')).toHaveTextContent('/users/create');
  });

  it('CREATE_USER under re-auth: prompt, then POST carries the password in header and body', async () => {
    const api = mockApi(routes({ reauth: ['CREATE_USER'], extra: [{ method: 'POST', path: '/api/users', status: 201, body: { id: 'new' } }] }));
    renderPage(<Page />, { route: '/users/create', user: SA, api });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
    expect(await screen.findByText('Confirm Your Identity')).toBeInTheDocument();
    expect(screen.getByText(/Performing "Create User" requires identity verification/)).toBeInTheDocument();
    expect(api.calls('POST', '/api/users')).toHaveLength(0);
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'Admin@123' } });
    fireEvent.click(screen.getByRole('button', { name: /^(Confirm|Verify)/ }));
    await waitFor(() => expect(api.calls('POST', '/api/users')).toHaveLength(1));
    const sent = api.calls('POST', '/api/users')[0];
    expect(sent.headers['x-reauth-password']).toBe('Admin@123');
    expect(sent.json).toMatchObject({ username: 'emp1001', role: 'QA', _currentPassword: 'Admin@123' });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/users'));
  });

  it('cancelling the password prompt creates nothing and stays on the form', async () => {
    const api = mockApi(routes({ reauth: ['CREATE_USER'] }));
    renderPage(<Page />, { route: '/users/create', user: SA, api });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
    await screen.findByText('Confirm Your Identity');
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).slice(-1)[0]);
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(api.calls('POST', '/api/users')).toHaveLength(0);
    expect(screen.getByTestId('location')).toHaveTextContent('/users/create');
  });
});

describe('Create User — temporary password', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
  });

  it('Show/Hide toggles visibility, Regenerate makes a new one, Copy copies the current one', async () => {
    const api = mockApi(routes());
    renderPage(<Page />, { route: '/users/create', user: SA, api });
    await screen.findByRole('option', { name: 'Operator' });
    await waitFor(() => expect(tempPassword().length).toBe(14));
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
    // regenerating clears the Copied! state
    expect(screen.queryByText('Copied!')).toBeNull();
  });

  it('falls back to execCommand("copy") when the clipboard API is refused; Copied! resets after 2s', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    const api = mockApi(routes());
    renderPage(<Page />, { route: '/users/create', user: SA, api });
    await screen.findByRole('option', { name: 'Operator' });
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
    expect(exec).toHaveBeenCalledWith('copy');
    await waitFor(() => expect(screen.queryByText('Copied!')).toBeNull(), { timeout: 3000 });
  });
});

describe('Create User — accessibility + console', () => {
  it('flags only the known unnamed controls and logs nothing', async () => {
    const api = mockApi(routes());
    renderPage(<Page />, { route: '/users/create', user: SA, api });
    await screen.findByRole('option', { name: 'Operator' });
    const unl = unlabeledControls();
    // Findings: every form label lacks htmlFor, so the inputs are named only by
    // their placeholders (create.tsx:147,:165,:186,:203); the role <Select>
    // (:221) and the read-only temporary-password input (:281) have no name.
    expect(unl.none.filter((d) => !(d.startsWith('select') || d.startsWith('input[type=password]')))).toEqual([]);
    expect(unl.placeholderOnly.filter((d) => !/Enter employee id|Enter full name|user@example\.com|Enter department/.test(d))).toEqual([]);
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
