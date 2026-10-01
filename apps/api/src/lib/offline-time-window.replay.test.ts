/**
 * 2026-09-25 — closes two items the 2026-09-24 strict audit left open:
 *   - design gap: the replay grant header did not prove the call was a replay
 *     (assertOfflineReplayPayload — a grant-bearing request must carry both
 *     offlinePerformedAt and clientOpId);
 *   - C-F10: per-event floor (previousEventAt) with clock-drift tolerance.
 */
import { describe, it, expect } from 'vitest';
import {
  validateOfflinePerformedAt,
  assertOfflineReplayPayload,
  latestEventAt,
  OfflineTimeError,
} from './offline-time-window.js';

const NOW = new Date('2026-09-25T12:00:00.000Z');

describe('assertOfflineReplayPayload — grant header must look like a replay', () => {
  it('is a no-op online (no grant)', () => {
    expect(() => assertOfflineReplayPayload(false, {})).not.toThrow();
  });
  it('passes a genuine replay (both fields present)', () => {
    expect(() => assertOfflineReplayPayload(true, { offlinePerformedAt: '2026-09-25T11:00:00.000Z', clientOpId: 'op-1' })).not.toThrow();
  });
  it('refuses a grant-bearing request with neither field', () => {
    try {
      assertOfflineReplayPayload(true, {});
      throw new Error('did not throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(OfflineTimeError);
      expect(e.code).toBe('OFFLINE_REPLAY_FIELDS_REQUIRED');
      expect(e.details.missing).toEqual(['offlinePerformedAt', 'clientOpId']);
    }
  });
  it('names the one field that is missing', () => {
    try {
      assertOfflineReplayPayload(true, { clientOpId: 'op-1' });
      throw new Error('did not throw');
    } catch (e: any) {
      expect(e.details.missing).toEqual(['offlinePerformedAt']);
    }
    try {
      assertOfflineReplayPayload(true, { offlinePerformedAt: '2026-09-25T11:00:00.000Z', clientOpId: '   ' });
      throw new Error('did not throw');
    } catch (e: any) {
      expect(e.details.missing).toEqual(['clientOpId']);
    }
  });
});

describe('validateOfflinePerformedAt — per-event floor (C-F10)', () => {
  const prev = new Date('2026-09-25T11:30:00.000Z');

  it('accepts a time after the previous event', () => {
    const t = validateOfflinePerformedAt('2026-09-25T11:31:00.000Z', { isReplay: true, now: NOW, previousEventAt: prev });
    expect(t?.toISOString()).toBe('2026-09-25T11:31:00.000Z');
  });
  it('accepts the same instant as the previous event', () => {
    expect(validateOfflinePerformedAt(prev.toISOString(), { isReplay: true, now: NOW, previousEventAt: prev })).toBeInstanceOf(Date);
  });
  it('accepts up to 5 minutes BEFORE the previous event (server-clock vs tablet-clock drift)', () => {
    expect(validateOfflinePerformedAt('2026-09-25T11:25:30.000Z', { isReplay: true, now: NOW, previousEventAt: prev })).toBeInstanceOf(Date);
  });
  it('rejects more than 5 minutes before the previous event', () => {
    try {
      validateOfflinePerformedAt('2026-09-25T11:24:00.000Z', { isReplay: true, now: NOW, previousEventAt: prev });
      throw new Error('did not throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(OfflineTimeError);
      expect(e.code).toBe('OFFLINE_TIME_BEFORE_PREVIOUS_EVENT');
      expect(e.details.previousEventAt).toBe(prev.toISOString());
    }
  });
  it('accepts an ISO string for previousEventAt and ignores an unparsable one', () => {
    expect(validateOfflinePerformedAt('2026-09-25T11:31:00.000Z', { isReplay: true, now: NOW, previousEventAt: prev.toISOString() })).toBeInstanceOf(Date);
    expect(validateOfflinePerformedAt('2026-09-25T11:00:00.000Z', { isReplay: true, now: NOW, previousEventAt: 'not-a-date' })).toBeInstanceOf(Date);
  });
  it('still ignores the client time online', () => {
    expect(validateOfflinePerformedAt('2026-09-25T11:00:00.000Z', { isReplay: false, now: NOW, previousEventAt: prev })).toBeUndefined();
  });
});

describe('latestEventAt', () => {
  it('returns null for no events', () => {
    expect(latestEventAt([])).toBeNull();
  });
  it('returns the max performedAt regardless of order, tolerating strings and bad values', () => {
    const at = latestEventAt([
      { performedAt: '2026-09-25T10:00:00.000Z' },
      { performedAt: new Date('2026-09-25T11:00:00.000Z') },
      { performedAt: 'garbage' },
      { performedAt: '2026-09-25T10:30:00.000Z' },
    ]);
    expect(at?.toISOString()).toBe('2026-09-25T11:00:00.000Z');
  });
});
