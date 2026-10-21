import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { ConfigIndexPage } from '../index';
import { SUPER_ADMIN, commonRoutes, resetEnv } from './config-test-helpers';

// Multi-request flows: the 5s / 1s defaults are too tight when the suite runs
// under coverage alongside other workers.
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 5_000 });

afterEach(resetEnv);

const MANIFEST = [
  // Rendered in "Additional Modules" (SUPER_ADMIN only):
  { moduleKey: 'export-limit', moduleName: 'Export Limit', description: 'Max export rows', icon: '', category: 'data', sortOrder: 1, requiredRole: null, hasCustomPage: false, customPagePath: null, settings: [{}, {}] },
  { moduleKey: 'odd-module', moduleName: 'Odd Module', description: 'Has its own path', icon: '', category: 'data', sortOrder: 2, requiredRole: null, hasCustomPage: false, customPagePath: '/somewhere/odd', settings: [] },
  // Never rendered there: a custom page, a hardcoded card, a Role-Assignments key, a Filter-Setup key.
  { moduleKey: 'branding', moduleName: 'Branding Def', description: '', icon: '', category: 'ui', sortOrder: 3, requiredRole: null, hasCustomPage: true, customPagePath: '/config/branding', settings: [] },
  { moduleKey: 'user-id', moduleName: 'User ID Def', description: '', icon: '', category: 'ui', sortOrder: 4, requiredRole: null, hasCustomPage: false, customPagePath: null, settings: [] },
  { moduleKey: 'ahu-completion-process', moduleName: 'AHU Def', description: '', icon: '', category: 'ops', sortOrder: 5, requiredRole: null, hasCustomPage: false, customPagePath: null, settings: [] },
  { moduleKey: 'pm-schedule-approval', moduleName: 'PM Approval Def', description: '', icon: '', category: 'ops', sortOrder: 6, requiredRole: null, hasCustomPage: false, customPagePath: null, settings: [] },
  { moduleKey: 'filter-cleaning-reasons', moduleName: 'Reasons Def', description: '', icon: '', category: 'ops', sortOrder: 7, requiredRole: null, hasCustomPage: false, customPagePath: null, settings: [] },
];

function setup(opts: { user?: any; matrix?: unknown; mode?: string; profiles?: unknown; manifest?: unknown; extra?: MockRoute[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: '/api/config/registry/manifest', body: opts.manifest ?? MANIFEST },
    { path: '/api/config/access-matrix', body: opts.matrix ?? {} },
    { path: '/api/config/ahu-completion-process/current', body: { mode: opts.mode ?? 'NONE' } },
    { path: '/api/filters/cleaning-profiles/without-final-checklist', body: opts.profiles ?? { profiles: [] } },
    { path: '/api/super-admin/api-lock', body: { enabled: true } },
    ...commonRoutes(),
  ]);
  renderPage(<ConfigIndexPage />, { user: opts.user ?? SUPER_ADMIN, api });
  return api;
}

const link = (title: string) => screen.getByRole('heading', { name: title }).closest('a') as HTMLAnchorElement;

describe('Config index (System Configuration)', () => {
  it('SUPER_ADMIN sees every general and Super Admin card, each linking to its page', async () => {
    const api = setup();
    expect(screen.getByRole('heading', { name: 'System Configuration' })).toBeInTheDocument();
    await screen.findByRole('heading', { name: /Super Admin Settings/ });
    expect(link('General & Password Settings')).toHaveAttribute('href', '/config/password-policy');
    expect(link('Backup & Restore')).toHaveAttribute('href', '/config/backup');
    expect(link('User ID Format')).toHaveAttribute('href', '/config/user-id');
    for (const [title, href] of [
      ['Role Assignments', '/config/role-assignments'], ['Date/Time Format', '/config/datetime'],
      ['Configuration Access', '/config/access-matrix'], ['Tablet App Access', '/config/tablet-access'],
      ['Filter Data Management', '/config/filter-data-management'],
      ['AHU Cleaning Completion Process', '/config/dynamic/ahu-completion-process'],
      ['Offline Cache & Lockout', '/config/offline-cache'],
    ] as const) expect(link(title)).toHaveAttribute('href', href);
    // Re-auth badges: General & Password (general) and Date/Time (Super Admin) only.
    expect(within(link('General & Password Settings')).getByText('Re-auth')).toBeInTheDocument();
    expect(within(link('Date/Time Format')).getByText('Re-auth')).toBeInTheDocument();
    expect(within(link('Backup & Restore')).queryByText('Re-auth')).toBeNull();
    expect(within(link('Role Assignments')).queryByText('Re-auth')).toBeNull();
    // The Super Admin API kill-switch card is part of the section.
    expect(await screen.findByRole('heading', { name: 'Super Admin API Access' })).toBeInTheDocument();
    // Mode NONE: the unenforceable-profiles feed is never asked for.
    expect(api.calls('GET', '/api/filters/cleaning-profiles/without-final-checklist')).toHaveLength(0);
    expect(api.unmatched).toEqual([]);
  });

  it('auto-discovered modules appear only when they have no page of their own elsewhere', async () => {
    setup();
    const section = (await screen.findByRole('heading', { name: 'Additional Modules' })).closest('section') as HTMLElement;
    const exportLink = within(section).getByRole('heading', { name: 'Export Limit' }).closest('a')!;
    expect(exportLink).toHaveAttribute('href', '/config/dynamic/export-limit');
    expect(within(exportLink).getByText('2 settings')).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: 'Odd Module' }).closest('a')).toHaveAttribute('href', '/somewhere/odd');
    for (const hidden of ['Branding Def', 'User ID Def', 'AHU Def', 'PM Approval Def', 'Reasons Def']) {
      expect(within(section).queryByText(hidden)).toBeNull();
    }
  });

  it('no Additional Modules section when nothing is left to show', async () => {
    setup({ manifest: [MANIFEST[2]] });
    await screen.findByRole('heading', { name: /Super Admin Settings/ });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Additional Modules' })).toBeNull());
  });

  it('with AHU Interlock on, warns SUPER_ADMIN about profiles that cannot be enforced', async () => {
    const api = setup({ mode: 'INTERLOCK', profiles: { profiles: [{ id: 'p1', name: 'DRY STORAGE' }, { id: 'p2', name: 'WET' }] } });
    expect(await screen.findByText('AHU Interlock — Unenforceable Profiles')).toBeInTheDocument();
    expect(screen.getByText('DRY STORAGE, WET')).toBeInTheDocument();
    expect(api.calls('GET', '/api/filters/cleaning-profiles/without-final-checklist')).toHaveLength(1);
  });

  it('with AHU Popup mode but every profile enforceable, shows no warning', async () => {
    const api = setup({ mode: 'POPUP', profiles: { profiles: [] } });
    await waitFor(() => expect(api.calls('GET', '/api/filters/cleaning-profiles/without-final-checklist')).toHaveLength(1));
    expect(screen.queryByText('AHU Interlock — Unenforceable Profiles')).toBeNull();
  });

  it('a non-admin sees only the general cards granted to their role, and no Super Admin section', async () => {
    const api = setup({
      user: { role: 'ADMIN', permissions: ['CONFIG_READ'] },
      matrix: { backup: ['ADMIN'], 'user-id': ['QA'], 'export-limit': ['ADMIN'] },
      mode: 'INTERLOCK',
      profiles: { profiles: [{ id: 'p1', name: 'X' }] },
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Backup & Restore' })).toBeInTheDocument());
    // Default-deny: no matrix entry (password-policy) or another role's entry (user-id) -> hidden.
    expect(screen.queryByRole('heading', { name: 'General & Password Settings' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'User ID Format' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Super Admin Settings/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Role Assignments' })).toBeNull();
    // Additional Modules are SUPER_ADMIN only even when granted.
    expect(screen.queryByRole('heading', { name: 'Additional Modules' })).toBeNull();
    // The interlock warning and its feed are SUPER_ADMIN only too.
    expect(screen.queryByText('AHU Interlock — Unenforceable Profiles')).toBeNull();
    expect(api.calls('GET', '/api/filters/cleaning-profiles/without-final-checklist')).toHaveLength(0);
    expect(api.calls('GET', '/api/super-admin/api-lock')).toHaveLength(0);
  });

  it('a non-admin with no grants sees no cards at all (but still the compliance banner)', async () => {
    setup({ user: { role: 'OPERATOR', permissions: [] }, matrix: {} });
    expect(screen.getByText('21 CFR Part 11 Compliance')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByRole('link')).toHaveLength(0));
  });
});
