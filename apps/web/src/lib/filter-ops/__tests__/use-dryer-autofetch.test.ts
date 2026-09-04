import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * DRY_IN instrument auto-fetch (2026-08-10, reshaped 2026-09-04).
 *
 * The original bug: auto-fetch worked at WASH_IN but never at DRY_IN, because
 * the dryer temperature is collected in the "Currently Drying" panel — NOT the
 * equipment dialog that owned the only `/fetch-readings` caller.
 *
 * 2026-09-04 (operator request): the fetch fires ON ITS OWN when the dryer
 * reaches half time (no Get Values button), and a fetched value is editable —
 * editing flips the provenance to AUTO_OVERRIDDEN so the record shows both that
 * it was fetched and that it was changed.
 */
vi.mock('@/lib/api-client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn() },
}));

import { useDryerAutoFetch } from '../use-dryer-autofetch';
import { apiClient } from '@/lib/api-client';

const TEMP = { id: 'i-temp', stageKey: 'DRY_IN', description: 'Dryer Temperature', autoFetchEnabled: true, responseKey: 'temperature' };
const GROUP = { id: 'g1', instruments: [TEMP] };

function setup(over: Partial<Parameters<typeof useDryerAutoFetch>[0]> = {}) {
  const onValue = vi.fn();
  let props = { filterId: 'f1', group: GROUP, dryerInstrument: TEMP, online: true, onValue, ...over };
  const hook = renderHook((p: typeof props) => useDryerAutoFetch(p), { initialProps: props });
  return { hook, onValue, rerender: (o: Partial<typeof props>) => { props = { ...props, ...o }; hook.rerender(props); } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('useDryerAutoFetch — isAuto enable rule', () => {
  it('is on when the instrument opts in and the device is online', () => {
    expect(setup().hook.result.current.isAuto).toBe(true);
  });

  it('is OFF offline — the P5 decision is offline = manual dropdown', () => {
    expect(setup({ online: false }).hook.result.current.isAuto).toBe(false);
  });

  it('treats a MISSING autoFetchEnabled as OFF, not as opted-in', () => {
    const legacy = { id: 'i', stageKey: 'DRY_IN', description: 'Dryer Temperature' };
    expect(setup({ dryerInstrument: legacy }).hook.result.current.isAuto).toBe(false);
  });

  it('is OFF when no dryer instrument resolved', () => {
    expect(setup({ dryerInstrument: null }).hook.result.current.isAuto).toBe(false);
  });
});

describe('useDryerAutoFetch — automatic fetch at half time (2026-09-04)', () => {
  it('does NOT fetch before half time', async () => {
    (apiClient.post as any).mockResolvedValue({ results: [{ instrumentId: 'i-temp', ok: true, value: 70 }] });
    setup({ halfReached: false });
    await act(async () => { await Promise.resolve(); });
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('fetches on its own the moment halfReached flips true, and applies the value as AUTO', async () => {
    (apiClient.post as any).mockResolvedValue({ results: [{ instrumentId: 'i-temp', ok: true, value: 69.62 }] });
    const { hook, onValue, rerender } = setup({ halfReached: false });
    await act(async () => { rerender({ halfReached: true }); });
    await waitFor(() => expect(onValue).toHaveBeenCalledWith(69.62));
    expect(apiClient.post).toHaveBeenCalledWith('/api/equipment-groups/fetch-readings', { filterId: 'f1', groupId: 'g1', stageKey: 'DRY_IN' });
    await waitFor(() => expect(hook.result.current.source).toBe('AUTO'));
  });

  it('fires once per half-time crossing, not on every render', async () => {
    (apiClient.post as any).mockResolvedValue({ results: [{ instrumentId: 'i-temp', ok: true, value: 70 }] });
    const { hook, rerender } = setup({ halfReached: true });
    await waitFor(() => expect(hook.result.current.source).toBe('AUTO'));
    await act(async () => { rerender({ halfReached: true }); rerender({ halfReached: true }); });
    expect((apiClient.post as any).mock.calls.length).toBe(1);
  });

  it('stays passive when auto-fetch is off, even at half time', async () => {
    const { onValue } = setup({ online: false, halfReached: true });
    await act(async () => { await Promise.resolve(); });
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(onValue).not.toHaveBeenCalled();
  });
});

describe('useDryerAutoFetch — getValues (explicit re-read) + provenance', () => {
  it('keeps EVERY auto instrument value, not just the temperature one', async () => {
    (apiClient.post as any).mockResolvedValue({
      results: [
        { instrumentId: 'i-temp', ok: true, value: 70 },
        { instrumentId: 'i-other', ok: true, value: 12.5 },
      ],
    });
    const { hook } = setup();
    await act(async () => { await hook.result.current.getValues(); });
    await waitFor(() => expect(hook.result.current.fetched['i-other']).toBe(12.5));
  });

  it('a fetched value is EDITABLE; editing it flips the provenance to AUTO_OVERRIDDEN', async () => {
    // Reverses the 2026-08-10 read-only rule on the operator's explicit request
    // (2026-09-04): the record must show "fetched, then changed", not hide it.
    (apiClient.post as any).mockResolvedValue({ results: [{ instrumentId: 'i-temp', ok: true, value: 70 }] });
    const { hook } = setup();
    await act(async () => { await hook.result.current.getValues(); });
    await waitFor(() => expect(hook.result.current.source).toBe('AUTO'));
    expect(hook.result.current.locked).toBe(false);
    act(() => { hook.result.current.markEdited(); });
    expect(hook.result.current.source).toBe('AUTO_OVERRIDDEN');
  });

  it('editing BEFORE any fetch stays MANUAL', () => {
    const { hook } = setup();
    act(() => { hook.result.current.markEdited(); });
    expect(hook.result.current.source).toBe('MANUAL');
  });

  it('a failed fetch leaves the field manual (never dead-ends the operator)', async () => {
    (apiClient.post as any).mockResolvedValue({ results: [{ instrumentId: 'i-temp', ok: false, error: 'boom' }] });
    const { hook } = setup();
    const p = act(async () => { await hook.result.current.getValues(); });
    hook.unmount();
    await p;
    expect(hook.result.current.source).toBe('MANUAL');
    expect(hook.result.current.locked).toBe(false);
  });

  it('sets timedOut once the 1-minute budget is exhausted → panel shows the manual input', async () => {
    (apiClient.post as any).mockResolvedValue({ results: [] });
    const seq = [0, 61_000, 61_000];
    let i = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => seq[Math.min(i++, seq.length - 1)]);
    const { hook } = setup();
    await act(async () => { await hook.result.current.getValues(); });
    nowSpy.mockRestore();
    expect(hook.result.current.timedOut).toBe(true);
    expect(hook.result.current.source).toBe('MANUAL');
  });

  it('does not call the endpoint at all when auto-fetch is off', async () => {
    const { hook, onValue } = setup({ online: false });
    await act(async () => { await hook.result.current.getValues(); });
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(onValue).not.toHaveBeenCalled();
  });
});
