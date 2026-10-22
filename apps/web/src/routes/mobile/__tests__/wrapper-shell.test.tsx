/**
 * Tablet shell (MobileWrapperPage) — header, access gating, sync chips, the
 * queue badges, notifications, bottom navigation and the Android back button.
 *
 * Real: the page, useAuth / useOffline / useReauth / SWR / apiClient, and
 * lib/offline-store on an in-memory IndexedDB. Faked at their boundary (see
 * support/fakes.ts): connectivity, the sync engine, the sync-since poller, the
 * open-time master-data download and the Capacitor back button. The operations
 * page and the web Stage Approvals page are stubbed to a marker — each has its
 * own suite; here only what the shell hands them matters.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { useMobileLifecycle, flush, seedOps, seedCache, currentPath, OPERATOR, SA, queuedOps } from './support/mobile-kit';
import { renderWrapper } from './support/wrapper-harness';
import { setOnline, emitSync, syncPendingOperations, syncAll, back, triggerSync } from './support/fakes';
import { tabletAccessCacheKey } from '../use-tablet-access';
import { adoptServer } from '@/lib/server-discovery';

vi.mock('@/lib/connectivity', async () => (await import('./support/fakes')).connectivityModule);
vi.mock('@/lib/sync-engine', async () => (await import('./support/fakes')).syncEngineModule);
vi.mock('@/lib/sync-since', async () => (await import('./support/fakes')).syncSinceModule);
vi.mock('@/lib/offline-sync-service', async (orig) => ({ ...(await orig() as any), syncAllDataForOffline: (await import('./support/fakes')).fakeSyncAllDataForOffline }));
vi.mock('@capacitor/app', async () => (await import('./support/fakes')).capacitorAppModule);
const ops = vi.hoisted(() => ({ ref: null as any }));
vi.mock('../mobile-operations', () => ({
  MobileOperationsPage: (p: any) => { ops.ref = p.overlayBackRef; return <div data-testid="ops">ops stage={p.initialStageKey} block={p.initialBlockId ?? '-'}</div>; },
}));
const stageApprovals = vi.hoisted(() => ({ ref: null as any }));
vi.mock('../../stage-approvals', () => ({
  StageApprovalsPage: ({ overlayBackRef }: any) => { stageApprovals.ref = overlayBackRef; return <div>Stage approvals web page</div>; },
}));

useMobileLifecycle();

const pressBack = async () => { await waitFor(() => expect(back.handler).toBeTypeOf('function')); await act(async () => { back.handler!(); }); };
const nav = () => screen.getByText('Home').closest('div')!;
const navButton = (label: string) => within(nav()).queryByRole('button', { name: new RegExp(label) });

describe('home + header', () => {
  it.each([
    [3, 'Working late'], [9, 'Good morning'], [14, 'Good afternoon'], [19, 'Good evening'], [22, 'Working late'],
  ])('greets by the hour (%i:00 → %s) and shows name, user ID, role and build tag', async (hour, greeting) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, hour, 15));
    renderWrapper();
    expect(await screen.findByText(greeting)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ravi' })).toBeInTheDocument();
    expect(screen.getByText(/· op1/)).toBeInTheDocument();
    expect(screen.getByText('OPERATOR')).toBeInTheDocument();
    expect(await screen.findByText('FMS Tablet v9.9 · 21 CFR Part 11')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Acme' })).toHaveAttribute('src', '/logo.jpg');
    await flush();
  });

  it('a user with only a user ID is greeted by it, once; an underscored role reads as words', async () => {
    renderWrapper({ user: { ...SA, fullName: undefined, username: 'superadmin' } });
    expect(await screen.findByRole('heading', { name: 'superadmin' })).toBeInTheDocument();
    expect(screen.queryByText(/· superadmin/)).toBeNull();
    expect(screen.getByText('SUPER ADMIN')).toBeInTheDocument();
    await flush();
  });

  it('scan station tiles open the operations page for that stage, with no block preselected', async () => {
    renderWrapper();
    fireEvent.click(await screen.findByRole('button', { name: /Dry In/ }));
    expect(await screen.findByTestId('ops')).toHaveTextContent('ops stage=DRY_IN block=-');
    // the bottom navigation is hidden on the operations view
    expect(screen.queryByText('My Tasks')).toBeNull();
    // the header back button returns home
    fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }));
    expect(await screen.findByText('Scan stations')).toBeInTheDocument();
    await flush();
  });
});

describe('sync chips', () => {
  it('"Data Synced" once the open-time sync finishes; the chip is not a button you can use', async () => {
    renderWrapper();
    const chip = await screen.findByRole('button', { name: /Data Synced/ });
    expect(chip).toBeDisabled();
    expect(syncAll.calls).toBeGreaterThan(0);
    await flush(150);
    expect(triggerSync).toHaveBeenCalledWith('mobile-app-start');
    await flush();
  });

  it('one app open downloads the master data ONCE (not once per render while the user loads)', async () => {
    renderWrapper();
    await screen.findByRole('button', { name: /Data Synced/ });
    await flush(300);
    expect(syncAll.calls).toBe(1);
    expect(triggerSync.mock.calls.filter((c) => c[0] === 'mobile-app-start')).toHaveLength(1);
  });

  it('while the sync runs the chip names the step', async () => {
    syncAll.progress = null;
    renderWrapper();
    expect(await screen.findByRole('button', { name: /filters/ })).toBeDisabled();
    await flush();
  });

  it('a step with no name reads "Syncing..."', async () => {
    syncAll.first = { current: 0, total: 1, done: false };
    syncAll.progress = null;
    renderWrapper();
    expect(await screen.findByRole('button', { name: /Syncing\.\.\./ })).toBeInTheDocument();
    await flush();
  });

  it('a partial sync is amber, counts the gaps and names them on tap', async () => {
    syncAll.progress = { step: 'Done', current: 9, total: 9, done: true, partialFailures: ['Identifiers', 'Equipment groups'] };
    renderWrapper();
    const chip = await screen.findByRole('button', { name: /Partial sync \(2\)/ });
    expect(chip).toBeEnabled();
    fireEvent.click(chip);
    expect(screen.getByText(/Some data could not be synced: Identifiers, Equipment groups\. You can still work/)).toBeInTheDocument();
    await flush();
  });

  it('no chip and an offline banner when offline; nothing is downloaded when the browser is offline too', async () => {
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')!;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    try {
      renderWrapper({ online: false });
      expect(await screen.findByText('Working offline — operations queued for sync')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Data Synced|Syncing/ })).toBeNull();
      expect(screen.getAllByText('Offline').length).toBeGreaterThan(0);
      await flush();
      expect(syncAll.calls).toBe(0);
    } finally {
      delete (navigator as any).onLine;
      Object.defineProperty(Navigator.prototype, 'onLine', desc);
    }
  });

  it('a completed operation sync re-downloads master data (only when something synced and online)', async () => {
    renderWrapper();
    await screen.findByRole('button', { name: /Data Synced/ });
    await flush(100);
    const before = syncAll.calls;
    await act(async () => { emitSync({ type: 'complete', synced: 0 }); });
    expect(syncAll.calls).toBe(before);
    await act(async () => { emitSync({ type: 'complete', synced: 2 }); });
    await waitFor(() => expect(syncAll.calls).toBe(before + 1));
    await flush();
  });

  it('coming back to the foreground re-downloads; going to the background does not', async () => {
    renderWrapper();
    await screen.findByRole('button', { name: /Data Synced/ });
    await flush(100);
    const before = syncAll.calls;
    const vis = vi.spyOn(document, 'visibilityState', 'get');
    vis.mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(syncAll.calls).toBe(before);
    vis.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(syncAll.calls).toBe(before + 1);
    await flush();
  });
});

describe('queued operations', () => {
  it('another operator\'s queued work is shown as held and explained, not submitted', async () => {
    await seedOps([
      { id: 'h1', userId: 'u-other', userName: 'Asha Patel' },
      { id: 'h2', userId: 'u-other', userName: 'Asha Patel' },
    ]);
    renderWrapper();
    fireEvent.click(await screen.findByRole('button', { name: '2 held' }));
    expect(screen.getByText(/2 operation\(s\) on this tablet were recorded by Asha Patel\. Only they can submit them/)).toBeInTheDocument();
    expect(screen.queryByText(/pending — sync/)).toBeNull();
    await flush();
  });

  it('held work with no recorded name says "another user"', async () => {
    await seedOps([{ id: 'h1', userId: 'u-other', userName: null }]);
    renderWrapper();
    fireEvent.click(await screen.findByRole('button', { name: '1 held' }));
    expect(screen.getByText(/recorded by another user/)).toBeInTheDocument();
    await flush();
  });

  it('pending work: Sync reports what synced and lists what did not', async () => {
    await seedOps([
      { id: 'p1', userId: 'u-op', type: 'advance', filterName: 'F-101', error: 'STALE_TAPE' },
      { id: 'p2', userId: 'u-op', type: 'start-cycle', filterName: 'F-102' },
    ]);
    syncPendingOperations.mockResolvedValueOnce({ synced: 1, failed: 1 });
    renderWrapper();
    fireEvent.click(await screen.findByRole('button', { name: '2 pending — sync' }));
    expect(await screen.findByText('✓ Synced 1 operation(s)')).toBeInTheDocument();
    expect(screen.getByText(/advance: F-101 — STALE_TAPE/)).toBeInTheDocument();
    expect(screen.getByText(/start-cycle: F-102 — pending/)).toBeInTheDocument();
    await flush();
  });

  it('a failed sync with nothing left to list falls back to "Sync failed"', async () => {
    await seedOps([{ id: 'p1', userId: 'u-op', status: 'synced' }, { id: 'p2', userId: 'u-op' }]);
    syncPendingOperations.mockImplementationOnce(async () => {
      const { clearAllOperations } = await import('@/lib/offline-store');
      await clearAllOperations();
      return { synced: 0, failed: 1 };
    });
    renderWrapper();
    fireEvent.click(await screen.findByRole('button', { name: '1 pending — sync' }));
    expect(await screen.findByText('Sync failed')).toBeInTheDocument();
    await flush();
  });

  it('while syncing the badge says so and cannot be pressed again', async () => {
    await seedOps([{ id: 'p1', userId: 'u-op' }]);
    renderWrapper();
    await screen.findByRole('button', { name: '1 pending — sync' });
    await act(async () => { emitSync({ type: 'start' }); });
    expect(screen.getByRole('button', { name: '⟳ Syncing...' })).toBeDisabled();
    await flush();
  });

  it('clearing the queue asks first; "no" keeps it, "yes" empties it', async () => {
    await seedOps([{ id: 'p1', userId: 'u-op' }]);
    renderWrapper();
    await screen.findByRole('button', { name: '1 pending — sync' });
    const clear = screen.getByRole('button', { name: '✕' });
    (window.confirm as any).mockReturnValueOnce(false);
    fireEvent.click(clear);
    expect(window.confirm).toHaveBeenCalledWith('Clear all pending operations? They will not be synced.');
    await flush();
    expect(queuedOps()).toHaveLength(1);
    fireEvent.click(clear);
    expect(await screen.findByText('✓ Queue cleared')).toBeInTheDocument();
    expect(queuedOps()).toHaveLength(0);
    await waitFor(() => expect(screen.queryByText(/pending — sync/)).toBeNull());
  });

  it('logging out with unsent work warns first; declining keeps the session', async () => {
    await seedOps([{ id: 'p1', userId: 'u-op' }]);
    const { api } = renderWrapper();
    await screen.findByRole('button', { name: '1 pending — sync' });
    (window.confirm as any).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    expect((window.confirm as any).mock.calls[0][0]).toMatch(/You have 1 cleaning operation\(s\) that have not reached the server yet/);
    await flush();
    expect(api.calls('POST', '/api/auth/logout')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await waitFor(() => expect(currentPath()).toBe('/m/login'));
    expect(api.calls('POST', '/api/auth/logout')).toHaveLength(1);
  });

  it('logging out with nothing queued does not ask', async () => {
    const { api } = renderWrapper();
    fireEvent.click(await screen.findByRole('button', { name: 'Logout' }));
    await waitFor(() => expect(currentPath()).toBe('/m/login'));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(api.calls('POST', '/api/auth/logout')).toHaveLength(1);
  });

  it('success and error banners clear themselves (4 s / 6 s)', async () => {
    await seedOps([{ id: 'h1', userId: 'u-other', userName: 'Asha' }, { id: 'p1', userId: 'u-op' }]);
    renderWrapper();
    fireEvent.click(await screen.findByRole('button', { name: '1 held' }));
    expect(screen.getByText(/recorded by Asha/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '✕' }));
    expect(await screen.findByText('✓ Queue cleared')).toBeInTheDocument();
    const shownAt = Date.now();
    await waitFor(() => expect(screen.queryByText('✓ Queue cleared')).toBeNull(), { timeout: 5000 });
    expect(Date.now() - shownAt).toBeGreaterThanOrEqual(3500);
    await waitFor(() => expect(screen.queryByText(/recorded by Asha/)).toBeNull(), { timeout: 3000 });
  }, 12_000);
});

describe('access gating', () => {
  it('no session at all → the tablet login', async () => {
    renderWrapper({ signedOut: true });
    await waitFor(() => expect(currentPath()).toBe('/m/login'));
  });

  it('a configured role without "login" is sent back to the login', async () => {
    renderWrapper({ tabletAccess: { configured: true, allowed: ['my_tasks'] } });
    await waitFor(() => expect(currentPath()).toBe('/m/login'));
  });

  it('a configured role with NO features sees why, and can log out', async () => {
    const { api } = renderWrapper({ user: { ...OPERATOR, role: 'QA' }, tabletAccess: { configured: true, allowed: [] } });
    expect(await screen.findByRole('heading', { name: 'Tablet not enabled for your role' })).toBeInTheDocument();
    expect(screen.getByText(/Your role \(QA\) has no tablet features assigned/)).toBeInTheDocument();
    // Once the answer is in, the shell underneath reads nothing more: no polls,
    // no master-data sync. (Reads sent BEFORE the answer arrived cannot be
    // helped without stalling every allowed operator on a slow link.)
    await flush(100);
    const reads = () => api.requests.filter((r) => r.method === 'GET' && !r.url.startsWith('/api/config/') && !r.url.startsWith('/api/auth/')).length;
    const before = reads();
    const syncsBefore = syncAll.calls;
    // Reconnecting re-reads everything (and re-runs the open-time sync) for an allowed role.
    // Offline in between, the list read online stays in force: the screen does not
    // give way to the shell while the stored copy is read back.
    await act(async () => { setOnline(false); });
    expect(screen.getByRole('heading', { name: 'Tablet not enabled for your role' })).toBeInTheDocument();
    await act(async () => { setOnline(true); });
    await flush(100);
    expect(reads()).toBe(before);
    expect(syncAll.calls).toBe(syncsBefore);
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(currentPath()).toBe('/m/login'));
    expect(api.calls('POST', '/api/auth/logout')).toHaveLength(1);
  });

  it('SUPER_ADMIN is never shown the "not enabled" screen (the server answers configured:false for SA)', async () => {
    renderWrapper({ user: SA, tabletAccess: { configured: true, allowed: [] } });
    expect(await screen.findByText('Filter Cleaning Record')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tablet not enabled for your role' })).toBeNull();
    await flush();
  });

  it('only allowed features appear; a disallowed RFID Assign tile cannot be opened', async () => {
    renderWrapper({ tabletAccess: { configured: true, allowed: ['login', 'filter_status'] } });
    expect(await screen.findByRole('button', { name: /Status/ })).toBeInTheDocument();
    expect(navButton('My Tasks')).toBeNull();
    expect(screen.queryByText('Scan stations')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull();
    expect(screen.queryByRole('button', { name: /RFID Assign/ })).toBeNull();
    // The greyed tile says why: the feature is off for this role (the tablet is online).
    expect(screen.getByText('RFID Assign').parentElement).toHaveTextContent('not enabled');
    expect(screen.getByText('RFID Assign').parentElement).not.toHaveTextContent('offline');
    // Going offline keeps the same list in force — never a moment where every feature is allowed.
    await act(async () => { setOnline(false); });
    expect(navButton('My Tasks')).toBeNull();
    expect(screen.queryByText('Scan stations')).toBeNull();
    await flush();
  });

  it('a view whose feature is withdrawn bounces back to Home', async () => {
    renderWrapper({ tabletAccess: { configured: true, allowed: ['login', 'filter_status', 'my_tasks'] } });
    fireEvent.click(await screen.findByRole('button', { name: /Status/ }));
    expect(await screen.findByRole('heading', { name: 'Filter Status' })).toBeInTheDocument();
    // The admin withdraws Filter Status; this user's cached list now lacks it.
    await waitFor(async () => expect((await import('@/lib/offline-store')).getCachedData(tabletAccessCacheKey('u-op'))).resolves.toBeTruthy());
    await seedCache({ [tabletAccessCacheKey('u-op')]: { configured: true, allowed: ['login', 'my_tasks'] } });
    await act(async () => { setOnline(false); });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Filter Status' })).toBeNull());
    expect(screen.getByText('Filter Cleaning Record')).toBeInTheDocument(); // back on Home
    expect(navButton('Status')).toBeNull();
    await flush();
  });
});

describe('notifications', () => {
  const N = [
    { id: 'n1', type: 'PM_OVERDUE', title: 'PM overdue — AHU-01', message: 'Visit window closed', isRead: false, createdAt: '2026-10-21T06:00:00.000Z' },
    { id: 'n2', type: 'PM_OVERDUE_COMPLETED', title: 'Overdue PM completed', message: 'AHU-03 done', isRead: true, createdAt: '2026-10-20T06:00:00.000Z' },
    { id: 'n3', type: 'GENERAL', title: 'Heads up', message: 'Shift change', isRead: false, createdAt: '2026-10-19T06:00:00.000Z' },
  ];

  it('the bell shows the unread count and opens the list; tapping an unread one marks it read', async () => {
    const { api } = renderWrapper({
      notifications: { data: N, unreadCount: 2 },
      routes: [
        { method: 'PUT', path: '/api/notifications/n1/read', body: {} },
        { method: 'PUT', path: '/api/notifications/mark-all-read', body: {} },
      ],
    });
    const bell = await screen.findByRole('button', { name: 'Notifications' });
    await waitFor(() => expect(bell).toHaveTextContent('2'));
    fireEvent.click(bell);
    expect(await screen.findByText('PM overdue — AHU-01')).toBeInTheDocument();
    expect(screen.getByText('Overdue PM completed')).toBeInTheDocument();
    expect(screen.getByText('Shift change')).toBeInTheDocument();
    fireEvent.click(screen.getByText('PM overdue — AHU-01'));
    await waitFor(() => expect(api.calls('PUT', '/api/notifications/n1/read')).toHaveLength(1));
    fireEvent.click(screen.getByText('Overdue PM completed')); // already read → no request
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(api.calls('PUT', '/api/notifications/mark-all-read')).toHaveLength(1));
    expect(api.calls('PUT', /\/api\/notifications\/n2\/read/)).toHaveLength(0);
    await flush();
  });

  it('more than 99 unread reads "99+"; a failed mark-read is ignored quietly', async () => {
    renderWrapper({
      notifications: { data: [N[0]], unreadCount: 140 },
      routes: [
        { method: 'PUT', path: '/api/notifications/n1/read', status: 500, body: { error: 'X', message: 'db down' } },
        { method: 'PUT', path: '/api/notifications/mark-all-read', status: 500, body: { error: 'X', message: 'db down' } },
      ],
    });
    const bell = await screen.findByRole('button', { name: 'Notifications' });
    await waitFor(() => expect(bell).toHaveTextContent('99+'));
    fireEvent.click(bell);
    fireEvent.click(await screen.findByText('PM overdue — AHU-01'));
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await flush(60);
    expect(screen.queryByText('db down')).toBeNull();
  });

  it('empty list, and offline', async () => {
    renderWrapper();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('No notifications')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
    await act(async () => { setOnline(false); });
    expect(await screen.findByText('Notifications need a connection.')).toBeInTheDocument();
    await flush();
  });
});

describe('bottom navigation + Stage Approvals', () => {
  it('Stage Approvals needs the feature AND a STAGE_APPROVAL permission; online it is the web page', async () => {
    renderWrapper({ user: { ...OPERATOR, permissions: [...OPERATOR.permissions!, 'STAGE_APPROVAL_VIEW'] } });
    fireEvent.click(await screen.findByRole('button', { name: /Stage Approvals/ }));
    expect(await screen.findByText('Stage approvals web page')).toBeInTheDocument();
    expect(stageApprovals.ref).toBeTruthy();
    await act(async () => { setOnline(false); });
    expect(await screen.findByText('Approvals need a connection')).toBeInTheDocument();
    await flush();
  });

  it('without the permission the tab is not offered', async () => {
    renderWrapper();
    await screen.findByText('Scan stations');
    expect(navButton('Stage Approvals')).toBeNull();
    expect(navButton('Status')).toBeInTheDocument();
    expect(navButton('My Tasks')).toBeInTheDocument();
    await flush();
  });

  it('Home is highlighted on Home, Status on Status', async () => {
    renderWrapper();
    await screen.findByText('Scan stations');
    expect(navButton('Home')!.className).toContain('text-cyan-600');
    fireEvent.click(navButton('Status')!);
    await screen.findByRole('heading', { name: 'Filter Status' });
    expect(navButton('Status')!.className).toContain('text-cyan-600');
    expect(navButton('Home')!.className).not.toContain('text-cyan-600');
    fireEvent.click(navButton('Home')!);
    expect(await screen.findByText('Scan stations')).toBeInTheDocument();
    await flush();
  });
});

describe('Android back button', () => {
  it('on Home it does nothing (never exits / logs out)', async () => {
    renderWrapper();
    await screen.findByText('Scan stations');
    await pressBack();
    expect(screen.getByText('Scan stations')).toBeInTheDocument();
    expect(currentPath()).toBe('/m');
    await flush();
  });

  it('from any other view it returns Home', async () => {
    renderWrapper();
    fireEvent.click(await screen.findByRole('button', { name: /Filter Cleaning Record/ }));
    expect(await screen.findByRole('heading', { name: 'Filter Cleaning Record' })).toBeInTheDocument();
    await pressBack();
    expect(await screen.findByText('Scan stations')).toBeInTheDocument();
    await flush();
  });

  it('on Stage Approvals it first lets the page close its own dialog', async () => {
    renderWrapper({ user: { ...OPERATOR, permissions: [...OPERATOR.permissions!, 'STAGE_APPROVAL_DECIDE'] } });
    fireEvent.click(await screen.findByRole('button', { name: /Stage Approvals/ }));
    await screen.findByText('Stage approvals web page');
    stageApprovals.ref.current = () => true; // a dialog was open and closed
    await pressBack();
    expect(screen.getByText('Stage approvals web page')).toBeInTheDocument();
    stageApprovals.ref.current = () => false; // nothing open
    await pressBack();
    expect(await screen.findByText('Scan stations')).toBeInTheDocument();
    await flush();
  });

  it('on a scan station it first lets the page close its own dialog (the Dry In checklist)', async () => {
    renderWrapper();
    fireEvent.click(await screen.findByRole('button', { name: /Dry In/ }));
    expect(await screen.findByTestId('ops')).toBeInTheDocument();
    expect(ops.ref).toBeTruthy();
    ops.ref.current = () => true; // a dialog was open and closed
    await pressBack();
    expect(screen.getByTestId('ops')).toBeInTheDocument();
    ops.ref.current = () => false; // nothing open
    await pressBack();
    expect(await screen.findByText('Scan stations')).toBeInTheDocument();
    await flush();
  });

  it('closes the Scan RFID lookup before leaving the view', async () => {
    renderWrapper();
    fireEvent.click(await screen.findByRole('button', { name: /Status/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Scan RFID/ }));
    expect(await screen.findByText('Look up filter by tag')).toBeInTheDocument();
    await pressBack();
    expect(screen.queryByText('Look up filter by tag')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Filter Status' })).toBeInTheDocument();
    await flush();
  });

  it('unmounting removes the native listener', async () => {
    const { unmount } = renderWrapper();
    await screen.findByText('Scan stations');
    await waitFor(() => expect(back.handler).toBeTypeOf('function'));
    unmount();
    expect(back.removed).toBe(1);
  });
});

describe('server moved (DHCP change)', () => {
  it('tells the operator the server address changed', async () => {
    renderWrapper();
    await screen.findByText('Scan stations');
    try {
      await act(async () => { adoptServer('https://10.0.0.9:3000'); });
      expect(await screen.findByText('Server address updated')).toBeInTheDocument();
      expect(screen.getByText('Connected to the FMS server at https://10.0.0.9:3000.')).toBeInTheDocument();
    } finally {
      delete (window as any).__API_BASE__;
    }
    await flush();
  });
});
