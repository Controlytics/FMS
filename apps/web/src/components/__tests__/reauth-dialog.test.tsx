/**
 * ReauthDialog (the §11 password prompt) and ReauthPrompt (its one-line
 * wiring to useReauth) — coverage campaign 2026-10-21. ReauthPrompt runs
 * against the real useReauth + SWR path; only global `fetch` is stubbed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useState } from 'react';
import { ReauthDialog } from '../reauth-dialog';
import { ReauthPrompt } from '../reauth-prompt';
import { useReauth } from '@/hooks/use-reauth';
import { renderPage, mockApi } from '@/test-utils/page-harness';
import { expectAllControlsNamed } from './support/a11y';

type Props = Parameters<typeof ReauthDialog>[0];
const baseProps = (over: Partial<Props> = {}): Props => ({
  open: true, password: '', error: '', isVerifying: false,
  onPasswordChange: vi.fn(), onConfirm: vi.fn(), onCancel: vi.fn(),
  ...over,
});
const passwordInput = () => screen.getByPlaceholderText('Enter your password') as HTMLInputElement;

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ReauthDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ReauthDialog {...baseProps({ open: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the action being signed, or uses the generic sentence', () => {
    const { rerender } = render(<ReauthDialog {...baseProps({ actionLabel: 'Delete User' })} />);
    expect(screen.getByRole('heading', { name: 'Confirm Your Identity' })).toBeInTheDocument();
    expect(screen.getByText(/Performing "Delete User" requires identity verification\./)).toBeInTheDocument();
    rerender(<ReauthDialog {...baseProps()} />);
    expect(screen.getByText(/^This action requires identity verification\./)).toBeInTheDocument();
  });

  it('shows the error from the hook', () => {
    render(<ReauthDialog {...baseProps({ error: 'Incorrect password. Please try again.' })} />);
    expect(screen.getByText('Incorrect password. Please try again.')).toBeInTheDocument();
  });

  it('renders the field as text first (defeats autofill) and switches to a focused password field after a tick', async () => {
    render(<ReauthDialog {...baseProps()} />);
    expect(passwordInput().type).toBe('text');
    expect(passwordInput().autocomplete).toBe('one-time-code');
    await waitFor(() => expect(passwordInput().type).toBe('password'));
    expect(document.activeElement).toBe(passwordInput());
  });

  it('forwards typing, and Enter confirms only when a password is present', () => {
    const p = baseProps();
    const { rerender } = render(<ReauthDialog {...p} />);
    fireEvent.change(passwordInput(), { target: { value: 'sec' } });
    expect(p.onPasswordChange).toHaveBeenCalledWith('sec');
    fireEvent.keyDown(passwordInput(), { key: 'Enter' });
    expect(p.onConfirm).not.toHaveBeenCalled();
    rerender(<ReauthDialog {...p} password="sec" />);
    fireEvent.keyDown(passwordInput(), { key: 'a' });
    expect(p.onConfirm).not.toHaveBeenCalled();
    fireEvent.keyDown(passwordInput(), { key: 'Enter' });
    expect(p.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Verify is disabled with no password and while verifying, and says so', () => {
    const p = baseProps();
    const { rerender } = render(<ReauthDialog {...p} />);
    expect(screen.getByRole('button', { name: 'Verify & Continue' })).toBeDisabled();
    rerender(<ReauthDialog {...p} password="x" />);
    fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' }));
    expect(p.onConfirm).toHaveBeenCalledTimes(1);
    rerender(<ReauthDialog {...p} password="x" isVerifying />);
    expect(screen.getByRole('button', { name: 'Verifying...' })).toBeDisabled();
  });

  it('Cancel, the backdrop and Escape all cancel', () => {
    const p = baseProps();
    const { container } = render(<ReauthDialog {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(p.onCancel).toHaveBeenCalledTimes(2);
    const backdrop = container.querySelector('.fixed.inset-0 > .fixed.inset-0') as HTMLElement;
    fireEvent.click(backdrop);
    expect(p.onCancel).toHaveBeenCalledTimes(3);
  });

  it('the eye button toggles the password visible, and closing resets it and drops focus', async () => {
    const p = baseProps({ password: 'abc' });
    const { rerender } = render(<ReauthDialog {...p} />);
    await waitFor(() => expect(passwordInput().type).toBe('password'));
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(passwordInput().type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(passwordInput().type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' })); // left "shown" before closing

    passwordInput().focus();
    rerender(<ReauthDialog {...p} open={false} />);
    expect(document.activeElement).toBe(document.body);
    rerender(<ReauthDialog {...p} open />);
    expect(passwordInput().type).toBe('text'); // not "shown" — the autofill-defeat phase
    await waitFor(() => expect(passwordInput().type).toBe('password'));
  });

  // A1 / A2 / A3: the §11 password prompt is a named modal dialog, its password field
  // is named by its label, and the eye toggle says what it does and whether it is on.
  it('is a named modal dialog with a labelled password field and a named show/hide toggle', async () => {
    const { container } = render(<ReauthDialog {...baseProps()} />);
    expect(screen.getByRole('dialog', { name: 'Confirm Your Identity' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Current Password')).toBe(passwordInput());
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(passwordInput().type).toBe('password'));
    fireEvent.click(toggle);
    expect(passwordInput().type).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
    expectAllControlsNamed(container.ownerDocument.body);
  });
});

describe('ReauthPrompt (wired to the real useReauth)', () => {
  function Page({ onDone }: { onDone: (pw?: string) => void }) {
    const reauth = useReauth();
    const [status, setStatus] = useState('idle');
    return (
      <>
        <button onClick={() => reauth.execute('APPROVE_BLOCK_CHANGE', async (pw) => { onDone(pw); }, { onSuccess: () => setStatus('done'), onCancel: () => setStatus('cancelled') })}>Approve</button>
        <span data-testid="status">{status}</span>
        <ReauthPrompt reauth={reauth} actionLabel="Fallback label" />
      </>
    );
  }

  it('opens for a gated action with the catalog label, signs with the typed password, and closes', async () => {
    const onDone = vi.fn();
    const api = mockApi([{ path: '/api/config/action-reauth/my-actions', body: { actions: ['APPROVE_BLOCK_CHANGE'] } }]);
    renderPage(<Page onDone={onDone} />, { api, user: { role: 'MANAGER' } });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions')).toHaveLength(1));
    // Wait for the rows to land in SWR before acting.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/Performing "Approve Block Change" requires/)).toBeInTheDocument();
    fireEvent.change(passwordInput(), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('done'));
    expect(onDone).toHaveBeenCalledWith('pw');
    expect(screen.queryByText('Confirm Your Identity')).toBeNull();
  });

  it('falls back to the page\'s own label when the action is not in the catalog, and Cancel unwinds the caller', async () => {
    function Custom() {
      const reauth = useReauth();
      const [status, setStatus] = useState('idle');
      return (
        <>
          <button onClick={() => reauth.execute('CUSTOM_ROW', async () => {}, { onCancel: () => setStatus('cancelled') })}>Go</button>
          <span data-testid="status">{status}</span>
          <ReauthPrompt reauth={reauth} actionLabel="Fallback label" />
        </>
      );
    }
    const api = mockApi([{ path: '/api/config/action-reauth/my-actions', body: { actions: ['CUSTOM_ROW'] } }]);
    renderPage(<Custom />, { api, user: { role: 'MANAGER' } });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions')).toHaveLength(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(await screen.findByText(/Performing "Fallback label" requires/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('status')).toHaveTextContent('cancelled');
    expect(screen.queryByText('Confirm Your Identity')).toBeNull();
  });
});
