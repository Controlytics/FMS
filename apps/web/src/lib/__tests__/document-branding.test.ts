import { describe, it, expect, beforeEach } from 'vitest';
import { applyDocumentTitle, applyFavicon, DEFAULT_FAVICON_HREF } from '../document-branding';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function iconLinks() {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
}

function seedIndexHtmlHead() {
  document.head.innerHTML =
    '<link id="app-favicon" rel="icon" type="image/png" href="/pwa-192x192.png" />' +
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />';
}

describe('applyDocumentTitle', () => {
  beforeEach(() => {
    document.title = 'Filter Management System';
  });

  it('sets the tab title', () => {
    applyDocumentTitle('Cleanroom Filter Ops');
    expect(document.title).toBe('Cleanroom Filter Ops');
  });

  it('trims surrounding whitespace', () => {
    applyDocumentTitle('  Padded Title  ');
    expect(document.title).toBe('Padded Title');
  });

  it('IGNORES a blank value instead of blanking the tab', () => {
    // An offline tablet gets defaults, but a config row written before this
    // feature — or a failed fetch — must never produce a nameless tab.
    applyDocumentTitle('');
    applyDocumentTitle('   ');
    applyDocumentTitle(undefined);
    applyDocumentTitle(null);
    expect(document.title).toBe('Filter Management System');
  });
});

describe('applyFavicon', () => {
  beforeEach(seedIndexHtmlHead);

  it('replaces the icon link with the configured data URI', () => {
    applyFavicon(PNG);
    const links = iconLinks();
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(PNG);
  });

  it('sets no `type` attribute — the browser sniffs the bytes', () => {
    // A declared type that disagrees with the file (an .ico that the browser
    // reported as image/png on upload) is worse than none.
    applyFavicon(PNG);
    expect(iconLinks()[0].hasAttribute('type')).toBe(false);
  });

  it('falls back to the bundled icon when the value is empty', () => {
    applyFavicon(PNG);
    applyFavicon('');
    expect(iconLinks()).toHaveLength(1);
    expect(iconLinks()[0].getAttribute('href')).toBe(DEFAULT_FAVICON_HREF);
  });

  it('clears a legacy `shortcut icon` link too', () => {
    // rel="shortcut icon" is matched by rel~="icon" but NOT by rel="icon";
    // a leftover second icon link can win over the new one.
    const legacy = document.createElement('link');
    legacy.setAttribute('rel', 'shortcut icon');
    legacy.setAttribute('href', '/old.ico');
    document.head.appendChild(legacy);

    applyFavicon(PNG);

    expect(iconLinks()).toHaveLength(1);
    expect(document.querySelector('link[href="/old.ico"]')).toBeNull();
  });

  it('leaves the apple-touch-icon alone', () => {
    applyFavicon(PNG);
    expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'))
      .toBe('/apple-touch-icon.png');
  });

  it('is idempotent — a repeat call does not churn the DOM', () => {
    // StrictMode double-invokes effects in dev and every SWR revalidation of
    // /api/config/branding re-runs this.
    applyFavicon(PNG);
    const first = iconLinks()[0];
    applyFavicon(PNG);
    expect(iconLinks()).toHaveLength(1);
    expect(iconLinks()[0]).toBe(first);
  });

  it('leaves the index.html link alone when it already points at the default', () => {
    // No churn on the common path: the seeded head IS the default, so the
    // early return fires and the original element (type attribute and all)
    // survives untouched.
    applyFavicon('');
    const links = iconLinks();
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(DEFAULT_FAVICON_HREF);
  });
});
