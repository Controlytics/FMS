/**
 * <DocumentBranding /> — applies the configured tab title + favicon to <head>.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { DocumentBranding } from '../document-branding';
import { DEFAULT_FAVICON_HREF } from '@/lib/document-branding';

const icons = () => Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')).map((l) => l.getAttribute('href'));

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  document.title = 'index.html fallback';
  document.head.innerHTML = '<link id="app-favicon" rel="icon" href="/pwa-192x192.png" />';
  warn = vi.spyOn(console, 'warn');
  error = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('DocumentBranding', () => {
  it('renders nothing and applies the default title/icon before the config arrives', () => {
    const api = mockApi();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = renderPage(<DocumentBranding />, { api });
    expect(container).toBeEmptyDOMElement();
    expect(document.title).toBe('Filter Management System');
    expect(icons()).toEqual([DEFAULT_FAVICON_HREF]);
    vi.unstubAllGlobals();
  });

  it('applies the operator-configured browser title and favicon', async () => {
    const api = mockApi([{ path: '/api/config/branding', body: { browserTitle: 'Cleanroom Ops', faviconUrl: '/uploads/fav.ico' } }]);
    renderPage(<DocumentBranding />, { api });
    await waitFor(() => expect(document.title).toBe('Cleanroom Ops'));
    expect(icons()).toEqual(['/uploads/fav.ico']);
  });

  it('a blank configured title keeps the previous one; a blank favicon uses the bundled icon', async () => {
    const api = mockApi([{ path: '/api/config/branding', body: { appName: 'X', browserTitle: '   ', faviconUrl: '' } }]);
    renderPage(<DocumentBranding />, { api });
    await waitFor(() => expect(api.calls('GET', '/api/config/branding')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.title).toBe('Filter Management System'); // the default from first render, never blanked
    expect(icons()).toEqual([DEFAULT_FAVICON_HREF]);
  });
});
