import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderPage, mockApi, type MockRequest } from '@/test-utils/page-harness';
import { useOfflineConfig } from '../use-offline-config';
import { getRuntimeOfflineTtlMs, setRuntimeOfflineTtlMs } from '@/lib/offline-store';
import { getHardCutoffMs, setHardCutoffMs } from '@/lib/hard-cutoff';

/**
 * useOfflineConfig — pushes the SUPER_ADMIN offline-cache config into the
 * offline-store TTL and the W4 hard-cutoff window. Real SWR + apiClient via
 * the page harness; only `fetch` is stubbed. The two module-level setters are
 * read back through their real getters.
 */

const H = 60 * 60 * 1000;

function Probe() {
  const c = useOfflineConfig();
  return <p data-testid="cfg">{`stale=${c.cacheStalenessHours} cutoff=${c.cacheHardCutoffHours}`}</p>;
}

let err: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setRuntimeOfflineTtlMs(99 * H);
  setHardCutoffMs(99 * H);
  err = vi.spyOn(console, 'error');
  warn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  expect(err).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('useOfflineConfig', () => {
  it('signed out: never calls the (non-public) endpoint, and seeds both windows with the 24 h defaults', async () => {
    const api = mockApi();
    renderPage(<Probe />, { api });
    expect(screen.getByTestId('cfg')).toHaveTextContent('stale=24 cutoff=24');
    await waitFor(() => expect(getRuntimeOfflineTtlMs()).toBe(24 * H));
    expect(getHardCutoffMs()).toBe(24 * H);
    expect(api.requests).toEqual([]);
  });

  it('signed in: reads /api/config/offline-cache/current and pushes the configured hours into both modules', async () => {
    const api = mockApi([
      { path: '/api/config/offline-cache/current', body: (_r: MockRequest) => ({ cacheStalenessHours: 6, cacheHardCutoffHours: 48 }) },
    ]);
    renderPage(<Probe />, { api, user: { role: 'OPERATOR' } });
    await waitFor(() => expect(screen.getByTestId('cfg')).toHaveTextContent('stale=6 cutoff=48'));
    expect(getRuntimeOfflineTtlMs()).toBe(6 * H);
    expect(getHardCutoffMs()).toBe(48 * H);
    const call = api.calls('GET', '/api/config/offline-cache/current')[0];
    expect(call.headers.authorization).toBe('Bearer test-token');
    expect(api.unmatched).toEqual([]);
  });

  it('a partial response falls back to 24 h for the missing field', async () => {
    const api = mockApi([{ path: '/api/config/offline-cache/current', body: { cacheStalenessHours: 2 } }]);
    renderPage(<Probe />, { api, user: { role: 'OPERATOR' } });
    await waitFor(() => expect(screen.getByTestId('cfg')).toHaveTextContent('stale=2 cutoff=24'));
    expect(getRuntimeOfflineTtlMs()).toBe(2 * H);
    expect(getHardCutoffMs()).toBe(24 * H);
  });
});
