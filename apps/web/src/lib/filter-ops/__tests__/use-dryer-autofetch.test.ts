import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * DRY_IN instrument auto-fetch (2026-08-10).
 *
 * The bug this covers: auto-fetch worked at WASH_IN but never at DRY_IN,
 * because the dryer temperature is collected in the "Currently Drying" panel —
 * NOT the equipment dialog that owned the only `/fetch-readings` caller. These
 * tests pin the enable rule and the fetch/apply contract of the shared hook
 * both panels now use.
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
  const hook = renderHook(() =>
    useDryerAutoFetch({ filterId: 'f1', group: GROUP, dryerInstrument: TEMP, online: true, onValue, ...over }),
  );
  return { hook, onValue };
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
    // Old EquipmentGroupVersion snapshots (pre-2026-06-13) have no such key. A
    // truthy check would show a Get Values button that can never resolve a
    // responseKey; `=== true` degrades to the manual dropdown instead.
    const legacy = { id: 'i', stageKey: 'DRY_IN', description: 'Dryer Temperature' };
    expect(setup({ dryerInstrument: legacy }).hook.result.current.isAuto).toBe(false);
  });

  it('is OFF when no dryer instrument resolved', () => {
    expect(setup({ dryerInstrument: null }).hook.result.current.isAuto).toBe(false);
  });
});

describe('useDryerAutoFetch — getValues', () => {
  it('posts DRY_IN to /fetch-readings and applies the temperature', async () => {
    (apiClient.post as any).mockResolvedValue({
      stageKey: 'DRY_IN',
      results: [{ instrumentId: 'i-temp', ok: true, value: 69.62 }],
    });
    const { hook, onValue } = setup();
    await act(async () => { await hook.result.current.getValues(); });

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/equipment-groups/fetch-readings',
      { filterId: 'f1', groupId: 'g1', stageKey: 'DRY_IN' },
    );
    expect(onValue).toHaveBeenCalledWith(69.62);
    await waitFor(() => expect(hook.result.current.source).toBe('AUTO'));
  });

  it('keeps EVERY auto instrument value, not just the temperature one', async () => {
    // Submit writes a reading per DRY_IN instrument; siblings whose value is
    // dropped here get recorded as `operatingMin` — a fabricated measurement.
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

  it('flips AUTO → AUTO_OVERRIDDEN when the operator edits, and never back', async () => {
    (apiClient.post as any).mockResolvedValue({ results: [{ instrumentId: 'i-temp', ok: true, value: 70 }] });
    const { hook } = setup();
    await act(async () => { await hook.result.current.getValues(); });
    await waitFor(() => expect(hook.result.current.source).toBe('AUTO'));
    act(() => { hook.result.current.markEdited(); });
    await waitFor(() => expect(hook.result.current.source).toBe('AUTO_OVERRIDDEN'));
    act(() => { hook.result.current.markEdited(); });
    expect(hook.result.current.source).toBe('AUTO_OVERRIDDEN');
  });

  it('does not call the endpoint at all when auto-fetch is off', async () => {
    const { hook, onValue } = setup({ online: false });
    await act(async () => { await hook.result.current.getValues(); });
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(onValue).not.toHaveBeenCalled();
  });
});
