import { describe, it, expect, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { resetEnv } from './config-test-helpers';
import { renderFdm, openTab } from './fdm-helpers';

/**
 * "10,000+" totals (operator decision 2026-10-22). The audit list and the filter
 * events list stop counting at 10,000 and say so with `totalCapped`. The Filter
 * Data Management tabs over those two feeds show "10,000+ Records" and the pager
 * keeps offering the next page while the current one is full.
 */
afterEach(resetEnv);

const ev = (i: number) => ({ id: `ev${i}`, eventType: 'REMARK_ADDED', performedAt: '2026-07-01T09:00:00.000Z', attributes: {} });
const fullPage = Array.from({ length: 20 }, (_, i) => ev(i));
const auditRow = (i: number) => ({ id: `a${i}`, action: 'CONFIG_UPDATED', userId: 'u1', userRole: 'ADMIN', timestamp: '2026-07-01T09:00:00.000Z' });

describe('Filter Data Management — capped totals', () => {
  it('Filter Events: "10,000+" Records, and Next stays on past the cap while pages are full', async () => {
    renderFdm([{ path: '/api/filters/events', body: { data: fullPage, total: 10000, totalCapped: true } }]);
    await openTab('Filter Events');
    await screen.findByText('Records');
    await expect.poll(() => screen.getByText('Records').previousElementSibling?.textContent).toBe('10,000+');
    expect(document.body.textContent).toMatch(/Showing 1–20 of 10,000\+/);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('Audit Trail: "10,000+" Records', async () => {
    renderFdm([{ path: '/api/audit', body: { data: Array.from({ length: 20 }, (_, i) => auditRow(i)), total: 10000, totalCapped: true } }]);
    await openTab('Audit Trail');
    await screen.findByText('Records');
    await expect.poll(() => screen.getByText('Records').previousElementSibling?.textContent).toBe('10,000+');
  });

  it('an exact total is shown as before', async () => {
    renderFdm([{ path: '/api/filters/events', body: { data: [ev(1)], total: 1 } }]);
    await openTab('Filter Events');
    await expect.poll(() => screen.getByText('Records').previousElementSibling?.textContent).toBe('1');
  });
});
