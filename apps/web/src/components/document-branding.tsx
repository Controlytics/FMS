import { useEffect } from 'react';
import { useBranding } from '@/hooks/use-branding';
import { applyDocumentTitle, applyFavicon } from '@/lib/document-branding';

/**
 * Applies the operator-configured browser tab title + favicon.
 *
 * Mounted ONCE at the app root (main.tsx) rather than inside `useBranding()`:
 * that hook has ~10 callers, and putting a <head> mutation in its effect would
 * have every one of them racing on the same two DOM nodes on every render.
 *
 * Renders nothing. Covers every route — desktop, /m tablet and the login pages
 * alike — because it sits above the router.
 */
export function DocumentBranding() {
  const { branding } = useBranding();
  const { browserTitle, faviconUrl } = branding;

  useEffect(() => {
    applyDocumentTitle(browserTitle);
  }, [browserTitle]);

  useEffect(() => {
    applyFavicon(faviconUrl);
  }, [faviconUrl]);

  return null;
}
