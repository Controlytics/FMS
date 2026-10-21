/**
 * swr-config — the shared fetcher and the global onError policy that decides
 * which load failures surface as a "Load Error" toast (coverage campaign
 * 2026-10-21). Only global `fetch` is stubbed (page-harness mockApi).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockApi } from '@/test-utils/page-harness';
import { swrConfig, registerSwrToast, unregisterSwrToast } from '../swr-config';

const onError = (e: unknown) => (swrConfig.onError as (e: unknown) => void)(e);

describe('swrConfig', () => {
  let toast: ReturnType<typeof vi.fn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    toast = vi.fn();
    registerSwrToast(toast);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => {
    unregisterSwrToast();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetcher GETs the key through apiClient (auth header, parsed JSON)', async () => {
    sessionStorage.setItem('access_token', 'tok');
    const m = mockApi([{ path: '/api/things', body: [{ id: 1 }] }]);
    const fetcher = swrConfig.fetcher as (url: string) => Promise<unknown>;
    await expect(fetcher('/api/things')).resolves.toEqual([{ id: 1 }]);
    expect(m.requests[0]).toMatchObject({ method: 'GET', path: '/api/things' });
    expect(m.requests[0].headers.authorization).toBe('Bearer tok');
  });

  it('keeps the retry / revalidation policy the pages rely on', () => {
    expect(swrConfig).toMatchObject({
      revalidateOnFocus: true, shouldRetryOnError: true, errorRetryCount: 2, errorRetryInterval: 5000, dedupingInterval: 5000,
    });
  });

  it.each([
    ['401 status', { status: 401, message: 'Missing token' }],
    ['UNAUTHORIZED body code', { error: 'UNAUTHORIZED', message: 'no' }],
    ['fetch TypeError (offline)', Object.assign(new TypeError('x'), {})],
    ['"Failed to fetch"', new Error('Failed to fetch')],
    ['NetworkError', new Error('NetworkError when attempting to fetch resource.')],
    ['"Network request failed"', new Error('Network request failed')],
    ['Safari "Load failed"', new Error('Load failed')],
    ['"Failed to connect"', new Error('Failed to connect to 10.0.0.2')],
    ['Android "Unable to resolve host"', new Error('Unable to resolve host "srv"')],
    ['SPA <!doctype> fallback body', new Error('Unexpected token < in JSON at position 0: <!DOCTYPE html>')],
    ['a bare string network error', 'failed to fetch'],
  ])('is silent for %s — no toast, no console error', (_label, err) => {
    onError(err);
    expect(toast).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('a real server error logs once and raises a non-blocking "Load Error" toast with the message', () => {
    onError(Object.assign(new Error('Database timeout'), { status: 500 }));
    expect(consoleError).toHaveBeenCalledWith('[SWR Error]', 'Database timeout');
    expect(toast).toHaveBeenCalledWith('Load Error', 'Database timeout');
  });

  it('falls back to a generic message when the error has none', () => {
    onError({ status: 500 });
    expect(toast).toHaveBeenCalledWith('Load Error', 'Failed to load data. Please try again.');
  });

  it('a 403 is logged but never toasted (permission-gated pages handle their own empty state)', () => {
    onError(Object.assign(new Error('Forbidden'), { status: 403 }));
    expect(consoleError).toHaveBeenCalledWith('[SWR Error]', 'Forbidden');
    expect(toast).not.toHaveBeenCalled();
  });

  it('does nothing beyond logging once the provider unregistered its toast', () => {
    unregisterSwrToast();
    expect(() => onError(new Error('Server exploded'))).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith('[SWR Error]', 'Server exploded');
    expect(toast).not.toHaveBeenCalled();
  });

  it('handles null / undefined errors without throwing', () => {
    expect(() => onError(undefined)).not.toThrow();
    expect(toast).toHaveBeenCalledWith('Load Error', 'Failed to load data. Please try again.');
  });
});
