import { describe, it, expect } from 'vitest';
import { appendCycleDetailToReport } from '../cycle-detail-pdf';
import { fakeReport, completedCycle, ISO } from './cycles-fixtures';

/**
 * The per-cycle detail section printed by the Cycle Detail PDF and the Filter
 * Lifecycle Report PDF. These assert the rows/columns handed to the PDF
 * boundary (the ReportDoc) — the existing cycle-detail-terminated.test.ts
 * covers how a cycle ENDED; this covers the stage table, the event timeline
 * and the checklist tables.
 */
const fmt = { formatDateTime: (s: string) => `@${s}` };
const EVENT_HEAD = ['S.No', 'Event', 'From', 'To', 'Performed By', 'Time', 'Remarks'];

describe('appendCycleDetailToReport — tables', () => {
  it('summary, stage progress and the event timeline of a completed cycle', () => {
    const r = fakeReport();
    appendCycleDetailToReport(r, completedCycle(), fmt);
    const kv = r.kvs()[0];
    expect(kv).toMatchObject({
      'Cleaning Reason': 'Preventive', Block: 'Block A', Status: 'Completed', Duration: '1h 30m',
      Started: `@${ISO(8)}`, 'Completed time': `@${ISO(12)}`, 'Completed by': 'opr2', Events: '5 event(s)',
    });
    expect(r.titles()).toEqual(['Stage Progress', 'Event Timeline']);
    const [stages, timeline] = r.tables();
    expect(stages.head).toEqual(['Wash In', 'Wash Out', 'Dry In', 'Dry Out', 'Storage In', 'Storage Out']);
    expect(stages.body).toEqual([['Done', 'Done', 'Done', 'Done', 'NA', 'NA']]);
    expect(timeline.head).toEqual(EVENT_HEAD);
    expect(timeline.body).toEqual([
      ['1', 'STATE TRANSITION', 'To Be Cleaned', 'Wash In', 'opr1', `@${ISO(8)}`, '-'],
      ['2', 'STATE TRANSITION', 'Wash In', 'Wash Out', 'opr1', `@${ISO(9)}`, '-'],
      ['3', 'STATE TRANSITION', 'Wash Out', 'Dry In (Started)', 'opr2', `@${ISO(10)}`, '-'],
      ['4', 'STATE TRANSITION', 'Dry In', 'Dry In (Ended)', 'opr2', `@${ISO(11, 30)}`, '-'],
      ['5', 'STATE TRANSITION', 'Dry In', 'Dry Out', 'opr3', `@${ISO(12)}`, '-'],
    ]);
  });

  it('a checklist event gets its own Q&A table; booleans read Yes/No', () => {
    const r = fakeReport();
    appendCycleDetailToReport(r, {
      ...completedCycle(),
      events: [
        { id: 'e1', eventType: 'CYCLE_STARTED', performedAt: ISO(8), performedBy: 'abcdef12-3456', remarks: 'started' },
        { id: 'e2', eventType: 'CHECKLIST_COMPLETED', performedAt: ISO(9), enrichedAnswers: [
          { questionId: 'q1', question: 'Frame intact?', answer: true },
          { questionId: 'q2', question: 'Media torn?', answer: false },
          { questionId: 'q3', question: 'Pressure drop', answer: 12 },
        ] },
      ],
    }, fmt);
    expect(r.titles()).toEqual(['Stage Progress', 'Event Timeline', 'Checklist Responses (S.No 2)']);
    const timeline = r.tables()[1];
    // Not a transition: From/To read "-"; a deleted performer falls back to the uuid prefix.
    expect(timeline.body[0]).toEqual(['1', 'CYCLE STARTED', '-', '-', 'abcdef12', `@${ISO(8)}`, 'started']);
    expect(timeline.body[1][4]).toBe('-');
    const qa = r.tables()[2];
    expect(qa.head).toEqual(['S.No', 'Question', 'Answer']);
    expect(qa.body).toEqual([['1', 'Frame intact?', 'Yes'], ['2', 'Media torn?', 'No'], ['3', 'Pressure drop', '12']]);
  });

  it('an operator termination reason is its own table; stage cells read Terminated / Skipped', () => {
    const r = fakeReport();
    appendCycleDetailToReport(r, {
      id: 'c', status: 'TERMINATED', terminationReason: 'Media torn beyond repair', startedAt: ISO(8), terminatedAt: ISO(9),
      profileStages: ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT'],
      events: [{ id: 'e', eventType: 'STATE_TRANSITION', toState: 'WASH_OUT', fromState: 'WASH_IN', performedAt: ISO(9) }],
    }, fmt);
    const tables = r.tables();
    expect(tables[0]).toMatchObject({ head: ['Termination Reason'], body: [['Media torn beyond repair']] });
    // WASH_IN before the furthest stage reached = Skipped; later ones = Terminated.
    expect(tables[1].body).toEqual([['Skipped', 'Done', 'Terminated', 'Terminated', 'NA', 'NA']]);
    const kv = r.kvs()[0];
    expect(kv['Cleaning Reason']).toBe('-');
    expect(kv['Block']).toBe('-');
    expect(kv['Duration']).toBe('—');
    expect(kv['Terminated by']).toBe('-');
  });

  it('dryer duration falls back to the DRY_IN event; an unknown state passes through; in-progress', () => {
    const r = fakeReport();
    appendCycleDetailToReport(r, {
      id: 'c', status: 'IN_PROGRESS', startedAt: ISO(8), profileStages: [],
      events: [
        { id: 'e1', eventType: 'STATE_TRANSITION', fromState: 'QUARANTINE', toState: 'DRY_IN', performedAt: ISO(9), attributes: { dryerDurationMinutes: 45 } },
        { id: 'e2', eventType: 'STATE_TRANSITION', fromState: 'DRY_IN', toState: 'INSPECTION', performedAt: ISO(10), performedByUsername: 'u2' },
      ],
    }, fmt);
    const kv = r.kvs()[0];
    expect(kv.Duration).toBe('45m');
    expect(kv.Status).toBe('In Progress');
    expect(kv['Completed time']).toBe('In Progress');
    expect(kv['Completed by']).toBe('-');
    const timeline = r.tables()[1];
    expect(timeline.body[0].slice(2, 4)).toEqual(['QUARANTINE', 'Dry In (Started)']);
    expect(timeline.body[1].slice(2, 5)).toEqual(['Dry In', 'INSPECTION', 'u2']);
    // profileStages unknown: never-reached stages are Pending on an in-progress cycle.
    expect(r.tables()[0].body[0]).toEqual(['Pending', 'Pending', 'Done', 'Pending', 'Pending', 'Pending']);
  });

  it('a cycle with no events array and an unmapped status still renders', () => {
    const r = fakeReport();
    appendCycleDetailToReport(r, { id: 'c', status: 'ON_HOLD', startedAt: ISO(8) }, fmt);
    const kv = r.kvs()[0];
    expect(kv.Status).toBe('ON_HOLD');
    expect(kv.Events).toBe('0 event(s)');
    expect(r.tables()[1].body).toEqual([]);
  });
});
