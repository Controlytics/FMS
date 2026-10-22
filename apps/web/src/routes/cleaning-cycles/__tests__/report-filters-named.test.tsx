/**
 * D03-01 (functional test, 2026-10-22): the Block / Area / AHU / Filter selects on
 * the Cleaning Record and Filter Lifecycle reports had a visible label that was not
 * bound to the control, so a screen reader announced four unnamed "combo box"es.
 * Operator rule: no unlabelled UI.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA } from '../../filter-management/__tests__/fm-test-kit';

vi.mock('@/lib/pdf-report', () => ({ createReport: vi.fn() }));
vi.mock('@/lib/excel-export', () => ({ exportToExcel: vi.fn() }));
import { CleaningCycleHistoryPage } from '../history';
import { FilterLifecycleReportPage } from '../filter-lifecycle';

usePageTestLifecycle();

const HIER: MockRoute[] = [
  { path: '/api/hierarchy/blocks', body: { data: [{ id: 'b1', name: 'Block A' }] } },
  { path: '/api/hierarchy/areas', body: { data: [] } },
  { path: '/api/hierarchy/ahus', body: { data: [] } },
  { path: '/api/hierarchy/filters', body: { data: [] } },
];

describe('report filters are named by their visible labels', () => {
  it('Cleaning Record: Search, Block, Area, AHU and Filter', async () => {
    const api = mockApi([...HIER, { path: '/api/filters/cleaning-record', body: { data: [], total: 0 } }, ...baseRoutes()]);
    renderPage(<CleaningCycleHistoryPage />, { user: SA, api });
    expect(await screen.findByRole('combobox', { name: 'Block' })).toBeInTheDocument();
    for (const name of ['Area', 'AHU', 'Filter']) expect(screen.getByRole('combobox', { name })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeInTheDocument();
  });

  it('Filter Lifecycle report: Block, Area, AHU and Filter', async () => {
    const api = mockApi([...HIER,
      { path: '/api/filters/retirements', body: [] },
      { path: '/api/filters/replacements', body: [] },
      ...baseRoutes()]);
    renderPage(<FilterLifecycleReportPage />, { user: SA, api });
    expect(await screen.findByRole('combobox', { name: 'Block' })).toBeInTheDocument();
    for (const name of ['Area', 'AHU', 'Filter']) expect(screen.getByRole('combobox', { name })).toBeInTheDocument();
  });
});
