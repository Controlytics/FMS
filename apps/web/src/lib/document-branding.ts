/**
 * Browser tab identity (2026-09-03).
 *
 * The <title> and the favicon in `index.html` are only the pre-fetch fallback.
 * The live values come from Config -> Branding (`browserTitle` / `faviconUrl`)
 * and are applied here, once, by <DocumentBranding /> at the app root.
 *
 * Both functions are IDEMPOTENT — they read the current DOM state and return
 * early when it already matches. React StrictMode double-invokes effects in
 * dev, and every SWR revalidation of /api/config/branding re-runs them.
 */

/** Bundled icon used when the operator has not uploaded one. Must match index.html. */
export const DEFAULT_FAVICON_HREF = '/pwa-192x192.png';

/**
 * Set the browser tab title.
 *
 * A blank value is IGNORED rather than written: an empty `document.title`
 * renders as a nameless tab, and blanking it would be a worse answer than
 * leaving the index.html fallback in place. The real guard against blank is
 * `browserTitle: z.string().min(1)` in the shared schema.
 */
export function applyDocumentTitle(title: string | null | undefined): void {
  const next = (title ?? '').trim();
  if (!next) return;
  if (document.title === next) return;
  document.title = next;
}

/**
 * Swap the favicon.
 *
 * The element is REPLACED, not mutated: several browsers ignore an in-place
 * `href` change on an existing icon link and keep painting the old icon.
 *
 * Matches `link[rel~="icon"]` (not `rel="icon"`) so a legacy `shortcut icon`
 * is caught too — a leftover second icon link can win over the new one.
 *
 * No `type` attribute is set on purpose. Browsers sniff the bytes, and a
 * declared type that disagrees with the file (an .ico saved as image/png,
 * which is what some browsers report for .ico uploads) is worse than none.
 *
 * `rel="apple-touch-icon"` is deliberately left alone — different surface.
 */
export function applyFavicon(href: string | null | undefined): void {
  const next = (href ?? '').trim() || DEFAULT_FAVICON_HREF;
  const existing = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
  );

  // Compare the raw attribute, not `link.href` — the property resolves
  // '/pwa-192x192.png' to an absolute URL and would never match.
  if (existing.length === 1 && existing[0].getAttribute('href') === next) return;

  for (const link of existing) link.remove();

  const link = document.createElement('link');
  link.id = 'app-favicon';
  link.rel = 'icon';
  link.setAttribute('href', next);
  document.head.appendChild(link);
}
