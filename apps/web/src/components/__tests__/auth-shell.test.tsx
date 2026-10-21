import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderPage, mockApi, type MockApi } from '@/test-utils/page-harness';
import { AuthShell, AuthError, AuthSuccess } from '../auth-shell';

/**
 * The frame every signed-out screen renders in. Identity comes from the REAL
 * public `/api/config/branding` request (useBranding); only fetch is stubbed.
 */

let api: MockApi;
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  cleanup();
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  api.restore();
  vi.restoreAllMocks();
});

const BRAND = { companyName: 'Acme Pharma', appName: 'FilterOps', appTagline: 'Clean rooms, clean records', logoUrl: '/uploads/acme.png', version: '9.9.9' };

describe('AuthShell', () => {
  it('shows branding (logo with company alt text, app name, tagline, version) and the form heading', async () => {
    api = mockApi([{ path: '/api/config/branding', body: BRAND }]);
    renderPage(<AuthShell title="Sign in" description="Use your User ID"><form aria-label="login" /></AuthShell>, { api });
    await waitFor(() => expect(screen.getByRole('img', { name: 'Acme Pharma' })).toHaveAttribute('src', '/uploads/acme.png'));
    expect(screen.getByText('FilterOps')).toBeInTheDocument();
    expect(screen.getByText('Clean rooms, clean records')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('Use your User ID')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'login' })).toBeInTheDocument();
    // Company + version appear in the side panel and again under the form (small screens).
    expect(screen.getAllByText('Acme Pharma')).toHaveLength(2);
    expect(screen.getAllByText('Version 9.9.9')).toHaveLength(2);
    expect(screen.getByText('21 CFR Part 11 compliant electronic records')).toBeInTheDocument();
    // No back link unless asked.
    expect(screen.queryByRole('link', { name: /Back to sign in/ })).toBeNull();
  });

  it('with no tagline or description those lines are omitted', async () => {
    api = mockApi([{ path: '/api/config/branding', body: { ...BRAND, appTagline: '' } }]);
    const { container } = renderPage(<AuthShell title="Sign in">x</AuthShell>, { api });
    await waitFor(() => expect(screen.getByText('FilterOps')).toBeInTheDocument());
    expect(screen.queryByText('Clean rooms, clean records')).toBeNull();
    expect(container.querySelector('h1 + p')).toBeNull();
  });

  it('backToLogin=true links to /login and navigates there', async () => {
    api = mockApi([{ path: '/api/config/branding', body: BRAND }]);
    renderPage(
      <Routes>
        <Route path="/forgot" element={<AuthShell title="Forgot password" backToLogin>x</AuthShell>} />
        <Route path="/login" element={<p>login page</p>} />
      </Routes>,
      { api, route: '/forgot' },
    );
    await waitFor(() => expect(screen.getByText('FilterOps')).toBeInTheDocument());
    const back = screen.getByRole('link', { name: 'Back to sign in' });
    expect(back).toHaveAttribute('href', '/login');
    fireEvent.click(back);
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('backToLogin as a path targets the tablet sign-in instead', async () => {
    api = mockApi([{ path: '/api/config/branding', body: BRAND }]);
    renderPage(<AuthShell title="Forgot password" backToLogin="/m/login">x</AuthShell>, { api });
    await waitFor(() => expect(screen.getByText('FilterOps')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/m/login');
  });

  it('wide widens the form column', async () => {
    api = mockApi([{ path: '/api/config/branding', body: BRAND }]);
    renderPage(<AuthShell title="Contact admin" wide>x</AuthShell>, { api });
    await waitFor(() => expect(screen.getByText('FilterOps')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Contact admin' }).closest('.w-full')).toHaveClass('max-w-lg');
  });

  it('an empty branding logo falls back to the bundled logo (the text tile is never shown via useBranding)', async () => {
    api = mockApi([{ path: '/api/config/branding', body: { ...BRAND, logoUrl: '' } }]);
    renderPage(<AuthShell title="Sign in">x</AuthShell>, { api });
    await waitFor(() => expect(screen.getByRole('img', { name: 'Acme Pharma' })).toHaveAttribute('src', '/logo.jpg'));
  });
});

describe('AuthError / AuthSuccess', () => {
  it('AuthError is an alert carrying the message', () => {
    api = mockApi();
    renderPage(<AuthError>Invalid User ID or password</AuthError>, { api });
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid User ID or password');
  });

  it('AuthSuccess shows its title and body', () => {
    api = mockApi();
    renderPage(<AuthSuccess title="Request sent">An administrator will contact you.</AuthSuccess>, { api });
    expect(screen.getByText('Request sent')).toBeInTheDocument();
    expect(screen.getByText('An administrator will contact you.')).toBeInTheDocument();
  });
});
