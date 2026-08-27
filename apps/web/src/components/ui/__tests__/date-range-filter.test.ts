import { describe, it, expect } from 'vitest';
import { checkRangeEdge } from '../date-range-filter';

/**
 * The ordering rule behind every From/To range in the app (11 of them across 10
 * files). `checkRangeEdge` returns null when a change is allowed, or the hint to
 * show when it is not — the component and the Audit Trail's bespoke From/To
 * cards both call it, so the two can never drift apart.
 */
describe('checkRangeEdge', () => {
  it('allows a normal forward range', () => {
    expect(checkRangeEdge('from', '2026-01-01', '2026-01-31')).toBeNull();
    expect(checkRangeEdge('to', '2026-01-31', '2026-01-01')).toBeNull();
  });

  it('rejects a From after the To', () => {
    const hint = checkRangeEdge('from', '2026-02-01', '2026-01-31');
    expect(hint).toBeTruthy();
    expect(hint).toContain("can't be after");
  });

  it('rejects a To before the From', () => {
    const hint = checkRangeEdge('to', '2026-01-01', '2026-01-31');
    expect(hint).toBeTruthy();
    expect(hint).toContain("can't be before");
  });

  it('keeps same-day ranges legal', () => {
    // The whole point of comparing with > / < rather than >= : picking the same
    // day at both ends is an ordinary single-day filter, not an error. Three
    // screens (my-tasks, deviations, quality-notifications) rely on it.
    expect(checkRangeEdge('from', '2026-01-15', '2026-01-15')).toBeNull();
    expect(checkRangeEdge('to', '2026-01-15', '2026-01-15')).toBeNull();
  });

  it('allows an open-ended range at either end', () => {
    // Clearing one end must never be blocked.
    expect(checkRangeEdge('from', '2026-01-01', '')).toBeNull();
    expect(checkRangeEdge('to', '2026-01-01', '')).toBeNull();
    expect(checkRangeEdge('from', '', '2026-01-01')).toBeNull();
    expect(checkRangeEdge('to', '', '2026-01-01')).toBeNull();
  });

  it('orders datetime-local values correctly, including within the same day', () => {
    // yyyy-mm-ddTHH:mm is lexicographically ordered, so plain string compare is
    // right for both input types — no Date parsing, no timezone in play.
    expect(checkRangeEdge('to', '2026-01-15T08:00', '2026-01-15T17:00', 'datetime-local')).toBeTruthy();
    expect(checkRangeEdge('to', '2026-01-15T17:00', '2026-01-15T08:00', 'datetime-local')).toBeNull();
    // An identical instant is a zero-width window, but that is the operator's
    // choice to make, not an error to block.
    expect(checkRangeEdge('to', '2026-01-15T08:00', '2026-01-15T08:00', 'datetime-local')).toBeNull();
  });

  it('names the right unit so the hint reads correctly per input type', () => {
    expect(checkRangeEdge('to', '2026-01-01', '2026-01-31', 'date')).toContain('date');
    expect(checkRangeEdge('to', '2026-01-01T00:00', '2026-01-31T00:00', 'datetime-local'))
      .toContain('date and time');
  });

  it('compares across month and year boundaries', () => {
    // Guards against any future switch to a naive numeric or day-of-month compare.
    expect(checkRangeEdge('to', '2025-12-31', '2026-01-01')).toBeTruthy();
    expect(checkRangeEdge('to', '2026-01-01', '2025-12-31')).toBeNull();
    expect(checkRangeEdge('to', '2026-01-09', '2026-01-10')).toBeTruthy();
  });
});
