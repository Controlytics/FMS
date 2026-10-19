/**
 * OQ-07 (operator decision 2026-10-19: ASK FIRST, like the web).
 *
 * On SESSION_CONFLICT the tablet login used to retry with `force: true` on
 * its own ("operators need quick access"), silently ending the same user's
 * session elsewhere. It must now show when the other session signed in and
 * force only after the operator confirms — and the 2026-10-13 rule
 * (TABLET_ACCESS_DENIED is decided at login, before any session is touched)
 * must stay as it was.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const post = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/api-client', () => ({ apiClient: { post } }));
vi.mock('@/hooks/use-branding', () => ({ useBranding: () => ({ branding: {} }) }));
vi.mock('../../../hooks/use-datetime-format', () => ({
  useDatetimeFormat: () => ({ formatDateTime: (d: string) => `AT(${d})` }),
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => ({ ...(await orig() as any), useNavigate: () => navigate }));

import { MobileLoginPage } from '../mobile-login';

function conflictError() {
  const e: any = new Error('An active session already exists for this account.');
  e.status = 409;
  e.code = 'SESSION_CONFLICT';
  e.activeSession = { loginTime: '2026-10-19T08:15:00.000Z', lastActiveAt: '2026-10-19T09:00:00.000Z' };
  return e;
}

function signIn() {
  render(<MemoryRouter><MobileLoginPage /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('User ID'), { target: { value: 'op1' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Secret@123' } });
  fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
}

describe('tablet login — session conflict asks first', () => {
  beforeEach(() => {
    post.mockReset();
    navigate.mockReset();
    sessionStorage.clear();
    // checkTabletAccess + logout use raw fetch.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ configured: true, allowed: ['login'] }) }));
  });

  it('shows the other session and does NOT force on its own', async () => {
    post.mockRejectedValueOnce(conflictError());
    signIn();
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
    expect(screen.getByText(/logged in from another location/i)).toBeInTheDocument();
    expect(screen.getByText('AT(2026-10-19T08:15:00.000Z)')).toBeInTheDocument();
    // Exactly one login call so far, and it was not a forced one.
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).not.toHaveProperty('force');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('forces only after the operator confirms', async () => {
    post.mockRejectedValueOnce(conflictError());
    post.mockResolvedValueOnce({ token: 'tok', user: { forcePasswordChange: false } }); // forced login
    post.mockResolvedValueOnce({ token: 'grant', expiresAt: '2026-10-20T00:00:00Z' });  // offline grant
    signIn();
    fireEvent.click(await screen.findByRole('button', { name: /continue & logout old session/i }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/m', { replace: true }));
    const loginCalls = post.mock.calls.filter((c) => c[0] === '/api/auth/login');
    expect(loginCalls).toHaveLength(2);
    expect(loginCalls[1][1]).toMatchObject({ force: true, client: 'tablet' });
  });

  it('Cancel leaves the other session alone', async () => {
    post.mockRejectedValueOnce(conflictError());
    signIn();
    fireEvent.click(await screen.findByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('a role without tablet access is refused at login, no confirm, no force (2026-10-13 unchanged)', async () => {
    const e: any = new Error('denied'); e.status = 403; e.code = 'TABLET_ACCESS_DENIED';
    post.mockRejectedValueOnce(e);
    signIn();
    await waitFor(() => expect(screen.getByText(/don't have access to log in on the tablet/i)).toBeInTheDocument());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
  });
});
