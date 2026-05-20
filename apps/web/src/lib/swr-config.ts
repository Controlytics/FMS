import { type SWRConfiguration } from 'swr';
import { apiClient } from './api-client';

/**
 * Module-level toast callback registered by ToastProvider at mount.
 * Allows SWR onError (which runs outside React tree) to trigger toasts.
 */
let _toastError: ((title: string, message?: string) => void) | null = null;
export function registerSwrToast(fn: (title: string, message?: string) => void) { _toastError = fn; }
export function unregisterSwrToast() { _toastError = null; }

export const swrConfig: SWRConfiguration = {
  fetcher: (url: string) => apiClient.get(url),
  revalidateOnFocus: true,
  shouldRetryOnError: true,
  errorRetryCount: 2,
  errorRetryInterval: 5000,
  dedupingInterval: 5000,
  onError: (error: any) => {
    // Don't show toast for 401 (handled by api-client redirect)
    if (error?.status === 401 || error?.error === 'UNAUTHORIZED') return;
    // Silently ignore network errors (offline mode)
    const msg = String(error?.message || error || '').toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed') || msg.includes('load failed') || msg.includes('failed to connect') || msg.includes('unable to resolve host') || error?.name === 'TypeError') return;
    // Issue #6 fix (2026-05-18): when Capacitor's WebView is offline, the
    // bundled APK serves the SPA's index.html for any unresolved fetch
    // (instead of failing). The response IS HTML, so JSON.parse explodes
    // with "Unexpected token '<', '<!DOCTYPE'... is not valid JSON" — but
    // none of the network-error keywords above match, so the toast fires.
    // For a freshly-launched offline app this scares the operator into
    // thinking something is broken when the real cause is "no connectivity
    // yet, public-endpoint fetches will retry when wifi is back."
    if (msg.includes('unexpected token') || msg.includes('doctype') || msg.includes('failed to parse server response')) return;
    console.error('[SWR Error]', error?.message || error);
    if (error?.status !== 401 && error?.status !== 403) {
      _toastError?.('Load Error', error?.message || 'Failed to load data. Please try again.');
    }
  },
};
