import { describe, it, expect } from 'vitest';
import { mergeTimeline, replacementChain, timelineBlocks } from '../filter-lifecycle';
import { cycleEndInfo } from '../../../lib/cleaning-cycle-report';

/**
 * Manual status updates used to be collected into a trailing "Manual Status
 * Updates" section — its own PAGE in the full-detail PDF — so a filter's history
 * read as "everything that was cleaned, then separately everything that was
 * overridden" and the reader had to merge the two by eye. Operator request
 * 2026-09-03: interleave them by date, as the Cleaning Record already does.
 *
 * One rule drives all three surfaces: the screen, the full-detail PDF and the
 * compact PDF.
 */
const cycle = (id: string, startedAt: string) => ({ id, startedAt });
const manual = (id: string, performedAt: string) => ({ id, performedAt });

const seq = (items: ReturnType<typeof mergeTimeline>) =>
  items.map((i) => (i.kind === 'cycle' ? `C:${i.cycle.id}` : `M:${i.manual.id}`));

describe('mergeTimeline', () => {
  it('interleaves manual updates between the cycles they fall between', () => {
    const items = mergeTimeline(
      [cycle('c1', '2026-06-01T08:00:00Z'), cycle('c2', '2026-06-14T08:00:00Z'), cycle('c3', '2026-07-02T08:00:00Z')],
      [manual('m1', '2026-06-08T09:00:00Z'), manual('m2', '2026-06-20T09:00:00Z')],
    );
    expect(seq(items)).toEqual(['C:c1', 'M:m1', 'C:c2', 'M:m2', 'C:c3']);
  });

  it('is ASCENDING for both kinds', () => {
    // The lists it replaced disagreed: cycles were sorted ascending and manual
    // updates descending, so on one screen they ran in opposite directions.
    const items = mergeTimeline(
      [cycle('late', '2026-07-01T00:00:00Z'), cycle('early', '2026-06-01T00:00:00Z')],
      [manual('mLate', '2026-08-01T00:00:00Z'), manual('mEarly', '2026-05-01T00:00:00Z')],
    );
    expect(seq(items)).toEqual(['M:mEarly', 'C:early', 'C:late', 'M:mLate']);
  });

  it('handles either side being empty', () => {
    expect(seq(mergeTimeline([cycle('c1', '2026-06-01T00:00:00Z')], []))).toEqual(['C:c1']);
    expect(seq(mergeTimeline([], [manual('m1', '2026-06-01T00:00:00Z')]))).toEqual(['M:m1']);
    expect(mergeTimeline([], [])).toEqual([]);
  });

  it('survives a missing or unparseable date instead of producing NaN order', () => {
    // A row with no timestamp sorts first rather than making the comparator
    // return NaN, which leaves the whole array in an arbitrary order.
    const items = mergeTimeline(
      [cycle('good', '2026-06-01T00:00:00Z'), cycle('bad', 'not-a-date')],
      [manual('none', undefined as any)],
    );
    expect(seq(items).slice(-1)).toEqual(['C:good']);
    expect(items).toHaveLength(3);
  });
});

describe('timelineBlocks', () => {
  it('gives each cycle its own block and groups a contiguous manual run into one', () => {
    // The full-detail PDF starts a new page per block. Without the grouping a
    // run of five manual updates would take five pages.
    const blocks = timelineBlocks(mergeTimeline(
      [cycle('c1', '2026-06-01T00:00:00Z'), cycle('c2', '2026-07-01T00:00:00Z')],
      [manual('m1', '2026-06-10T00:00:00Z'), manual('m2', '2026-06-11T00:00:00Z')],
    ));
    expect(blocks.map((b) => (b.kind === 'cycle' ? `C:${b.cycle.id}` : `M:${b.manual.length}`)))
      .toEqual(['C:c1', 'M:2', 'C:c2']);
  });

  it('keeps runs separated by a cycle apart', () => {
    const blocks = timelineBlocks(mergeTimeline(
      [cycle('c1', '2026-06-05T00:00:00Z')],
      [manual('m1', '2026-06-01T00:00:00Z'), manual('m2', '2026-06-10T00:00:00Z')],
    ));
    expect(blocks.map((b) => (b.kind === 'cycle' ? `C:${b.cycle.id}` : `M:${b.manual.length}`)))
      .toEqual(['M:1', 'C:c1', 'M:1']);
  });

  it('is empty for an empty timeline', () => {
    expect(timelineBlocks([])).toEqual([]);
  });
});

/**
 * The report's "By" column. 2026-09-03 operator request: for a COMPLETED cycle
 * it must name whoever performed the LAST STAGE, not whoever closed the cycle.
 *
 * Those are the same operator on 578 of 593 live completed cycles — advancing
 * into the final stage completes the cycle in the same request — but they differ
 * on the 14 MANUAL FORCE-COMPLETES, where an admin closed the cycle from Edit
 * Filter Status and the column named that admin instead of the operator.
 */
describe('cycleEndInfo — who is "By"', () => {
  const fmt = (s: string) => s;

  it('a COMPLETED cycle names the LAST STAGE operator, not the closer', () => {
    const info = cycleEndInfo(
      { status: 'COMPLETED', completedAt: 'T', completedByUsername: 'superadmin', lastStageByUsername: '101014' },
      fmt,
    );
    expect(info.by).toBe('101014');
    expect(info.byLabel).toBe('Completed by');
  });

  it('falls back to the closer when the cycle has no stage transitions', () => {
    // One live cycle is COMPLETED with zero events at all.
    const info = cycleEndInfo(
      { status: 'COMPLETED', completedAt: 'T', completedByUsername: 'superadmin', lastStageByUsername: null },
      fmt,
    );
    expect(info.by).toBe('superadmin');
  });

  it('a TERMINATED cycle keeps the TERMINATOR — the label says so', () => {
    // Naming the last operator under "Terminated by" would be a false statement
    // about who ended the cycle.
    const info = cycleEndInfo(
      { status: 'TERMINATED', terminatedAt: 'T', completedByUsername: 'superadmin', lastStageByUsername: '101014' },
      fmt,
    );
    expect(info.by).toBe('superadmin');
    expect(info.byLabel).toBe('Terminated by');
  });

  it('retire/replace still fall back to the audit performer', () => {
    const replaced = cycleEndInfo(
      { status: 'TERMINATED', terminationReason: 'REPLACED', terminatedAt: 'T', completedByUsername: null, lastStageByUsername: '101014' },
      fmt, { replacedBy: 'qa-user', retiredBy: null },
    );
    expect(replaced.by).toBe('qa-user');

    const retired = cycleEndInfo(
      { status: 'TERMINATED', terminationReason: 'RETIRED', terminatedAt: 'T', completedByUsername: null, lastStageByUsername: '101014' },
      fmt, { replacedBy: null, retiredBy: 'store-user' },
    );
    expect(retired.by).toBe('store-user');
  });

  it('is null rather than misleading when nothing was ever recorded', () => {
    const info = cycleEndInfo(
      { status: 'TERMINATED', terminatedAt: 'T', completedByUsername: null, lastStageByUsername: null }, fmt,
    );
    expect(info.by).toBeNull();
  });
});

/**
 * A replaced filter's history does not end — it continues in its successor, and
 * the report's own Lifecycle Events say so. Reporting only the picked filter
 * left those references pointing at records nowhere in the document: the
 * operator's L2/AHU-011/SA/01-01 showed ZERO cycles beside "Created as
 * replacement of 01" and "Replaced by 01-02", while 01 held all 5 cycles.
 */
describe('replacementChain', () => {
  //  01 -> 01-01 -> 01-02 -> 01-03, the operator's real chain
  const byOld = new Map<string, any>([
    ['01',    { oldFilterId: '01',    newFilterId: '01-01' }],
    ['01-01', { oldFilterId: '01-01', newFilterId: '01-02' }],
    ['01-02', { oldFilterId: '01-02', newFilterId: '01-03' }],
  ]);
  const byNew = new Map<string, any>([
    ['01-01', { oldFilterId: '01',    newFilterId: '01-01' }],
    ['01-02', { oldFilterId: '01-01', newFilterId: '01-02' }],
    ['01-03', { oldFilterId: '01-02', newFilterId: '01-03' }],
  ]);

  it('returns the whole chain oldest-first from any link', () => {
    for (const pick of ['01', '01-01', '01-02', '01-03']) {
      expect(replacementChain(pick, byOld, byNew)).toEqual(['01', '01-01', '01-02', '01-03']);
    }
  });

  it('returns just the filter when it was never replaced', () => {
    expect(replacementChain('solo', new Map(), new Map())).toEqual(['solo']);
  });

  it('walks only backwards from the newest link and only forwards from the oldest', () => {
    const twoByOld = new Map<string, any>([['a', { oldFilterId: 'a', newFilterId: 'b' }]]);
    const twoByNew = new Map<string, any>([['b', { oldFilterId: 'a', newFilterId: 'b' }]]);
    expect(replacementChain('a', twoByOld, twoByNew)).toEqual(['a', 'b']);
    expect(replacementChain('b', twoByOld, twoByNew)).toEqual(['a', 'b']);
  });

  it('terminates on a malformed self-referencing pair instead of hanging', () => {
    // These maps are built from audit rows, so a bad pair is data, not a bug —
    // and an infinite walk would freeze the report rather than fail visibly.
    const loopOld = new Map<string, any>([['x', { oldFilterId: 'x', newFilterId: 'x' }]]);
    const loopNew = new Map<string, any>([['x', { oldFilterId: 'x', newFilterId: 'x' }]]);
    expect(replacementChain('x', loopOld, loopNew)).toEqual(['x']);
  });

  it('terminates on a longer cycle too', () => {
    const cycOld = new Map<string, any>([
      ['a', { oldFilterId: 'a', newFilterId: 'b' }],
      ['b', { oldFilterId: 'b', newFilterId: 'a' }],
    ]);
    const cycNew = new Map<string, any>([
      ['b', { oldFilterId: 'a', newFilterId: 'b' }],
      ['a', { oldFilterId: 'b', newFilterId: 'a' }],
    ]);
    const out = replacementChain('a', cycOld, cycNew);
    expect(new Set(out).size).toBe(out.length);
    expect(out).toContain('a');
  });

  it('is empty for a missing id', () => {
    expect(replacementChain('', byOld, byNew)).toEqual([]);
  });
});
