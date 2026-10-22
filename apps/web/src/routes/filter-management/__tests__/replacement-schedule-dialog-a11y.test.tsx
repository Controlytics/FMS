/**
 * D03-15 (operator rule: no unlabelled UI): the Replacement Schedule upload
 * dialog's close "X" was an icon-only button with no accessible name.
 */
import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA } from './fm-test-kit';
import { ReplacementSchedulePage } from '../replacement-schedule';

usePageTestLifecycle();

function setup() {
  return mockApi([
    { path: '/api/replacement-schedules', body: { data: [] } },
    { path: '/api/config/replacement-schedule-filters/current', body: { enabled: true } },
    { path: '/api/assets/identifiers', body: { data: [] } },
    ...baseRoutes(),
  ]);
}

describe('Replacement Schedule upload dialog — named controls', () => {
  it('the close X is named, closes the dialog, and every control in the dialog has a name', async () => {
    renderPage(<ReplacementSchedulePage />, { user: SA, api: setup() });
    fireEvent.click(await screen.findByRole('button', { name: /Upload Schedule/ }));
    const heading = screen.getByRole('heading', { name: 'Upload Replacement Schedule' });
    const dialog = heading.closest('div.fixed') as HTMLElement;

    const unnamed = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button, input:not([type=hidden]), select, textarea'))
      .filter((el) => { try { expect(el).toHaveAccessibleName(); return false; } catch { return true; } })
      .map((el) => el.outerHTML.replace(/\s+/g, ' ').slice(0, 140));
    expect(unnamed).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Close upload dialog' }));
    expect(screen.queryByRole('heading', { name: 'Upload Replacement Schedule' })).toBeNull();
  });
});
