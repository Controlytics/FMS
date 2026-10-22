/**
 * Every list page starts on the CONFIGURED page size (Config → Pagination:
 * "records per page options for all list views"), 2026-10-22.
 *
 * Fourteen pages did not. Three seeded their state from the pagination hook's
 * pre-load fallback; eleven hard-coded 20 / 25 / 50, often a size the page's own
 * selector did not offer. The fix is one hook, usePageSize (hooks/__tests__/
 * use-page-size.test.tsx). This file holds:
 *   - a source guard, so no list page seeds its page size from useState again;
 *   - one rendered page, end to end on a cold load.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { join, relative } from 'node:path';
import { screen, waitFor, cleanup } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { ApprovalsPage } from '@/routes/approvals';
import { listFiles, readSource, WEB_SRC } from './support/source-files';

const SRC = WEB_SRC;

describe('list page size', () => {
  afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); });

  it('no route seeds its page size from useState (a constant or the pre-load default) or fixes it in a constant', () => {
    const SEEDED = /const\s*\[\s*(pageSize|perPage|rowsPerPage)\s*,\s*\w+\s*\]\s*=\s*useState\b/;
    const FIXED = /const\s+(PER_PAGE|PAGE_SIZE|ROWS_PER_PAGE)\s*=\s*\d+/; // RFID Track Record had PER_PAGE = 50
    const offenders = listFiles(join(SRC, 'routes'), (name) => name.endsWith('.tsx'), ['__tests__', 'node_modules'])
      .filter((f) => { const s = readSource(f); return SEEDED.test(s) || FIXED.test(s); })
      .map((f) => relative(SRC, f).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });

  it('Approvals asks the server for the first configured option on a cold load (not the maximum)', async () => {
    const api = mockApi([
      { path: '/api/config/pagination/current', body: { limit: 100, count: 3, options: [25, 50, 100] } },
      { path: '/api/config/action-reauth/my-actions', body: { actions: [] } },
      { path: '/api/block-change-requests/pending-count', body: { count: 0 } },
      { path: '/api/block-change-requests', body: { data: [], total: 0 } },
    ]);
    renderPage(<ApprovalsPage />, { user: { role: 'MANAGER', permissions: ['BLOCK_CHANGE_APPROVE'] }, api });
    await screen.findByText(/Review and process block change requests/);
    await waitFor(() => {
      const list = api.calls('GET', '/api/block-change-requests');
      expect(list.at(-1)?.query.get('limit')).toBe('25');
    });
  });
});
