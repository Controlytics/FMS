import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecentSubmissions, type RecentSubmission } from '../use-recent-submissions';

const sub = (n: number): RecentSubmission => ({ stage: 'Wash In', filter: `FLT-${n}`, block: 'Block A', time: `10:0${n}` });

describe('useRecentSubmissions', () => {
  it('starts empty and puts the newest submission first', () => {
    const { result } = renderHook(() => useRecentSubmissions());
    expect(result.current.recentSubmissions).toEqual([]);
    act(() => result.current.record(sub(1)));
    act(() => result.current.record(sub(2)));
    expect(result.current.recentSubmissions.map((s) => s.filter)).toEqual(['FLT-2', 'FLT-1']);
  });

  it('a batch keeps its own order, ahead of older entries', () => {
    const { result } = renderHook(() => useRecentSubmissions());
    act(() => result.current.record(sub(1)));
    act(() => result.current.record([sub(2), sub(3)]));
    expect(result.current.recentSubmissions.map((s) => s.filter)).toEqual(['FLT-2', 'FLT-3', 'FLT-1']);
  });

  it('caps the list at 10 by default and at the given size otherwise', () => {
    const { result } = renderHook(() => useRecentSubmissions());
    act(() => result.current.record(Array.from({ length: 12 }, (_, i) => sub(i))));
    expect(result.current.recentSubmissions).toHaveLength(10);
    expect(result.current.recentSubmissions[0].filter).toBe('FLT-0');
    const small = renderHook(() => useRecentSubmissions(2));
    act(() => small.result.current.record([sub(1), sub(2), sub(3)]));
    expect(small.result.current.recentSubmissions.map((s) => s.filter)).toEqual(['FLT-1', 'FLT-2']);
  });

  it('an empty batch changes nothing (same array instance)', () => {
    const { result } = renderHook(() => useRecentSubmissions());
    act(() => result.current.record(sub(1)));
    const before = result.current.recentSubmissions;
    act(() => result.current.record([]));
    expect(result.current.recentSubmissions).toBe(before);
  });
});
