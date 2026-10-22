import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { mockApi, renderPage, type MockRequest, type MockRoute } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, commonConfigRoutes, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';
import { brandingRoute, holdRequests, LocationProbe } from './support';
import { ChangePasswordPage } from '../change-password';

/**
 * Change password (forced / temporary-password flow). Real useAuth (via /me),
 * real react-hook-form + zod passwordChangeSchema, real policy feed.
 */

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => {
  cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); vi.unstubAllGlobals();
  delete (window as any).Capacitor;
});

const USER = { id: 'u1', username: 'jdoe01', fullName: 'Jane Doe', role: 'OPERATOR', status: 'ENABLED', forcePasswordChange: true, isTemporaryPassword: false };

function page(opts: { user?: Record<string, unknown>; policy?: Record<string, unknown>; routes?: MockRoute[] } = {}) {
  const api = mockApi([
    ...commonConfigRoutes(), brandingRoute(),
    { path: '/api/config/password-policy/current', body: opts.policy ?? {} },
    ...(opts.routes ?? []),
  ]);
  const view = renderPage(
    <><Routes><Route path="/change-password" element={<ChangePasswordPage />} /><Route path="*" element={null} /></Routes><LocationProbe /></>,
    { route: '/change-password', api, user: { ...USER, ...(opts.user ?? {}) } as { role: string } },
  );
  return { api, view };
}

const field = (name: string) => document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
const type = (name: string, value: string) => fireEvent.change(field(name), { target: { value } });
const submitBtn = () => screen.getByRole('button', { name: /Change password|Changing/ });
const rule = (text: RegExp) => screen.getByText(text);

describe('Change password — layout by account state', () => {
  it('a temporary-password user sees the temporary notice, their User ID, and no Current Password field', async () => {
    page({ user: { isTemporaryPassword: true } });
    expect(await screen.findByText('You are using a temporary password. Set a new one to continue.')).toBeInTheDocument();
    expect(screen.getByText('jdoe01')).toBeInTheDocument();
    expect(field('currentPassword')).toBeNull();
    expect(field('newPassword')).toBeInTheDocument();
  });

  it('a regular forced change asks for the current password too', async () => {
    page();
    expect(await screen.findByText('Set a new password to continue.')).toBeInTheDocument();
    await waitFor(() => expect(field('currentPassword')).toBeInTheDocument());
    expect(screen.getByText('Current Password')).toBeInTheDocument();
  });
});

describe('Change password — policy checklist', () => {
  it('with the default policy each rule turns green as the new password satisfies it, and Submit unlocks only when all hold', async () => {
    page();
    await screen.findByText('jdoe01');
    expect(submitBtn()).toBeDisabled();
    expect(rule(/At least 8 characters/)).toHaveTextContent('○');
    expect(screen.getByText('Note: Password cannot match any of your last 12 passwords.')).toBeInTheDocument();

    type('newPassword', 'abcdefgh');
    await waitFor(() => expect(rule(/At least 8 characters/)).toHaveTextContent('✓'));
    expect(rule(/At least 1 lowercase letter$/)).toHaveTextContent('✓');
    expect(rule(/At least 1 uppercase letter$/)).toHaveTextContent('○');
    expect(submitBtn()).toBeDisabled();

    type('newPassword', 'Abcdefg1!');
    await waitFor(() => expect(rule(/At least 1 special character$/)).toHaveTextContent('✓'));
    expect(rule(/At least 1 uppercase letter$/)).toHaveTextContent('✓');
    expect(rule(/At least 1 number$/)).toHaveTextContent('✓');
    expect(rule(/Cannot contain your User ID/)).toHaveTextContent('✓');
    expect(submitBtn()).toBeEnabled();
  });

  it('a password containing the User ID (any case) is flagged and keeps Submit disabled', async () => {
    page();
    await screen.findByText('jdoe01');
    type('newPassword', 'xJDOE01x!A');
    await waitFor(() => expect(rule(/Cannot contain your User ID/)).toHaveTextContent('✗'));
    expect(submitBtn()).toBeDisabled();
  });

  it('follows the SERVER policy: plural counts, longer minimum, rules switched off are not listed, no reuse note at 0', async () => {
    page({ policy: { minLength: 12, minUppercase: 2, minNumbers: 3, requireLowercase: false, requireSpecialChars: false, preventReuseCount: 0, cannotContainUserId: false } });
    expect(await screen.findByText(/At least 12 characters/)).toBeInTheDocument();
    expect(screen.getByText(/At least 2 uppercase letters/)).toBeInTheDocument();
    expect(screen.getByText(/At least 3 numbers/)).toBeInTheDocument();
    expect(screen.queryByText(/lowercase letter/)).toBeNull();
    expect(screen.queryByText(/special character/)).toBeNull();
    expect(screen.queryByText(/Cannot contain your User ID/)).toBeNull();
    expect(screen.queryByText(/Password cannot match any of your last/)).toBeNull();

    // satisfies this policy with no lowercase/special at all, even containing the user id
    type('newPassword', 'AB123JDOE01X');
    await waitFor(() => expect(submitBtn()).toBeEnabled());
  });

  it('plural lowercase / special-character wording', async () => {
    page({ policy: { minLowercase: 2, minSpecialChars: 2 } });
    expect(await screen.findByText(/At least 2 lowercase letters/)).toBeInTheDocument();
    expect(screen.getByText(/At least 2 special characters/)).toBeInTheDocument();
  });
});

describe('Change password — submit', () => {
  const GOOD = 'Newpass#2026';

  it('posts current/new/confirm, refreshes the session user, toasts, and returns to the dashboard', async () => {
    const { api } = page({ routes: [{ method: 'POST', path: '/api/auth/change-password', body: { success: true } }] });
    await waitFor(() => expect(field('currentPassword')).toBeInTheDocument());
    type('currentPassword', 'Old#pass1');
    type('newPassword', GOOD);
    type('confirmPassword', GOOD);
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    const meBefore = api.calls('GET', '/api/auth/me').length;
    fireEvent.click(submitBtn());

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
    expect(api.calls('POST', '/api/auth/change-password')[0].json).toEqual({ currentPassword: 'Old#pass1', newPassword: GOOD, confirmPassword: GOOD });
    expect(api.calls('GET', '/api/auth/me').length).toBeGreaterThan(meBefore);
    expect(await screen.findByText('Password changed successfully')).toBeInTheDocument();
    expect(api.unmatched).toEqual([]);
  });

  it('honours the tablet hint left by mobile-login and consumes it', async () => {
    sessionStorage.setItem('post_change_password_redirect', '/m');
    page({ user: { isTemporaryPassword: true }, routes: [{ method: 'POST', path: '/api/auth/change-password', body: { success: true } }] });
    await screen.findByText('jdoe01');
    type('newPassword', GOOD);
    type('confirmPassword', GOOD);
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    fireEvent.click(submitBtn());
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/m'));
    expect(sessionStorage.getItem('post_change_password_redirect')).toBeNull();
  });

  it('on the Capacitor app with no hint it defaults to /m, not the desktop dashboard', async () => {
    (window as any).Capacitor = { isNativePlatform: () => true };
    page({ user: { isTemporaryPassword: true }, routes: [{ method: 'POST', path: '/api/auth/change-password', body: { success: true } }] });
    await screen.findByText('jdoe01');
    type('newPassword', GOOD);
    type('confirmPassword', GOOD);
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    fireEvent.click(submitBtn());
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/m'));
  });

  it('a mismatched confirmation is refused client-side with the schema message', async () => {
    const { api } = page({ user: { isTemporaryPassword: true } });
    await screen.findByText('jdoe01');
    type('newPassword', GOOD);
    type('confirmPassword', GOOD + 'x');
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    fireEvent.click(submitBtn());
    expect(await screen.findByText('Passwords must match')).toBeInTheDocument();
    expect(api.calls('POST', '/api/auth/change-password')).toHaveLength(0);
  });

  it('an empty confirmation shows "Please confirm your password"', async () => {
    page({ user: { isTemporaryPassword: true } });
    await screen.findByText('jdoe01');
    type('newPassword', GOOD);
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    fireEvent.click(submitBtn());
    expect(await screen.findByText('Please confirm your password')).toBeInTheDocument();
  });

  it('a server refusal (password reuse) is shown inline and as an error toast; the page stays put', async () => {
    const { api } = page({ routes: [{ method: 'POST', path: '/api/auth/change-password', status: 400, body: { error: 'PASSWORD_REUSED', message: 'Password was used recently' } }] });
    await waitFor(() => expect(field('currentPassword')).toBeInTheDocument());
    type('currentPassword', 'Old#pass1');
    type('newPassword', GOOD);
    type('confirmPassword', GOOD);
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    fireEvent.click(submitBtn());
    expect(await screen.findByText('Password change failed')).toBeInTheDocument();
    expect(screen.getAllByText('Password was used recently').length).toBe(2); // inline + toast
    expect(screen.getByTestId('location')).toHaveTextContent('/change-password');
    expect(api.calls('POST', '/api/auth/change-password')).toHaveLength(1);
  });

  it('a refusal with no message falls back to "Failed to change password"', async () => {
    page({ user: { isTemporaryPassword: true }, routes: [{ method: 'POST', path: '/api/auth/change-password', status: 500, body: { error: 'X', message: '' } }] });
    await screen.findByText('jdoe01');
    type('newPassword', GOOD);
    type('confirmPassword', GOOD);
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    fireEvent.click(submitBtn());
    expect((await screen.findAllByText('Failed to change password')).length).toBeGreaterThan(0);
  });

  it('shows "Changing…" and stays disabled while the request is in flight', async () => {
    const { api } = page({ user: { isTemporaryPassword: true }, routes: [{ method: 'POST', path: '/api/auth/change-password', body: (_r: MockRequest) => ({ success: true }) }] });
    await screen.findByText('jdoe01');
    type('newPassword', GOOD);
    type('confirmPassword', GOOD);
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    const hold = holdRequests(/\/api\/auth\/change-password/);
    fireEvent.click(submitBtn());
    expect(await screen.findByRole('button', { name: 'Changing…' })).toBeDisabled();
    hold.release();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
    expect(api.calls('POST', '/api/auth/change-password')).toHaveLength(1);
  });
});

describe('Change password — show/hide', () => {
  it('each of the three Show buttons reveals only its own field', async () => {
    page();
    await waitFor(() => expect(field('currentPassword')).toBeInTheDocument());
    const shows = screen.getAllByRole('button', { name: 'Show' });
    expect(shows).toHaveLength(3);
    fireEvent.click(shows[0]);
    expect(field('currentPassword')).toHaveAttribute('type', 'text');
    expect(field('newPassword')).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getAllByRole('button', { name: 'Show' })[0]);
    expect(field('newPassword')).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getAllByRole('button', { name: 'Show' })[0]);
    expect(field('confirmPassword')).toHaveAttribute('type', 'text');
    const hides = screen.getAllByRole('button', { name: 'Hide' });
    expect(hides).toHaveLength(3);
    hides.forEach((b) => fireEvent.click(b));
    expect(field('currentPassword')).toHaveAttribute('type', 'password');
    expect(field('newPassword')).toHaveAttribute('type', 'password');
    expect(field('confirmPassword')).toHaveAttribute('type', 'password');
  });
});

describe('Change password — accessibility + console', () => {
  it('apart from the three password inputs (finding: label not associated), every control is named; logs nothing', async () => {
    const { api } = page();
    await waitFor(() => expect(field('currentPassword')).toBeInTheDocument());
    const unl = unlabeledControls();
    // Finding: change-password.tsx:122/139/190 render <label> with no htmlFor and the
    // <Input> is not nested in it, so all three password inputs have no accessible name.
    // Reported, not asserted as correct: every OTHER control must be named.
    expect(unl.none.filter((d) => !/name=(currentPassword|newPassword|confirmPassword)/.test(d))).toEqual([]);
    expect(unl.placeholderOnly).toEqual([]);
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
