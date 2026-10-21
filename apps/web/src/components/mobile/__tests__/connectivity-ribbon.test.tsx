import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

/**
 * ConnectivityRibbon — the always-visible status strip on the tablet shell.
 *
 * Boundary: the sync-engine's event stream (`onSyncEvent`). It is replaced by
 * a tiny emitter so a test can push each event type the real engine emits
 * (start / stage / complete / error / interrupted / needs-reauth) and read
 * the ribbon's role="status" text. Nothing else is mocked.
 */
const bus = vi.hoisted(() => ({
  listeners: new Set<(e: any) => void>(),
}));
vi.mock('@/lib/sync-engine', () => ({
  onSyncEvent: (cb: (e: any) => void) => { bus.listeners.add(cb); return () => { bus.listeners.delete(cb); }; },
}));

import { ConnectivityRibbon } from '../connectivity-ribbon';

const emit = (e: any) => act(() => { for (const l of [...bus.listeners]) l(e); });
const ribbon = () => screen.getByRole('status');

let errSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  bus.listeners.clear();
  errSpy = vi.spyOn(console, 'error');
  warnSpy = vi.spyOn(console, 'warn');
});
afterEach(() => {
  expect(errSpy).not.toHaveBeenCalled();
  expect(warnSpy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe('ConnectivityRibbon — colour states', () => {
  it('online, nothing pending → green "Online", polite live region', () => {
    render(<ConnectivityRibbon online pendingCount={0} syncing={false} />);
    expect(ribbon()).toHaveTextContent(/^Online$/);
    expect(ribbon()).toHaveAttribute('aria-live', 'polite');
    expect(ribbon().className).toContain('bg-emerald-500');
  });

  it('online with pending work shows the count', () => {
    render(<ConnectivityRibbon online pendingCount={3} syncing={false} />);
    expect(ribbon()).toHaveTextContent('Online — 3 pending');
  });

  it.each([
    [0, 'Offline', null],
    [1, 'Offline', '— 1 operation queued'],
    [4, 'Offline', '— 4 operations queued'],
  ])('offline with %i queued → red', (n, label, sub) => {
    render(<ConnectivityRibbon online={false} pendingCount={n} syncing={false} />);
    expect(ribbon()).toHaveTextContent(label);
    expect(ribbon().className).toContain('bg-red-500');
    if (sub) expect(ribbon()).toHaveTextContent(sub);
    else expect(ribbon().textContent).toBe('Offline');
  });

  it('syncing with no stage yet → orange generic "Syncing…"', () => {
    render(<ConnectivityRibbon online pendingCount={2} syncing />);
    expect(ribbon()).toHaveTextContent(/^Syncing…$/);
    expect(ribbon().className).toContain('bg-amber-500');
  });
});

describe('ConnectivityRibbon — sync-engine stage labels', () => {
  it.each([
    [{ stage: 'token-refresh' }, 'Connecting…'],
    [{ stage: 'tombstone-drain' }, 'Sending deletions…'],
    [{ stage: 'sending-ops', current: 2, total: 5, message: 'F-001' }, 'Syncing operation 2/5…— F-001'],
    [{ stage: 'sending-ops', total: 0 }, 'Syncing operations…'],
    [{ stage: 'sending-ops' }, 'Syncing operations…'],
    [{ stage: 'fetching-snapshot', message: 'profiles' }, 'Refreshing data…— profiles'],
  ])('stage %o → %s', (evt, text) => {
    render(<ConnectivityRibbon online pendingCount={0} syncing={false} />);
    emit({ type: 'stage', ...evt });
    expect(ribbon().textContent).toBe(text);
    expect(ribbon().className).toContain('bg-amber-500');
  });

  it('a stage while OFFLINE (and not syncing) still shows red — offline wins over a stale stage', () => {
    render(<ConnectivityRibbon online={false} pendingCount={1} syncing={false} />);
    emit({ type: 'stage', stage: 'sending-ops', current: 1, total: 1 });
    expect(ribbon()).toHaveTextContent('Offline');
  });

  it.each(['complete', 'start', 'error', 'interrupted'])('"%s" resets the stage to idle (green again)', (type) => {
    render(<ConnectivityRibbon online pendingCount={0} syncing={false} />);
    emit({ type: 'stage', stage: 'tombstone-drain' });
    expect(ribbon()).toHaveTextContent('Sending deletions…');
    emit({ type });
    expect(ribbon().textContent).toBe('Online');
  });

  it('progress events are ignored (no label change)', () => {
    render(<ConnectivityRibbon online pendingCount={0} syncing={false} />);
    emit({ type: 'stage', stage: 'token-refresh' });
    emit({ type: 'progress', synced: 1, total: 2 });
    expect(ribbon()).toHaveTextContent('Connecting…');
  });

  it('unsubscribes from the sync stream on unmount', () => {
    const { unmount } = render(<ConnectivityRibbon online pendingCount={0} syncing={false} />);
    expect(bus.listeners.size).toBe(1);
    unmount();
    expect(bus.listeners.size).toBe(0);
  });
});

describe('ConnectivityRibbon — needs-reauth is sticky', () => {
  it('purple "Re-login to sync" with the stuck count, surviving later idle/error events', () => {
    render(<ConnectivityRibbon online pendingCount={0} syncing={false} />);
    emit({ type: 'needs-reauth', pendingCount: 1, reason: 'missing' });
    expect(ribbon()).toHaveTextContent('Re-login to sync');
    expect(ribbon()).toHaveTextContent('1 operation stuck — log out and log back in to mint a fresh sync grant');
    expect(ribbon().className).toContain('bg-purple-600');

    emit({ type: 'stage', stage: 'idle' });
    emit({ type: 'error', error: 'x' });
    emit({ type: 'start' });
    expect(ribbon()).toHaveTextContent('Re-login to sync');
  });

  it('uses the larger of the live pending count and the event count, pluralised', () => {
    render(<ConnectivityRibbon online pendingCount={7} syncing={false} />);
    emit({ type: 'needs-reauth', pendingCount: 2, reason: 'rejected' });
    expect(ribbon()).toHaveTextContent('7 operations stuck');
  });

  it('wins over syncing and offline', () => {
    const { rerender } = render(<ConnectivityRibbon online={false} pendingCount={1} syncing />);
    emit({ type: 'needs-reauth', pendingCount: 1, reason: 'expired' });
    expect(ribbon()).toHaveTextContent('Re-login to sync');
    rerender(<ConnectivityRibbon online pendingCount={1} syncing />);
    expect(ribbon()).toHaveTextContent('Re-login to sync');
  });

  it('is cleared by the next successful drain ("complete")', () => {
    render(<ConnectivityRibbon online pendingCount={0} syncing={false} />);
    emit({ type: 'needs-reauth', pendingCount: 3, reason: 'missing' });
    emit({ type: 'complete', synced: 3, total: 3 });
    expect(ribbon().textContent).toBe('Online');
  });

  it('a needs-reauth with zero pending (both counts 0) is not shown', () => {
    render(<ConnectivityRibbon online pendingCount={0} syncing={false} />);
    emit({ type: 'needs-reauth', pendingCount: 0, reason: 'missing' });
    expect(ribbon().textContent).toBe('Online');
  });
});
