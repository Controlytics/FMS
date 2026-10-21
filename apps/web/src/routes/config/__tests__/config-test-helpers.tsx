/**
 * Shared helpers for the config-page tests (coverage campaign 2026-10-21).
 * Not a test file (vitest only collects *.test.ts[x]). Builds on
 * src/test-utils/page-harness.tsx: fetch is the only thing stubbed, the real
 * SWR fetcher / apiClient / useAuth / useCan / useReauth run.
 */
import { cleanup, screen, fireEvent, act, within } from '@testing-library/react';
import { vi } from 'vitest';
import type { MockRoute } from '@/test-utils/page-harness';

export const SUPER_ADMIN = { role: 'SUPER_ADMIN', permissions: [] as string[] };

/**
 * GETs almost every config page fires through shared hooks. `reauth` lists the
 * action keys `/my-actions` reports as needing a password up front (empty =
 * the page only prompts after the server answers 401 REAUTH_REQUIRED).
 */
export function commonRoutes(opts: { reauth?: string[] } = {}): MockRoute[] {
  return [
    { path: '/api/config/action-reauth/my-actions', body: { actions: opts.reauth ?? [] } },
    { path: '/api/config/branding', body: {} },
    { path: '/api/config/datetime/current', body: {} },
  ];
}

/** A 401 REAUTH_REQUIRED answer, once — the server demanding a signature. */
export function reauthRequired(method: string, path: string | RegExp): MockRoute {
  return { method, path, status: 401, times: 1, body: { error: 'REAUTH_REQUIRED', message: 'Re-authentication required' } };
}

export function resetEnv() {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
}

/** Type a password into the open re-auth dialog and press Verify & Continue. */
export async function signReauth(password = 'Secret@123') {
  const input = await screen.findByPlaceholderText('Enter your password');
  fireEvent.change(input, { target: { value: password } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' })); });
}

/** Cancel the open re-auth dialog. */
export async function cancelReauth() {
  await screen.findByPlaceholderText('Enter your password');
  const dlg = screen.getByText('Confirm Your Identity').closest('div.relative') as HTMLElement | null;
  const scope = dlg ? within(dlg) : screen;
  await act(async () => { fireEvent.click(scope.getByRole('button', { name: 'Cancel' })); });
}

/**
 * The acknowledgement modal toast.success / toast.error renders (MessageDialog).
 * Returns its text and dismisses it with OK.
 */
export async function ackMessage(title: string | RegExp) {
  const heading = await screen.findByRole('heading', { name: title });
  const dialog = heading.closest('[role="dialog"]') as HTMLElement;
  const text = dialog.textContent ?? '';
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'OK' })); });
  return text;
}
