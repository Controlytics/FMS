/**
 * Helpers for the signed-out (auth) screens and profile tests.
 * Under __tests__/, so coverage never counts it as application code.
 */
import { vi } from 'vitest';
import { useLocation } from 'react-router-dom';
import { screen } from '@testing-library/react';
import type { MockRoute } from '@/test-utils/page-harness';

/** The public branding feed every AuthShell / profile header reads. */
export function brandingRoute(over: Record<string, unknown> = {}): MockRoute {
  return {
    path: '/api/config/branding',
    body: { appName: 'FMS Test', companyName: 'Test Pharma Ltd', version: '9.9', logoUrl: '', logoText: 'FT', ...over },
  };
}

/**
 * Holds requests whose URL matches `match` until `release()` is called, so a
 * test can see a page's in-flight state ("Signing in…", disabled buttons).
 * Wraps whatever `fetch` is installed (the harness's mock); call AFTER mockApi().
 */
export function holdRequests(match: RegExp): { release: () => void; held: () => number } {
  const inner = globalThis.fetch;
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  let count = 0;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!match.test(url)) return inner(input, init);
    count += 1;
    return gate.then(() => inner(input, init));
  });
  return { release: () => open(), held: () => count };
}

/** Renders the current router location so a test can assert where a page navigated. */
export function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.pathname}</output>;
}

/**
 * The shared <Dialog> (components/ui/dialog.tsx) renders no role="dialog", so a
 * test finds a dialog by its title heading and scopes to the panel around it.
 */
export async function findDialog(title: string | RegExp): Promise<HTMLElement> {
  const h = await screen.findByRole('heading', { name: title });
  return (h.closest('.relative') ?? h.parentElement) as HTMLElement;
}
