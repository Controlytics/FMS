import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { installFakeIndexedDB, openAppDb, type FakeIdb } from '@/routes/filter-management/hooks/__tests__/fake-indexeddb';

/**
 * FailedOpsPanel — the floating "couldn't sync" review panel.
 *
 * Real: offline-store on an in-memory IndexedDB (jsdom has none; the fake
 * replaces only the browser `indexedDB` global) — failed ops are seeded and
 * the panel's Retry/Dismiss results are read back from the store.
 * Mocked: `@/lib/sync-engine` (PROTECTED surface with its own suites) — the
 * test fires its events and observes the drain call; `@/lib/connectivity`
 * because offline-store consults it.
 */
const h = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
  sync: vi.fn(async () => ({ synced: 0, failed: 0 })),
}));
vi.mock('@/lib/sync-engine', () => ({
  onSyncEvent: (cb: () => void) => { h.listeners.add(cb); return () => { h.listeners.delete(cb); }; },
  syncPendingOperations: h.sync,
}));
vi.mock('@/lib/connectivity', () => ({ isOnline: () => true, onConnectivityChange: () => () => {} }));

import { FailedOpsPanel } from '../failed-ops-panel';
import { queueOperation, updateOperationStatus, getAllOperations } from '@/lib/offline-store';

async function failedOp(type: any, filterName: string, error?: string) {
  const id = await queueOperation({ type, filterId: `id-${filterName}`, filterName, payload: {}, userId: null, userName: null });
  await updateOperationStatus(id, 'failed', error);
  return id;
}

const banner = () => screen.queryByRole('button', { name: /couldn’t sync — tap to review/ });

let fake: FakeIdb;
let err: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  fake = installFakeIndexedDB();
  await openAppDb();
  h.listeners.clear();
  h.sync.mockClear();
  err = vi.spyOn(console, 'error');
  warn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  expect(err).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FailedOpsPanel', () => {
  it('renders nothing when no op has failed (pending ops do not count)', async () => {
    await queueOperation({ type: 'advance', filterId: 'f', filterName: 'F', payload: {}, userId: null, userName: null });
    const { container } = render(<FailedOpsPanel />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a pluralised banner; one failed op reads "1 operation"', async () => {
    await failedOp('advance', 'F-1', 'Stale tape');
    render(<FailedOpsPanel />);
    expect(await screen.findByRole('button', { name: '1 operation couldn’t sync — tap to review' })).toBeInTheDocument();
  });

  it('the review lists each op with its label (or raw type), filter name (or "Filter") and error', async () => {
    await failedOp('start-and-advance', 'F-1', 'Cycle already ended');
    await failedOp('advance-with-checklist', '', undefined);
    render(<FailedOpsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '2 operations couldn’t sync — tap to review' }));
    expect(screen.getByRole('heading', { name: 'Operations that couldn’t sync' })).toBeInTheDocument();
    expect(screen.getByText('F-1')).toBeInTheDocument();
    expect(screen.getByText('Start & submit')).toBeInTheDocument();
    expect(screen.getByText('Cycle already ended')).toBeInTheDocument();
    expect(screen.getByText('Filter')).toBeInTheDocument();
    expect(screen.getByText('advance-with-checklist')).toBeInTheDocument();
  });

  it('Retry one: resets that op to pending in the store, drains, and the panel disappears once nothing failed remains', async () => {
    const id = await failedOp('bypass', 'F-1', 'boom');
    render(<FailedOpsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /tap to review/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(banner()).toBeNull());
    expect(h.sync).toHaveBeenCalledTimes(1);
    const [op] = await getAllOperations();
    expect(op).toMatchObject({ id, status: 'pending' });
    expect(screen.queryByRole('heading', { name: 'Operations that couldn’t sync' })).toBeNull();
  });

  it('Dismiss one: deletes only that op', async () => {
    await failedOp('terminate', 'F-1', 'x');
    const keep = await failedOp('submit-checklist', 'F-2', 'y');
    render(<FailedOpsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /2 operations/ }));
    const row = screen.getByText('F-1').closest('div.px-5') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /1 operation couldn’t/ })).toBeInTheDocument());
    expect((await getAllOperations()).map((o) => o.id)).toEqual([keep]);
    expect(h.sync).not.toHaveBeenCalled();
  });

  it('Retry all resets every failed op and drains once; shows "Working…" while busy', async () => {
    await failedOp('advance', 'F-1', 'a');
    await failedOp('start-cycle', 'F-2', 'b');
    let release!: () => void;
    h.sync.mockImplementationOnce(() => new Promise((r) => { release = () => r({ synced: 0, failed: 0 }); }));
    render(<FailedOpsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /2 operations/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry all' }));
    expect(await screen.findByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dismiss all' })).toBeDisabled();
    await waitFor(() => expect(h.sync).toHaveBeenCalledTimes(1));
    await act(async () => { release(); });
    await waitFor(() => expect(banner()).toBeNull());
    expect((await getAllOperations()).every((o) => o.status === 'pending')).toBe(true);
  });

  it('Dismiss all empties the failed ops from the store', async () => {
    await failedOp('advance', 'F-1', 'a');
    await failedOp('advance', 'F-2', 'b');
    render(<FailedOpsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /2 operations/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss all' }));
    await waitFor(() => expect(banner()).toBeNull());
    expect(await getAllOperations()).toEqual([]);
  });

  it('closes on the backdrop and on the header close button, but not on a click inside the card', async () => {
    await failedOp('advance', 'F-1', 'a');
    render(<FailedOpsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /tap to review/ }));
    const heading = screen.getByRole('heading', { name: 'Operations that couldn’t sync' });
    fireEvent.click(heading);
    expect(screen.getByRole('heading', { name: 'Operations that couldn’t sync' })).toBeInTheDocument();
    // backdrop = the fixed overlay wrapping the card
    fireEvent.click(heading.closest('.fixed') as HTMLElement);
    expect(screen.queryByRole('heading', { name: 'Operations that couldn’t sync' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /tap to review/ }));
    // The close (X) button has no accessible name — found structurally (finding recorded).
    const header = screen.getByRole('heading', { name: 'Operations that couldn’t sync' }).parentElement!.parentElement!;
    fireEvent.click(within(header).getByRole('button'));
    expect(screen.queryByRole('heading', { name: 'Operations that couldn’t sync' })).toBeNull();
  });

  it('re-reads the queue on every sync event', async () => {
    render(<FailedOpsPanel />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(banner()).toBeNull();

    await failedOp('advance', 'F-1', 'a');
    await act(async () => { for (const l of h.listeners) l(); });
    expect(await screen.findByRole('button', { name: /1 operation/ })).toBeInTheDocument();
  });

  it('polls every 8 s for failures that arrive without a sync event', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    render(<FailedOpsPanel />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    await failedOp('advance', 'F-9', 'late');
    await act(async () => { vi.advanceTimersByTime(8000); await new Promise((r) => setTimeout(r, 20)); });
    expect(await screen.findByRole('button', { name: /1 operation/ })).toBeInTheDocument();
  });

  it('an IndexedDB read failure is non-fatal (renders nothing, no crash)', async () => {
    fake.dbs.get('digilog-offline')!.stores.delete('operations');
    const { container } = render(<FailedOpsPanel />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(container).toBeEmptyDOMElement();
  });

  it('unmount unsubscribes from sync events', async () => {
    const { unmount } = render(<FailedOpsPanel />);
    expect(h.listeners.size).toBe(1);
    unmount();
    expect(h.listeners.size).toBe(0);
  });
});
