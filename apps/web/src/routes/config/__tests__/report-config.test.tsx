import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { ReportConfigPage } from '../report-config';
import { SUPER_ADMIN, commonRoutes, resetEnv } from './config-test-helpers';

vi.setConfig({ testTimeout: 30000 });
afterEach(resetEnv);

const W = { timeout: 5000 };

function setup() {
  const api = mockApi([
    { path: '/api/config/report-page-titles', body: { companyName: 'Acme Pharma' } },
    { path: '/api/config/report-labels/current', body: { 'audit-trail': { title: 'Audit Log' } } },
    { path: '/api/config/report-signatories', body: {} },
    { path: '/api/config/export-options', body: {} },
    { path: '/api/roles/active', body: [{ name: 'QA', displayName: 'Quality Assurance' }] },
    ...commonRoutes(),
  ]);
  renderPage(<ReportConfigPage />, { user: SUPER_ADMIN, api, route: '/config/report-config' });
  return api;
}

const tab = (label: string) => screen.getByRole('button', { name: label });
const calls = (api: ReturnType<typeof setup>, path: string) => api.calls('GET', path).length;

describe('Report configuration (tabbed wrapper)', () => {
  it('opens on Identity, which alone loads the report identity', async () => {
    const api = setup();
    expect(screen.getByRole('heading', { name: 'Report Configuration', level: 1 })).toBeInTheDocument();
    expect(['Identity', 'Labels', 'Signatories', 'Export'].map((l) => tab(l).textContent)).toEqual(['Identity', 'Labels', 'Signatories', 'Export']);
    await waitFor(() => expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('Acme Pharma'), W);
    expect(calls(api, '/api/config/report-labels/current')).toBe(0);
    expect(calls(api, '/api/config/report-signatories')).toBe(0);
    expect(calls(api, '/api/config/export-options')).toBe(0);
    expect(tab('Identity').className).toContain('bg-white');
    expect(tab('Labels').className).not.toContain('bg-white');
  });

  it('each tab swaps in its own editor and loads only that editor\'s config', async () => {
    const api = setup();
    await waitFor(() => expect(calls(api, '/api/config/report-page-titles')).toBe(1), W);

    await act(async () => { fireEvent.click(tab('Labels')); });
    await waitFor(() => expect(calls(api, '/api/config/report-labels/current')).toBe(1), W);
    expect(await screen.findByRole('heading', { name: 'Audit Trail', level: 2 }, W)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByDisplayValue('Audit Log')).toBeInTheDocument(), W);
    expect(screen.queryByDisplayValue('Acme Pharma')).toBeNull();
    expect(tab('Labels').className).toContain('bg-white');

    await act(async () => { fireEvent.click(tab('Signatories')); });
    await waitFor(() => expect(calls(api, '/api/config/report-signatories')).toBe(1), W);
    expect(await screen.findByText(/choose the signature label/, undefined, W)).toBeInTheDocument();
    expect(await screen.findByText('Quality Assurance', undefined, W)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Audit Trail', level: 2 })).toBeNull();

    await act(async () => { fireEvent.click(tab('Export')); });
    await waitFor(() => expect(calls(api, '/api/config/export-options')).toBe(1), W);
    expect(await screen.findByText(/Choose which export formats each role can use/, undefined, W)).toBeInTheDocument();
    expect(screen.queryByText(/choose the signature label/)).toBeNull();

    await act(async () => { fireEvent.click(tab('Identity')); });
    expect(await screen.findByText(/Company & application name shown in the header/, undefined, W)).toBeInTheDocument();
    expect(api.unmatched).toEqual([]);
  });
});
