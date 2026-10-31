import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRequest, type MockRoute } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, reauthActions, commonConfigRoutes, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';
import { brandingRoute, holdRequests, findDialog } from '@/routes/auth/__tests__/support';
import { expectAllControlsNamed } from '@/components/__tests__/support/a11y';
import { ProfilePage } from '../index';

/**
 * My Profile. Real useAuth (/me), useRoleColors (/api/roles/active), useBranding,
 * useReauth (UPDATE_PROFILE) and the raw-fetch photo upload; only fetch is stubbed.
 */

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); vi.unstubAllGlobals(); });

const ME = {
  id: 'u1', username: 'jdoe01', fullName: 'Jane Doe', email: 'jane@example.com', department: 'QA Lab',
  photoUrl: '', role: 'OPERATOR', status: 'ENABLED', permissions: [],
  forcePasswordChange: false, isTemporaryPassword: false,
  lastLogin: '2026-10-20T09:15:00.000Z', createdAt: '2026-01-05T00:00:00.000Z',
};
const ROLES = [{ name: 'OPERATOR', displayName: 'Operator', color: 'bg-emerald-600' }];

/**
 * In the app, AppLayout's /me has already filled `digilog_cached_user` (and the
 * SWR cache) before Profile mounts, so the form is seeded from a known user.
 */
function page(opts: { user?: Record<string, unknown>; reauth?: string[]; routes?: MockRoute[]; cached?: boolean } = {}) {
  const user = { ...ME, ...(opts.user ?? {}) };
  if (opts.cached !== false) localStorage.setItem('digilog_cached_user', JSON.stringify(user));
  const api = mockApi([
    ...(opts.routes ?? []),
    ...commonConfigRoutes(), brandingRoute(), reauthActions(opts.reauth ?? []),
    { path: '/api/roles/active', body: ROLES },
  ]);
  renderPage(<ProfilePage />, { route: '/profile', api, user: user as { role: string } });
  return api;
}

const input = (name: string) => document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
const pick = (file: File) => fireEvent.change(fileInput(), { target: { files: [file] } });
const png = (name = 'me.png', size?: number, type = 'image/png') => {
  const f = new File(['x'], name, { type });
  if (size !== undefined) Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('Profile — display', () => {
  it('shows the user, role display name + colour, account info with formatted dates, and the initials avatar', async () => {
    const api = page();
    expect(await screen.findByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    expect(screen.getByText('@jdoe01')).toBeInTheDocument();
    const badges = await screen.findAllByText('Operator');
    expect(badges.length).toBe(2); // header badge + account info
    await waitFor(() => expect(badges[0].className).toContain('bg-emerald-600'));
    expect(screen.getByText('ENABLED')).toBeInTheDocument();
    expect(screen.getByText('Last Login:').nextElementSibling).toHaveTextContent('20/10/2026 09:15');
    expect(screen.getByText('Member Since:').nextElementSibling).toHaveTextContent('05/01/2026');
    expect(screen.getByText('JD')).toBeInTheDocument();
    // seeded form
    expect(input('fullName')).toHaveValue('Jane Doe');
    expect(input('email')).toHaveValue('jane@example.com');
    expect(input('department')).toHaveValue('QA Lab');
    expect(screen.getByDisplayValue('jdoe01')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Upload Photo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(api.unmatched).toEqual([]);
  });

  it('an unknown role shows its raw code; missing dates read N/A; an absolute photo URL is used as-is', async () => {
    page({ user: { role: 'CUSTOM_ROLE', lastLogin: null, createdAt: undefined, photoUrl: 'https://cdn.example.com/p.png' } });
    expect(await screen.findByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    expect(screen.getAllByText('CUSTOM_ROLE').length).toBe(2);
    expect(screen.getByText('Last Login:').nextElementSibling).toHaveTextContent('N/A');
    expect(screen.getByText('Member Since:').nextElementSibling).toHaveTextContent('N/A');
    expect(screen.getByAltText('Jane Doe')).toHaveAttribute('src', 'https://cdn.example.com/p.png');
    expect(screen.getByRole('button', { name: 'Change Photo' })).toBeInTheDocument();
  });

  it('shows Loading... until the signed-in user is known', async () => {
    page({ cached: false });
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
  });
});

describe('Profile — editing', () => {
  it('strips HTML tags typed into Full Name and Department', async () => {
    page();
    await screen.findByRole('heading', { name: 'Jane Doe' });
    fireEvent.change(input('fullName'), { target: { value: '<b>Jane</b> Q. Doe<script>' } });
    expect(input('fullName')).toHaveValue('Jane Q. Doe');
    fireEvent.change(input('department'), { target: { value: '<i>Micro</i>biology' } });
    expect(input('department')).toHaveValue('Microbiology');
  });

  it('Save PUTs the changed fields, refreshes /me and confirms in a dialog that Close dismisses', async () => {
    const api = page({ routes: [{ method: 'PUT', path: '/api/auth/profile', body: (r: MockRequest) => ({ ...ME, ...r.json }) }] });
    await screen.findByRole('heading', { name: 'Jane Doe' });
    fireEvent.change(input('fullName'), { target: { value: 'Jane Q. Doe' } });
    fireEvent.change(input('email'), { target: { value: 'jq@example.com' } });
    const meBefore = api.calls('GET', '/api/auth/me').length;
    const hold = holdRequests(/\/api\/auth\/profile/);
    save();
    expect(await screen.findByRole('button', { name: 'Saving...' })).toBeDisabled();
    hold.release();

    const dlg = await findDialog('Profile Updated');
    expect(within(dlg).getByText('Your profile has been updated successfully.')).toBeInTheDocument();
    const put = api.calls('PUT', '/api/auth/profile')[0];
    // only what the operator changed (P2): department and photo were not touched
    expect(put.json).toEqual({ fullName: 'Jane Q. Doe', email: 'jq@example.com' });
    expect(put.headers['x-reauth-password']).toBeUndefined();
    expect(api.calls('GET', '/api/auth/me').length).toBeGreaterThan(meBefore);
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();

    fireEvent.click(within(dlg).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText('Profile Updated')).toBeNull());
  });

  it('Cancel goes back in history and saves nothing (P1)', async () => {
    const api = page({ routes: [{ method: 'PUT', path: '/api/auth/profile', body: { ok: true } }] });
    await screen.findByRole('heading', { name: 'Jane Doe' });
    fireEvent.change(input('fullName'), { target: { value: 'Changed Name' } });
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(back).toHaveBeenCalledTimes(1);
    // P1: Cancel used to be a submit button inside the form, so it also saved the edits.
    await new Promise((r) => setTimeout(r, 50));
    expect(api.calls('PUT', '/api/auth/profile')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  });

  it('Escape dismisses the success dialog', async () => {
    page({ routes: [{ method: 'PUT', path: '/api/auth/profile', body: { ok: true } }] });
    await screen.findByRole('heading', { name: 'Jane Doe' });
    save();
    await findDialog('Profile Updated');
    // Dialog attaches its Escape listener in an effect, which on a busy machine can
    // run after the dialog is already on screen; a key pressed in between is lost
    // (full-suite run 2026-10-31). Press until it lands - Escape on a closed dialog does nothing.
    await waitFor(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByText('Profile Updated')).toBeNull();
    });
  });

  it('a server refusal shows its message and re-enables Save', async () => {
    page({ routes: [{ method: 'PUT', path: '/api/auth/profile', status: 409, body: { error: 'EMAIL_TAKEN', message: 'Email already in use' } }] });
    await screen.findByRole('heading', { name: 'Jane Doe' });
    save();
    expect(await screen.findByText('Email already in use')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  });

  it('a refusal with no message falls back to "Failed to update profile"', async () => {
    page({ routes: [{ method: 'PUT', path: '/api/auth/profile', status: 500, body: { error: 'X', message: '' } }] });
    await screen.findByRole('heading', { name: 'Jane Doe' });
    save();
    expect(await screen.findByText('Failed to update profile')).toBeInTheDocument();
  });
});

describe('Profile — the form follows /me until the operator types (P2)', () => {
  // The cached user (digilog_cached_user) can be stale: another session or an
  // admin changed the account since. /me is the truth.
  const STALE = { ...ME, fullName: 'Jane Old', email: 'old@example.com', department: 'Old Dept' };

  function stalePage(opts: { holdMe?: boolean; routes?: MockRoute[] } = {}) {
    localStorage.setItem('digilog_cached_user', JSON.stringify(STALE));
    const api = mockApi([
      ...(opts.routes ?? []),
      ...commonConfigRoutes(), brandingRoute(), reauthActions(),
      { path: '/api/roles/active', body: ROLES },
    ]);
    const hold = opts.holdMe ? holdRequests(/\/api\/auth\/me/) : undefined;
    renderPage(<ProfilePage />, { route: '/profile', api, user: ME as { role: string } });
    return { api, hold };
  }

  it('with no cached user, the fields fill in when /me arrives', async () => {
    page({ cached: false });
    await waitFor(() => expect(input('fullName')).toHaveValue('Jane Doe'));
    expect(input('email')).toHaveValue('jane@example.com');
    expect(input('department')).toHaveValue('QA Lab');
  });

  it('a stale cached user is replaced by /me before the operator types', async () => {
    stalePage();
    await waitFor(() => expect(input('email')).toHaveValue('jane@example.com'));
    expect(input('fullName')).toHaveValue('Jane Doe');
    expect(input('department')).toHaveValue('QA Lab');
  });

  it('a field typed before /me arrives is kept, the others follow /me, and Save sends only the typed field', async () => {
    const { api, hold } = stalePage({ holdMe: true, routes: [{ method: 'PUT', path: '/api/auth/profile', body: { ok: true } }] });
    // still the cached (stale) values
    await waitFor(() => expect(input('email')).toHaveValue('old@example.com'));
    fireEvent.change(input('fullName'), { target: { value: 'Jane Typed' } });
    hold!.release();
    await waitFor(() => expect(input('email')).toHaveValue('jane@example.com'));
    expect(input('department')).toHaveValue('QA Lab');
    expect(input('fullName')).toHaveValue('Jane Typed');

    save();
    await findDialog('Profile Updated');
    // never the stale cached email: untouched fields are not sent at all
    expect(api.calls('PUT', '/api/auth/profile')[0].json).toEqual({ fullName: 'Jane Typed' });
  });
});

describe('Profile — re-authentication (UPDATE_PROFILE)', () => {
  it('when the role must sign: prompts, then sends the password in header + body', async () => {
    const api = page({ reauth: ['UPDATE_PROFILE'], routes: [{ method: 'PUT', path: '/api/auth/profile', body: { ok: true } }] });
    await screen.findByRole('heading', { name: 'Jane Doe' });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(input('fullName'), { target: { value: 'Jane R. Doe' } });
    save();
    const dlg = await findDialog('Confirm Your Identity');
    expect(within(dlg).getByText(/Performing "Update Own Profile" requires identity verification/)).toBeInTheDocument();
    expect(api.calls('PUT', '/api/auth/profile')).toHaveLength(0);
    fireEvent.change(within(dlg).getByPlaceholderText('Enter your password'), { target: { value: 'Secret@1' } });
    fireEvent.click(within(dlg).getByRole('button', { name: /Confirm|Verify/ }));

    await findDialog('Profile Updated');
    const put = api.calls('PUT', '/api/auth/profile')[0];
    expect(put.headers['x-reauth-password']).toBe('Secret@1');
    expect(put.json).toEqual({ fullName: 'Jane R. Doe', _currentPassword: 'Secret@1' });
  });

  it('cancelling the prompt sends nothing and re-enables Save', async () => {
    const api = page({ reauth: ['UPDATE_PROFILE'] });
    await screen.findByRole('heading', { name: 'Jane Doe' });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    save();
    const dlg = await findDialog('Confirm Your Identity');
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
    expect(api.calls('PUT', '/api/auth/profile')).toHaveLength(0);
    // A dismissed prompt is not an error: no message at all (D-OPS-8 pattern).
    expect(screen.queryByText(/Cancelled|Failed to update profile/)).toBeNull();
  });

  it('a REAUTH_REQUIRED from the server opens the prompt retroactively; a wrong password is reported in the dialog', async () => {
    const api = page({
      routes: [
        { method: 'PUT', path: '/api/auth/profile', times: 1, status: 403, body: { error: 'REAUTH_REQUIRED', message: 'Password required' } },
        { method: 'PUT', path: '/api/auth/profile', times: 1, status: 403, body: { error: 'REAUTH_FAILED', message: 'Bad password' } },
        { method: 'PUT', path: '/api/auth/profile', body: { ok: true } },
      ],
    });
    await screen.findByRole('heading', { name: 'Jane Doe' });
    save();
    const dlg = await findDialog('Confirm Your Identity');
    fireEvent.change(within(dlg).getByPlaceholderText('Enter your password'), { target: { value: 'wrong' } });
    fireEvent.click(within(dlg).getByRole('button', { name: /Confirm|Verify/ }));
    expect(await within(dlg).findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    fireEvent.change(within(dlg).getByPlaceholderText('Enter your password'), { target: { value: 'right' } });
    fireEvent.click(within(dlg).getByRole('button', { name: /Confirm|Verify/ }));
    await findDialog('Profile Updated');
    const puts = api.calls('PUT', '/api/auth/profile');
    expect(puts).toHaveLength(3);
    expect(puts[0].headers['x-reauth-password']).toBeUndefined();
    expect(puts[2].headers['x-reauth-password']).toBe('right');
  });
});

describe('Profile — photo', () => {
  it('rejects a non-image and an oversized file without uploading', async () => {
    const api = page();
    await screen.findByRole('heading', { name: 'Jane Doe' });
    pick(png('doc.pdf', undefined, 'application/pdf'));
    expect(await screen.findByText('Only JPEG, PNG, GIF, and WebP images are allowed')).toBeInTheDocument();
    pick(png('big.png', 5 * 1024 * 1024 + 1));
    expect(await screen.findByText('File size must be less than 5MB')).toBeInTheDocument();
    expect(api.calls('POST', '/api/uploads/photo')).toHaveLength(0);
  });

  it('a change event with no file does nothing', async () => {
    const api = page();
    await screen.findByRole('heading', { name: 'Jane Doe' });
    fireEvent.change(fileInput(), { target: { files: [] } });
    expect(api.calls('POST', '/api/uploads/photo')).toHaveLength(0);
  });

  it('both photo buttons open the file picker', async () => {
    page();
    await screen.findByRole('heading', { name: 'Jane Doe' });
    const click = vi.spyOn(fileInput(), 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Change profile photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Upload Photo' }));
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('uploads with the bearer token, shows the new photo, saves its URL; Remove clears it', async () => {
    // a server whose /me reflects what was saved (the form follows /me after a save)
    let server: Record<string, unknown> = { ...ME };
    const api = page({
      routes: [
        { method: 'POST', path: '/api/uploads/photo', body: { photoUrl: '/uploads/photos/p1.png' } },
        { method: 'PUT', path: '/api/auth/profile', body: (r: MockRequest) => { server = { ...server, ...r.json }; return server; } },
        { path: '/api/auth/me', body: () => server },
      ],
    });
    await screen.findByRole('heading', { name: 'Jane Doe' });
    const hold = holdRequests(/\/api\/uploads\/photo/);
    pick(png());
    expect(await screen.findByText('Uploading...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change profile photo' })).toBeDisabled();
    hold.release();

    expect(await screen.findByAltText('Profile')).toHaveAttribute('src', '/uploads/photos/p1.png');
    expect(screen.getByAltText('Jane Doe')).toHaveAttribute('src', '/uploads/photos/p1.png');
    expect(api.calls('POST', '/api/uploads/photo')[0].headers.authorization).toBe('Bearer test-token');
    expect(fileInput().value).toBe('');

    save();
    await findDialog('Profile Updated');
    expect(api.calls('PUT', '/api/auth/profile')[0].json.photoUrl).toBe('/uploads/photos/p1.png');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByAltText('Profile')).toBeNull();
    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  it('an upload refusal shows the server message; without one, "Upload failed"', async () => {
    page({
      routes: [
        { method: 'POST', path: '/api/uploads/photo', times: 1, status: 413, body: { message: 'Image too large for server' } },
        { method: 'POST', path: '/api/uploads/photo', status: 500, body: {} },
      ],
    });
    await screen.findByRole('heading', { name: 'Jane Doe' });
    pick(png());
    expect(await screen.findByText('Image too large for server')).toBeInTheDocument();
    pick(png());
    expect(await screen.findByText('Upload failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload Photo' })).toBeEnabled();
  });

  it('a network error with no message falls back to "Failed to upload photo"', async () => {
    page();
    await screen.findByRole('heading', { name: 'Jane Doe' });
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => (String(input).includes('/api/uploads/photo') ? Promise.reject({}) : inner(input, init)));
    pick(png());
    expect(await screen.findByText('Failed to upload photo')).toBeInTheDocument();
  });
});

describe('Profile — accessibility + console', () => {
  it('every control is named — each field by its label — and a normal save logs nothing', async () => {
    const api = page({ routes: [{ method: 'PUT', path: '/api/auth/profile', body: { ok: true } }] });
    await screen.findByRole('heading', { name: 'Jane Doe' });
    expect(screen.getByLabelText('User ID')).toHaveValue('jdoe01');
    expect(screen.getByLabelText('Full Name *')).toBe(input('fullName'));
    expect(screen.getByLabelText('Email *')).toBe(input('email'));
    expect(screen.getByLabelText('Department')).toBe(input('department'));
    expectAllControlsNamed();
    expect(unlabeledControls()).toEqual({ none: [], placeholderOnly: [] });
    save();
    await findDialog('Profile Updated');
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
