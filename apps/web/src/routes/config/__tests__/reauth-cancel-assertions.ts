/**
 * Item 9 (2026-10-21): cancelling the password prompt is the operator's
 * choice, not a failure. When a page passes no `onCancel`, `useReauth().cancel`
 * falls back to the page's `onError` with "Cancelled — password confirmation
 * was not completed.", and the page renders it as a failure (modal, red
 * banner, or inside its success notice). Shared assertions for the per-page
 * cancel tests. Not a test file (vitest only collects *.test.ts[x]).
 */
import { expect, vi, type MockInstance } from 'vitest';

/** The hook's fallback text for a cancel routed through onError. */
const CANCEL_FALLBACK = /Cancelled|password confirmation was not completed/i;
/**
 * Failure wording these pages show on their error paths ("Save failed",
 * "Update Failed", "Failed to save …"). Narrow on purpose: static labels such
 * as "Max Failed Login Attempts" are not a failure report.
 */
const FAILURE = /\b(save|update|delete|reset) failed\b|\bfailed to\b/i;

/** Silences and records console.error; restore it with `.mockRestore()`. */
export function spyConsoleError(): MockInstance {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

/** After a cancel: no cancel text, no failure wording, nothing logged as an error. */
export function expectSilentCancel(consoleError?: MockInstance) {
  const text = document.body.textContent ?? '';
  expect(text).not.toMatch(CANCEL_FALLBACK);
  expect(text).not.toMatch(FAILURE);
  if (consoleError) expect(consoleError).not.toHaveBeenCalled();
}
