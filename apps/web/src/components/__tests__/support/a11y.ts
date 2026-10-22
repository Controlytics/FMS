/**
 * Shared accessibility assertion for component tests (2026-10-21).
 * NOT a test file. One rule for every "every control has an accessible name" test, so
 * a component cannot pass with a looser check than its neighbour.
 *
 * Uses dom-accessibility-api — the same name computation @testing-library uses for
 * `getByRole(role, { name })` — over every element with an interactive or dialog role
 * inside `root` (hidden elements excluded, as getByRole does).
 */
import { within } from '@testing-library/react';
import { computeAccessibleName } from 'dom-accessibility-api';

export const NAMED_ROLES = [
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio',
  'switch', 'spinbutton', 'slider', 'menuitem', 'option', 'tab', 'dialog', 'alertdialog',
] as const;

/** Every control / dialog in `root` with an empty accessible name, as "role: <outerHTML head>". */
export function unnamedControls(root: HTMLElement): string[] {
  const out: string[] = [];
  for (const role of NAMED_ROLES) {
    for (const el of within(root).queryAllByRole(role)) {
      if (!computeAccessibleName(el).trim()) out.push(`${role}: ${el.outerHTML.slice(0, 120)}`);
    }
  }
  return out;
}

/** Fails listing each unnamed control, so the message says exactly what to fix. */
export function expectAllControlsNamed(root: HTMLElement = document.body): void {
  const missing = unnamedControls(root);
  if (missing.length) throw new Error(`Controls without an accessible name:\n  ${missing.join('\n  ')}`);
}
