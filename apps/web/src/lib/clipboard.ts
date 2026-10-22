/**
 * Copy text to the clipboard and say whether it worked (2026-10-22).
 *
 * The six copy buttons each had their own copy code, and none could tell the
 * operator it failed: four showed "Copied!" even when the fallback copy returned
 * false, Email settings showed it before the write had happened, and Admin
 * Requests let a refused write become an unhandled rejection. A caller shows
 * "Copied" only on `true` and reports `false`.
 *
 * The async Clipboard API needs a secure context and the page's permission; when
 * it is missing or refuses, a hidden textarea + execCommand('copy') is tried.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Refused (permission, document not focused): the selection copy below
      // is the fallback, and its result is what the caller reports.
    }
  }
  return copyWithSelection(text);
}

function copyWithSelection(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}

/** The message a copy button shows when copyText() returns false. */
export const COPY_FAILED = {
  title: 'Copy failed',
  message: 'The browser did not allow the copy. Select the text and copy it by hand.',
} as const;
