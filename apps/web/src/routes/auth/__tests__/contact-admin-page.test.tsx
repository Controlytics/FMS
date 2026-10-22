import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRequest, type MockRoute } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';
import { brandingRoute, holdRequests } from './support';
import { ContactAdminPage } from '../contact-admin';

/**
 * Contact admin (public). Raw fetch() for /api/roles/active, the user lookup and
 * the request POST — all through the harness's stubbed fetch.
 */

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); vi.unstubAllGlobals(); });

const ROLES = [
  { name: 'SUPER_ADMIN', displayName: 'Super Admin' },
  { name: 'OPERATOR', displayName: 'Operator' },
  { name: 'QA', displayName: 'Quality Assurance' },
  { name: 'MANAGER', displayName: 'Manager' },
];

function page(routes: MockRoute[] = [], roles: unknown = ROLES) {
  const api = mockApi([
    ...routes, // first, so a test's route wins over the defaults below
    brandingRoute(),
    { path: '/api/roles/active', body: roles },
    { method: 'POST', path: '/api/admin-requests', status: 201, body: (r: MockRequest) => ({ id: 'ar-1', ...r.json }) },
  ]);
  renderPage(<ContactAdminPage />, { route: '/contact-admin', api });
  return api;
}

const lookup = (body: unknown, status = 200): MockRoute => ({ path: '/api/admin-requests/user-lookup', status, body });
const send = () => fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
const setType = (v: string) => fireEvent.change(screen.getByLabelText(/What do you need/), { target: { value: v } });
const setRequester = (v: string) => fireEvent.change(screen.getByLabelText(/Your employee ID/), { target: { value: v } });
const setReason = (v: string) => fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: v } });
const target = () => screen.getByLabelText(/^Employee ID/);
const find = () => fireEvent.click(screen.getByRole('button', { name: 'Find' }));

describe('Contact admin — validation', () => {
  it('Send with nothing filled names what is missing and posts nothing', async () => {
    const api = page();
    send();
    expect(await screen.findByText('Still needed: Your employee ID, What you need.')).toBeInTheDocument();
    expect(api.calls('POST', '/api/admin-requests')).toHaveLength(0);
    // no reason box until a type is chosen
    expect(screen.queryByLabelText(/Reason/)).toBeNull();
  });

  it('CREATE_USER lists each missing field, including the 6-character User ID minimum', async () => {
    page();
    setRequester('EMP-1');
    setType('CREATE_USER');
    send();
    expect(await screen.findByText('Still needed: User ID, Full name, Role, Reason.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^User ID/), { target: { value: 'abc' } });
    send();
    expect(await screen.findByText('Still needed: User ID (min 6 characters), Full name, Role, Reason.')).toBeInTheDocument();
  });
});

describe('Contact admin — CREATE_USER', () => {
  it('offers every active role except SUPER_ADMIN and posts the new-account request', async () => {
    const api = page();
    setRequester('  EMP-1 ');
    setType('CREATE_USER');
    expect(screen.getByText('New account')).toBeInTheDocument();
    const role = screen.getByLabelText(/^Role/) as HTMLSelectElement;
    await waitFor(() => expect(within(role).getByRole('option', { name: 'Operator' })).toBeInTheDocument());
    expect(within(role).queryByRole('option', { name: 'Super Admin' })).toBeNull();

    fireEvent.change(screen.getByLabelText(/^User ID/), { target: { value: ' jdoe01 ' } });
    fireEvent.change(screen.getByLabelText(/^Full name/), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/^Department/), { target: { value: 'QA' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'jane@x.com' } });
    fireEvent.change(role, { target: { value: 'QA' } });
    setReason('  New joiner  ');

    const hold = holdRequests(/\/api\/admin-requests$/);
    send();
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled();
    hold.release();
    expect(await screen.findByText('Request sent')).toBeInTheDocument();
    // the shell's link above the heading and the button-styled link below both go to /login
    const backLinks = screen.getAllByRole('link', { name: 'Back to sign in' });
    expect(backLinks.length).toBe(2);
    backLinks.forEach((a) => expect(a).toHaveAttribute('href', '/login'));

    expect(api.calls('POST', '/api/admin-requests')[0].json).toEqual({
      requestType: 'CREATE_USER',
      requesterName: 'EMP-1', requesterEmployeeId: 'EMP-1',
      requestData: { username: 'jdoe01', fullName: 'Jane Doe', department: 'QA', email: 'jane@x.com', requestedRole: 'QA' },
      remarks: 'New joiner',
    });
    expect(api.unmatched).toEqual([]);
  });

  it('accepts the {data: [...]} roles shape too', async () => {
    page([], { data: [{ name: 'OPERATOR', displayName: 'Operator' }] });
    setType('CREATE_USER');
    const role = screen.getByLabelText(/^Role/);
    expect(await within(role).findByRole('option', { name: 'Operator' })).toBeInTheDocument();
  });

  it('an unexpected roles payload yields no roles', async () => {
    page([], 'not-an-array');
    setType('CREATE_USER');
    const role = screen.getByLabelText(/^Role/);
    await waitFor(() => expect(within(role).getAllByRole('option')).toHaveLength(1));
  });

  it('a roles feed that is not JSON leaves the role list empty without breaking the page', async () => {
    const api = mockApi([brandingRoute()]);
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => (String(input).includes('/api/roles/active')
      ? Promise.resolve(new Response('<!doctype html>', { status: 200 }))
      : inner(input, init)));
    renderPage(<ContactAdminPage />, { route: '/contact-admin', api });
    setType('CREATE_USER');
    const role = screen.getByLabelText(/^Role/);
    // only the placeholder option
    await waitFor(() => expect(within(role).getAllByRole('option')).toHaveLength(1));
  });
});

describe('Contact admin — MODIFY_USER (role change only)', () => {
  it('Find looks the account up; the role picker excludes the current role; the request carries modifyField=role', async () => {
    const api = page([lookup({ exists: true, username: 'asha01', fullName: 'Asha Rao', role: 'OPERATOR', roleDisplayName: 'Operator' })]);
    setRequester('EMP-1');
    setType('MODIFY_USER');
    expect(screen.getByText('Account to change')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find' })).toBeDisabled();

    send();
    expect(await screen.findByText('Still needed: Employee ID of the account (use Find), Reason.')).toBeInTheDocument();

    fireEvent.change(target(), { target: { value: ' asha01 ' } });
    const hold = holdRequests(/user-lookup/);
    find();
    expect(await screen.findByRole('button', { name: 'Finding…' })).toBeDisabled();
    hold.release();
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(api.calls('GET', '/api/admin-requests/user-lookup')[0].query.get('username')).toBe('asha01');
    expect(screen.getByTitle('Current role')).toHaveTextContent('Operator');

    const newRole = screen.getByRole('combobox', { name: 'New role' });
    await waitFor(() => expect(within(newRole).getByRole('option', { name: 'Manager' })).toBeInTheDocument());
    expect(within(newRole).queryByRole('option', { name: 'Operator' })).toBeNull();

    setReason('Promoted');
    send();
    expect(await screen.findByText('Still needed: New role.')).toBeInTheDocument();
    fireEvent.change(newRole, { target: { value: 'MANAGER' } });
    send();
    expect(await screen.findByText('Request sent')).toBeInTheDocument();
    expect(api.calls('POST', '/api/admin-requests')[0].json.requestData).toEqual({ username: 'asha01', modifyField: 'role', newValue: 'MANAGER' });
  });

  it('an account whose role is undisclosed (SUPER_ADMIN) cannot be changed here', async () => {
    page([lookup({ exists: true, username: 'root01', fullName: null, role: null, roleDisplayName: null })]);
    setRequester('EMP-1');
    setType('MODIFY_USER');
    fireEvent.change(target(), { target: { value: 'root01' } });
    find();
    expect(await screen.findByText("This account's role cannot be changed through a request. Contact the administrator directly.")).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'New role' })).toBeNull();
    setReason('Please');
    send();
    expect(await screen.findByText("Still needed: a modifiable account (this account's role cannot be changed here).")).toBeInTheDocument();
  });

  it('the current role falls back to its code when no display name is given; Enter in the box runs the lookup', async () => {
    const api = page([lookup({ exists: true, username: 'asha01', fullName: 'Asha Rao', role: 'QA' })]);
    setType('MODIFY_USER');
    fireEvent.change(target(), { target: { value: 'asha01' } });
    fireEvent.keyDown(target(), { key: 'Enter' });
    expect(await screen.findByTitle('Current role')).toHaveTextContent('QA');
    expect(api.calls('GET', '/api/admin-requests/user-lookup')).toHaveLength(1);
    // another key does nothing
    fireEvent.keyDown(target(), { key: 'a' });
    expect(api.calls('GET', '/api/admin-requests/user-lookup')).toHaveLength(1);
    // editing the id discards the previous result
    fireEvent.change(target(), { target: { value: 'asha02' } });
    expect(screen.queryByText('Asha Rao')).toBeNull();
  });
});

describe('Contact admin — lookup failures', () => {
  it('an unknown Employee ID says so', async () => {
    page([lookup({ exists: false, username: 'nobody', fullName: null })]);
    setType('UNLOCK');
    fireEvent.change(target(), { target: { value: 'nobody' } });
    find();
    expect(await screen.findByText('Employee ID does not exist in the application')).toBeInTheDocument();
  });

  it('a refused lookup shows the server message, or the status when there is none', async () => {
    page([
      { path: '/api/admin-requests/user-lookup', times: 1, status: 429, body: { message: 'Too many lookups' } },
      { path: '/api/admin-requests/user-lookup', status: 500, body: {} },
    ]);
    setType('UNLOCK');
    fireEvent.change(target(), { target: { value: 'x1' } });
    find();
    expect(await screen.findByText('Too many lookups')).toBeInTheDocument();
    find();
    expect(await screen.findByText('Lookup failed (500)')).toBeInTheDocument();
  });

  it('a lookup whose error body is not JSON still names the status', async () => {
    page();
    setType('UNLOCK');
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => (String(input).includes('user-lookup')
      ? Promise.resolve(new Response('<html/>', { status: 502 }))
      : inner(input, init)));
    fireEvent.change(target(), { target: { value: 'x1' } });
    find();
    expect(await screen.findByText('Lookup failed (502)')).toBeInTheDocument();
  });

  it('a network failure shows its message; one with no message falls back to "Lookup failed"', async () => {
    page();
    setType('UNLOCK');
    const inner = globalThis.fetch;
    let n = 0;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes('user-lookup')) return inner(input, init);
      n += 1;
      return Promise.reject(n === 1 ? new TypeError('Failed to fetch') : {});
    });
    fireEvent.change(target(), { target: { value: 'x1' } });
    find();
    expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
    find();
    expect(await screen.findByText('Lookup failed')).toBeInTheDocument();
  });

  it('Enter on a blank id does not call the server', async () => {
    const api = page();
    setType('UNLOCK');
    fireEvent.change(target(), { target: { value: '   ' } });
    fireEvent.keyDown(target(), { key: 'Enter' });
    expect(api.calls('GET', '/api/admin-requests/user-lookup')).toHaveLength(0);
  });
});

describe('Contact admin — account-state and password requests', () => {
  it.each([
    ['UNLOCK', 'Account to unlock'],
    ['ENABLE_ACCOUNT', 'Account to enable'],
    ['DISABLE_ACCOUNT', 'Account to disable'],
    ['FORGOT_PASSWORD', 'Account to reset'],
  ])('%s: needs a found account, then sends just its username', async (type, legend) => {
    const api = page([lookup({ exists: true, username: 'asha01', fullName: 'Asha Rao', role: 'OPERATOR' })]);
    setRequester('EMP-1');
    setType(type);
    expect(screen.getByText(legend)).toBeInTheDocument();
    setReason('Locked out');
    send();
    expect(await screen.findByText('Still needed: Employee ID of the account (use Find).')).toBeInTheDocument();
    fireEvent.change(target(), { target: { value: 'asha01' } });
    find();
    await screen.findByText('Asha Rao');
    // the role picker is MODIFY_USER only
    expect(screen.queryByRole('combobox', { name: 'New role' })).toBeNull();
    send();
    expect(await screen.findByText('Request sent')).toBeInTheDocument();
    expect(api.calls('POST', '/api/admin-requests')[0].json).toMatchObject({ requestType: type, requestData: { username: 'asha01' }, remarks: 'Locked out' });
  });

  it('switching the request type clears the looked-up account', async () => {
    page([lookup({ exists: true, username: 'asha01', fullName: 'Asha Rao', role: 'OPERATOR' })]);
    setType('UNLOCK');
    fireEvent.change(target(), { target: { value: 'asha01' } });
    find();
    await screen.findByText('Asha Rao');
    setType('ENABLE_ACCOUNT');
    await waitFor(() => expect(screen.queryByText('Asha Rao')).toBeNull());
    expect(target()).toHaveValue('');
  });
});

describe('Contact admin — submit failures', () => {
  async function ready() {
    setRequester('EMP-1');
    setType('CREATE_USER');
    const role = screen.getByLabelText(/^Role/);
    await within(role).findByRole('option', { name: 'Operator' });
    fireEvent.change(screen.getByLabelText(/^User ID/), { target: { value: 'jdoe01' } });
    fireEvent.change(screen.getByLabelText(/^Full name/), { target: { value: 'Jane' } });
    fireEvent.change(role, { target: { value: 'OPERATOR' } });
    setReason('Need access');
  }

  it('a server refusal is shown; without a message the status is named', async () => {
    page([
      { method: 'POST', path: '/api/admin-requests', times: 1, status: 409, body: { message: 'A pending request already exists' } },
      { method: 'POST', path: '/api/admin-requests', status: 500, body: {} },
    ]);
    await ready();
    send();
    expect(await screen.findByText('A pending request already exists')).toBeInTheDocument();
    send();
    expect(await screen.findByText('Server error (500)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeEnabled();
  });

  it('a non-JSON refusal names the status; a message-less network error gets the generic text', async () => {
    page();
    await ready();
    const inner = globalThis.fetch;
    let n = 0;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (!(String(input).endsWith('/api/admin-requests') && init?.method === 'POST')) return inner(input, init);
      n += 1;
      return n === 1 ? Promise.resolve(new Response('oops', { status: 502 })) : Promise.reject({});
    });
    send();
    expect(await screen.findByText('Server error (502)')).toBeInTheDocument();
    send();
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });
});

describe('Contact admin — accessibility + console', () => {
  it('every control in each request form is named; nothing logged', async () => {
    const api = page([lookup({ exists: true, username: 'asha01', fullName: 'Asha Rao', role: 'OPERATOR' })]);
    expect(unlabeledControls()).toEqual({ none: [], placeholderOnly: [] });
    setType('CREATE_USER');
    await within(screen.getByLabelText(/^Role/)).findByRole('option', { name: 'Operator' });
    expect(unlabeledControls()).toEqual({ none: [], placeholderOnly: [] });
    setType('MODIFY_USER');
    fireEvent.change(target(), { target: { value: 'asha01' } });
    find();
    await screen.findByRole('combobox', { name: 'New role' });
    expect(unlabeledControls()).toEqual({ none: [], placeholderOnly: [] });
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
