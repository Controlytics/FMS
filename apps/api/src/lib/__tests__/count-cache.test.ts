/**
 * createCountCache (P-3, 2026-10-22): a list's COUNT runs once per set of filters
 * and is reused until the TTL passes; another set of filters counts afresh.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createCountCache } from '../count-cache.js';

afterEach(() => { vi.useRealTimers(); });

describe('createCountCache', () => {
  it('reuses the count for the same filters until the TTL passes, then counts again', async () => {
    vi.useFakeTimers();
    const cached = createCountCache(60_000);
    const count = vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(11);
    expect(await cached({ status: 'X' }, count)).toBe(10);
    vi.advanceTimersByTime(59_000);
    expect(await cached({ status: 'X' }, count)).toBe(10);
    expect(count).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    expect(await cached({ status: 'X' }, count)).toBe(11);
    expect(count).toHaveBeenCalledTimes(2);
  });

  it('counts afresh for different filters (dates included in the key)', async () => {
    const cached = createCountCache(60_000);
    const count = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    expect(await cached(['events', {}], count)).toBe(1);
    expect(await cached(['events', { eventType: 'BYPASS_DEVIATION' }], count)).toBe(2);
    expect(await cached(['events', { performedAt: { gte: new Date('2026-10-01T00:00:00Z') } }], count)).toBe(3);
    expect(await cached(['events', {}], count)).toBe(1);
  });

  it('a full cache is emptied rather than growing without bound', async () => {
    const cached = createCountCache(60_000, 2);
    const count = vi.fn().mockResolvedValue(5);
    await cached('a', count); await cached('b', count); await cached('c', count);
    await cached('a', count);
    expect(count).toHaveBeenCalledTimes(4);
  });
});
