import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { mockApi, renderPage, type MockRequest, type MockRoute } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';
import { expectAllControlsNamed } from '@/components/__tests__/support/a11y';
import { brandingRoute, holdRequests, LocationProbe } from './support';
import { ForgotPasswordPage } from '../forgot-password';
import { GuestRequestPage } from '../guest-request';

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); vi.unstubAllGlobals(); });

function render(ui: React.ReactElement, at: string, routes: MockRoute[] = []) {
  const api = mockApi([brandingRoute(), ...routes]);
  renderPage(<><Routes><Route path={at} element={ui} /><Route path="*" element={null} /></Routes><LocationProbe /></>, { route: at, api });
  return api;
}

describe('Forgot password (signed out)', () => {
  it('refuses a blank / whitespace User ID without calling the server', async () => {
    const api = render(<ForgotPasswordPage />, '/forgot-password');
    expect(await screen.findByText('Enter your user ID. Your administrator will issue a temporary password.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Please enter your User ID')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('User ID'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(screen.getByText('Please enter your User ID')).toBeInTheDocument();
    expect(api.calls('POST', '/api/auth/forgot-password')).toHaveLength(0);
  });

  it('sends the trimmed User ID, shows the neutral confirmation, and "Back to sign in" goes to /login', async () => {
    const api = render(<ForgotPasswordPage />, '/forgot-password', [
      { method: 'POST', path: '/api/auth/forgot-password', body: { success: true } },
    ]);
    fireEvent.change(await screen.findByLabelText('User ID'), { target: { value: '  jdoe01 ' } });
    const hold = holdRequests(/forgot-password/);
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled();
    hold.release();
    expect(await screen.findByText('Request sent')).toBeInTheDocument();
    // does not reveal whether the account exists
    expect(screen.getByText(/If that user ID exists, your administrator has been notified/)).toBeInTheDocument();
    expect(api.calls('POST', '/api/auth/forgot-password')[0].json).toEqual({ username: 'jdoe01' });

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
  });

  it('a server refusal is shown and the form stays usable', async () => {
    render(<ForgotPasswordPage />, '/forgot-password', [
      { method: 'POST', path: '/api/auth/forgot-password', status: 400, body: { error: 'X', message: 'Too many requests for this account' } },
    ]);
    fireEvent.change(await screen.findByLabelText('User ID'), { target: { value: 'jdoe01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Too many requests for this account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeEnabled();
  });

  it('a refusal with no message gets the generic retry text', async () => {
    render(<ForgotPasswordPage />, '/forgot-password', [
      { method: 'POST', path: '/api/auth/forgot-password', status: 500, body: { error: 'X', message: '' } },
    ]);
    fireEvent.change(await screen.findByLabelText('User ID'), { target: { value: 'jdoe01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Failed to submit request. Please try again.')).toBeInTheDocument();
  });

  it('the "Back to sign in" link above the heading points at /login; every control is named; nothing logged', async () => {
    const api = render(<ForgotPasswordPage />, '/forgot-password');
    expect(await screen.findByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
    expectAllControlsNamed();
    expect(unlabeledControls()).toEqual({ none: [], placeholderOnly: [] });
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});

describe('Guest cleaning request (signed out)', () => {
  const FILL: Record<string, string> = {
    'Your full name': ' Ravi Kumar ', 'e.g. EMP-001': 'EMP-7', Block: 'Block A', Area: 'Area 2', AHU: 'AHU-01', Filter: 'F-100',
  };
  const fillAll = (except?: string) => {
    for (const [ph, v] of Object.entries(FILL)) if (ph !== except) fireEvent.change(screen.getByPlaceholderText(ph), { target: { value: v } });
  };

  it('Send stays disabled until all six fields hold non-blank text', async () => {
    render(<GuestRequestPage />, '/guest-request');
    const send = await screen.findByRole('button', { name: 'Send request' });
    expect(send).toBeDisabled();
    fillAll('Filter');
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Filter'), { target: { value: '   ' } });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Filter'), { target: { value: 'F-100' } });
    expect(send).toBeEnabled();
    // employee id is capped at 60, the rest at 120
    expect(screen.getByPlaceholderText('e.g. EMP-001')).toHaveAttribute('maxLength', '60');
    expect(screen.getByPlaceholderText('Block')).toHaveAttribute('maxLength', '120');
  });

  it('posts the trimmed fields to the public endpoint and confirms', async () => {
    const api = render(<GuestRequestPage />, '/guest-request', [
      { method: 'POST', path: '/api/guest/cleaning-request', status: 201, body: (r: MockRequest) => ({ ok: true, echo: r.json }) },
    ]);
    await screen.findByRole('button', { name: 'Send request' });
    fillAll();
    const hold = holdRequests(/guest\/cleaning-request/);
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled();
    hold.release();
    expect(await screen.findByText('Your filter cleaning request has been sent.')).toBeInTheDocument();
    expect(api.calls('POST', '/api/guest/cleaning-request')[0].json).toEqual({
      name: 'Ravi Kumar', employeeId: 'EMP-7', block: 'Block A', area: 'Area 2', ahu: 'AHU-01', filter: 'F-100',
    });
    expect(screen.getAllByRole('link', { name: 'Back to sign in' }).some((a) => a.getAttribute('href') === '/login')).toBe(true);
  });

  it('a refusal shows the server message; one without a message names the HTTP status', async () => {
    render(<GuestRequestPage />, '/guest-request', [
      { method: 'POST', path: '/api/guest/cleaning-request', times: 1, status: 400, body: { message: 'Unknown AHU' } },
      { method: 'POST', path: '/api/guest/cleaning-request', status: 503, body: {} },
    ]);
    await screen.findByRole('button', { name: 'Send request' });
    fillAll();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Unknown AHU')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Request failed (HTTP 503)')).toBeInTheDocument();
  });

  it('a non-JSON error body still names the status', async () => {
    const api = render(<GuestRequestPage />, '/guest-request');
    await screen.findByRole('button', { name: 'Send request' });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/guest/')) return new Response('<html>bad gateway</html>', { status: 502 });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    fillAll();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Request failed (HTTP 502)')).toBeInTheDocument();
    expect(api.unmatched).toEqual([]);
  });

  it('a network failure with no message gets the generic retry text', async () => {
    render(<GuestRequestPage />, '/guest-request');
    await screen.findByRole('button', { name: 'Send request' });
    vi.stubGlobal('fetch', async () => { throw new Error(''); });
    fillAll();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Could not submit your request. Please try again.')).toBeInTheDocument();
  });

  it('every field is labelled by its visible caption; nothing logged', async () => {
    const api = render(<GuestRequestPage />, '/guest-request');
    await screen.findByRole('button', { name: 'Send request' });
    expect(screen.getByRole('textbox', { name: /Employee ID/ })).toBeInTheDocument();
    expectAllControlsNamed();
    expect(unlabeledControls()).toEqual({ none: [], placeholderOnly: [] });
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
