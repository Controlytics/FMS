import { describe, it, expect, vi } from 'vitest';
import { appendCycleDetailToReport } from '../cycle-detail-pdf';

/**
 * A TERMINATED cycle's per-cycle DETAIL section — the on-screen Cycle Detail
 * page and the Filter Lifecycle Report's full-detail PDF — used to print the
 * cycle's end time under the label "Completed" and never named who ended it.
 *
 * Both are false/absent statements on a §11 record:
 *  - 20 of 24 live plain-TERMINATED cycles have `completedAt` set (retire and
 *    replace stamp it too), so the section positively ASSERTED completion;
 *  - the remaining 4 read "In Progress" on a cycle that had been terminated.
 *
 * The list/table surfaces already had this right via cycleEndInfo — only the
 * detail path did not, because it never called it. These lock the detail path
 * onto the same helper.
 */
const fmt = { formatDateTime: (s: string) => `@${s}` };

/** Minimal stand-in for the ReportDoc returned by createReport(). */
function fakeReport() {
  const kv: [string, string][][] = [];
  const tables: any[] = [];
  return {
    kv, tables,
    addKeyValue: (rows: [string, string][]) => kv.push(rows),
    addSectionTitle: vi.fn(),
    addTable: (t: any) => tables.push(t),
  };
}
const summaryOf = (r: ReturnType<typeof fakeReport>) => Object.fromEntries(r.kv[0]);
/** The termination reason is its own wrapping table, not a key-value pair —
 *  addKeyValue's fixed 61mm columns do not wrap and the live reasons are up to
 *  171 characters. */
const reasonTable = (r: ReturnType<typeof fakeReport>) =>
  r.tables.find((t) => t.head?.[0] === 'Termination Reason');

const base = {
  startedAt: 'S', cleaningReasonLabel: 'PM', cleaningAreaName: 'Block A',
  profileStages: ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT'],
  events: [],
};

describe('appendCycleDetailToReport — how a cycle ENDED', () => {
  it('a TERMINATED cycle is never labelled Completed, and names its terminator', () => {
    const r = fakeReport();
    appendCycleDetailToReport(r, {
      ...base, status: 'TERMINATED',
      completedAt: 'T', terminatedAt: 'T',
      completedByUsername: 'superadmin', lastStageByUsername: '101014',
    }, fmt);
    const s = summaryOf(r);
    expect(s['Status']).toBe('Terminated');
    expect(s['Terminated time']).toBe('@T');
    expect(s['Terminated by']).toBe('superadmin');
    // The old bug, stated as an assertion: no "Completed" row on a terminated cycle.
    expect(s['Completed time']).toBeUndefined();
  });

  it('a COMPLETED cycle still names the LAST STAGE operator, not the closer', () => {
    // 2026-09-03 rule: the 14 manual force-completes named the admin who closed
    // the cycle rather than the operator who did the work.
    const r = fakeReport();
    appendCycleDetailToReport(r, {
      ...base, status: 'COMPLETED', completedAt: 'T',
      completedByUsername: 'superadmin', lastStageByUsername: '101014',
    }, fmt);
    const s = summaryOf(r);
    expect(s['Status']).toBe('Completed');
    expect(s['Completed by']).toBe('101014');
  });

  it('retire/replace fall back to the audit performer — they write no CYCLE_TERMINATED event', () => {
    const r = fakeReport();
    appendCycleDetailToReport(r, {
      ...base, status: 'TERMINATED', terminationReason: 'RETIRED',
      completedAt: 'T', terminatedAt: 'T',
      completedByUsername: null, lastStageByUsername: '101014',
    }, { ...fmt, fallback: { replacedBy: null, retiredBy: 'EMP-004' } });
    const s = summaryOf(r);
    expect(s['Status']).toBe('Retired');
    expect(s['Terminated by']).toBe('EMP-004');
    // RETIRED is the status, not a reason — it must not be echoed as one.
    expect(reasonTable(r)).toBeUndefined();
  });

  it('prints the operator’s stated termination reason, which no report used to show', () => {
    const r = fakeReport();
    appendCycleDetailToReport(r, {
      ...base, status: 'TERMINATED', terminatedAt: 'T',
      terminationReason: 'Stuck-cycle cleanup 2026-05-25',
      completedByUsername: null, lastStageByUsername: null,
    }, fmt);
    const s = summaryOf(r);
    // In its own table so autoTable wraps it; a key-value pair would run off
    // the page for the 171-character reason in the live data.
    expect(reasonTable(r)?.body).toEqual([['Stuck-cycle cleanup 2026-05-25']]);
    // Nothing was ever recorded for these 12 live cycles. "-" is honest;
    // naming the last-stage operator under "Terminated by" would not be.
    expect(s['Terminated by']).toBe('-');
  });

  it('an IN_PROGRESS cycle keeps saying so instead of showing an empty end time', () => {
    const r = fakeReport();
    appendCycleDetailToReport(r, {
      ...base, status: 'IN_PROGRESS', completedAt: null,
      events: [{ eventType: 'CYCLE_STARTED', performedAt: 'x' }],
    }, fmt);
    const s = summaryOf(r);
    expect(s['Status']).toBe('In Progress');
    expect(s['Completed time']).toBe('In Progress');
    expect(s['Completed by']).toBe('-');
  });
});

describe('appendCycleDetailToReport — Stage Progress', () => {
  const stages = (r: ReturnType<typeof fakeReport>) => {
    const t = r.tables.find((x) => x.head?.[0] === 'Wash In')!;
    return Object.fromEntries(t.head.map((h: string, i: number) => [h, t.body[0][i]]));
  };

  it('a terminated cycle’s unreached stages read Terminated, not Pending', () => {
    // "Pending" asserts outstanding work on a cycle that was abandoned.
    const r = fakeReport();
    appendCycleDetailToReport(r, {
      ...base, status: 'TERMINATED', terminatedAt: 'T',
      events: [{ eventType: 'STATE_TRANSITION', toState: 'WASH_IN', performedAt: 'a' }],
    }, fmt);
    const s = stages(r);
    expect(s['Wash In']).toBe('Done');
    expect(s['Wash Out']).toBe('Terminated');
    // Not in this cycle's profile at all — never work that was planned.
    expect(s['Storage In']).toBe('NA');
  });

  it('an in-progress cycle is the only one that still says Pending', () => {
    const r = fakeReport();
    appendCycleDetailToReport(r, {
      ...base, status: 'IN_PROGRESS',
      events: [{ eventType: 'STATE_TRANSITION', toState: 'WASH_IN', performedAt: 'a' }],
    }, fmt);
    expect(stages(r)['Wash Out']).toBe('Pending');
  });
});
