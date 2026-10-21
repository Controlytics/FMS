/**
 * The three tab-wrapper config pages (filter-setup, display-settings,
 * appearance): each composes independent editors; the tab bar decides which
 * one is mounted, and only the mounted one loads its config.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { mockApi, renderPage, type MockApi } from '@/test-utils/page-harness';
import { FilterSetupPage } from '../filter-setup';
import { DisplaySettingsPage } from '../display-settings';
import { AppearanceConfigPage } from '../appearance';
import { SUPER_ADMIN, commonRoutes, resetEnv } from './config-test-helpers';

vi.setConfig({ testTimeout: 30000 });
afterEach(resetEnv);

const W = { timeout: 5000 };
const tab = (label: string) => screen.getByRole('button', { name: label });
const gets = (api: MockApi, path: string) => api.calls('GET', path).length;
const activeTab = (label: string) => expect(tab(label).className).toContain('bg-white');

describe('Filter Setup wrapper', () => {
  function setup() {
    const api = mockApi([
      { path: '/api/config/cleaning-profile-assignment', body: { mode: 'BY_ENTITY', rules: [] } },
      { path: '/api/filter-cleaning-profiles', body: { data: [] } },
      { path: '/api/hierarchy/blocks', body: { data: [] } },
      { path: '/api/hierarchy/areas', body: { data: [] } },
      { path: '/api/hierarchy/ahus', body: { data: [] } },
      { path: '/api/hierarchy/filters', body: { data: [] } },
      { path: '/api/config/dynamic/filter-cleaning-reasons', body: { value: [] } },
      { path: '/api/config/dynamic/filter-field-options', body: { value: { ahuType: ['Process'], filterType: [], micronSize: [] } } },
      ...commonRoutes(),
    ]);
    renderPage(<FilterSetupPage />, { user: SUPER_ADMIN, api, route: '/config/filter-setup' });
    return api;
  }

  it('opens on Profile Assignment and switches to Cleaning Reasons and Field Options', async () => {
    const api = setup();
    expect(screen.getByRole('heading', { name: 'Filter Setup', level: 1 })).toBeInTheDocument();
    activeTab('Profile Assignment');
    expect(await screen.findByText('No assignment rules yet', undefined, W)).toBeInTheDocument();
    expect(gets(api, '/api/config/dynamic/filter-cleaning-reasons')).toBe(0);
    expect(gets(api, '/api/config/dynamic/filter-field-options')).toBe(0);

    await act(async () => { fireEvent.click(tab('Cleaning Reasons')); });
    activeTab('Cleaning Reasons');
    expect(await screen.findByText('Configure the reasons available when starting a cleaning cycle.', undefined, W)).toBeInTheDocument();
    await waitFor(() => expect(gets(api, '/api/config/dynamic/filter-cleaning-reasons')).toBe(1), W);
    expect(screen.queryByText('No assignment rules yet')).toBeNull();

    await act(async () => { fireEvent.click(tab('Field Options')); });
    activeTab('Field Options');
    expect(await screen.findByText('Configure the dropdown values shown on the single-filter add/edit screens.', undefined, W)).toBeInTheDocument();
    await waitFor(() => expect(gets(api, '/api/config/dynamic/filter-field-options')).toBe(1), W);
    expect(await screen.findByText('Process', undefined, W)).toBeInTheDocument();
    expect(screen.queryByText('Configure the reasons available when starting a cleaning cycle.')).toBeNull();
    expect(api.unmatched).toEqual([]);
  });
});

describe('Display Settings wrapper', () => {
  function setup() {
    const api = mockApi([
      { path: '/api/config/field-ids', body: [] },
      { path: '/api/config/audit-templates', body: {} },
      { path: '/api/config/pagination', body: { limit: 100, count: 3, options: [10, 25, 50] } },
      ...commonRoutes(),
    ]);
    renderPage(<DisplaySettingsPage />, { user: SUPER_ADMIN, api, route: '/config/display-settings' });
    return api;
  }

  it('opens on Field IDs and switches to Audit Text and Pagination', async () => {
    const api = setup();
    expect(screen.getByRole('heading', { name: 'Display Settings', level: 1 })).toBeInTheDocument();
    activeTab('Field IDs');
    expect(await screen.findByText('No fields found', undefined, W)).toBeInTheDocument();
    expect(gets(api, '/api/config/audit-templates')).toBe(0);
    expect(gets(api, '/api/config/pagination')).toBe(0);

    await act(async () => { fireEvent.click(tab('Audit Text')); });
    activeTab('Audit Text');
    expect(await screen.findByText('Customize how audit trail actions are described.', undefined, W)).toBeInTheDocument();
    await waitFor(() => expect(gets(api, '/api/config/audit-templates')).toBe(1), W);
    expect(screen.queryByText('No fields found')).toBeNull();

    await act(async () => { fireEvent.click(tab('Pagination')); });
    activeTab('Pagination');
    expect(await screen.findByText('Page Size Configuration', undefined, W)).toBeInTheDocument();
    await waitFor(() => expect(gets(api, '/api/config/pagination')).toBe(1), W);
    expect(screen.queryByText('Customize how audit trail actions are described.')).toBeNull();
    expect(api.unmatched).toEqual([]);
  });
});

describe('Branding & Dashboard wrapper', () => {
  function setup() {
    const api = mockApi([
      { path: '/api/roles/active', body: [{ id: 'r1', name: 'ADMIN', displayName: 'Administrator' }] },
      { path: '/api/config/dashboard-cards/current', body: {} },
      ...commonRoutes(),
    ]);
    renderPage(<AppearanceConfigPage />, { user: SUPER_ADMIN, api, route: '/config/appearance' });
    return api;
  }

  it('opens on Branding and switches to Dashboard Cards', async () => {
    const api = setup();
    expect(screen.getByRole('heading', { name: 'Branding & Dashboard', level: 1 })).toBeInTheDocument();
    activeTab('Branding');
    expect(await screen.findByRole('heading', { name: 'App Identity' }, W)).toBeInTheDocument();
    expect(gets(api, '/api/config/dashboard-cards/current')).toBe(0);

    await act(async () => { fireEvent.click(tab('Dashboard Cards')); });
    activeTab('Dashboard Cards');
    expect(await screen.findByText('Configure which cards are visible on the dashboard for each role.', undefined, W)).toBeInTheDocument();
    await waitFor(() => expect(gets(api, '/api/config/dashboard-cards/current')).toBe(1), W);
    expect(await screen.findByText('Administrator', undefined, W)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'App Identity' })).toBeNull();

    await act(async () => { fireEvent.click(tab('Branding')); });
    expect(await screen.findByRole('heading', { name: 'App Identity' }, W)).toBeInTheDocument();
    expect(api.unmatched).toEqual([]);
  });
});
