import {
  fmtMinutes, cycleEndInfo, effectiveCycleStatus, performerLabel,
  STAGE_ORDER, maxReachedStageIndex, resolveStageCell, stageCellText,
  transitionEndpoints, phaseSuffix,
} from '../../lib/cleaning-cycle-report';
import { STAGE_LABELS } from './cycle-detail-view';

// Cycle status as an inspector reads it. RETIRED / REPLACED are effective
// statuses — a TERMINATED cycle whose filter was retired / replaced mid-clean.
const STATUS_LABELS: Record<string, string> = {
  COMPLETED: 'Completed', IN_PROGRESS: 'In Progress',
  TERMINATED: 'Terminated', RETIRED: 'Retired', REPLACED: 'Replaced',
};

/**
 * Append one cleaning cycle's full detail (summary key-values + stage progress
 * table + event timeline table + checklist Q&A tables) to a report created by
 * createReport(). Shared by the View detail PDF (timeline.tsx) and the Filter
 * Lifecycle Report PDF so both render identically. `report` is the ReportDoc
 * returned by createReport(); typed loosely to avoid importing the type.
 */
export function appendCycleDetailToReport(
  report: any,
  cycle: any,
  fmt: {
    formatDateTime: (s: string) => string;
    /** FILTER_RETIRED / FILTER_REPLACED audit performer, for a cycle ended by
     *  retire/replace — that path writes no CYCLE_TERMINATED event, so the cycle
     *  records no terminator of its own. See CycleDetailView's prop of the same
     *  name for why the caller resolves it. */
    fallback?: { replacedBy?: string | null; retiredBy?: string | null };
  },
) {
  const { formatDateTime } = fmt;
  const events = cycle.events ?? [];

  // "Duration" = dryer duration selected at DRY_IN, not total cycle duration.
  const dryerEvent = events.find((e: any) =>
    e.eventType === 'STATE_TRANSITION' && e.toState === 'DRY_IN' &&
    (e.attributes?.action === 'DRYER_STARTED' || e.attributes?.dryerDurationMinutes != null));
  const dryerMinutes: number | null =
    cycle.dryerDurationMinutes ?? dryerEvent?.attributes?.dryerDurationMinutes ?? null;
  const durationStr = fmtMinutes(dryerMinutes) ?? '—';

  const completedStages = events
    .filter((e: any) => e.eventType === 'STATE_TRANSITION' && e.toState)
    .map((e: any) => e.toState);

  // Summary key-values.
  //
  // This block used to read `['Completed', cycle.completedAt ? … : 'In Progress']`
  // unconditionally, so a TERMINATED cycle asserted it was COMPLETED at the
  // instant it was terminated — 20 of 24 live terminated cycles have
  // completedAt set — and the report never named who ended it. Both are the
  // same one-line fix: cycleEndInfo returns the matching label pair, and it is
  // the SAME helper the lifecycle table and the on-screen detail use.
  const eff = effectiveCycleStatus(cycle);
  const endInfo = cycleEndInfo(cycle, formatDateTime, fmt.fallback);
  const inProgress = eff === 'IN_PROGRESS';
  const summaryRows: [string, string][] = [
    ['Cleaning Reason', cycle.cleaningReasonLabel || cycle.cleaningReasonKey || '-'],
    ['Block', cycle.cleaningAreaName ?? '-'],
    ['Status', STATUS_LABELS[eff] ?? eff],
    ['Duration', durationStr],
    ['Started', formatDateTime(cycle.startedAt)],
    // "-" is honest: 12 live cycles were terminated DB-direct and no terminator
    // was ever recorded. Naming the last stage's operator under "Terminated by"
    // would be a false statement about who ended the cycle.
    [endInfo.endLabel.replace('Cycle ', ''), inProgress ? 'In Progress' : (endInfo.endTimeText === '—' ? '-' : endInfo.endTimeText)],
    [endInfo.byLabel, inProgress ? '-' : (endInfo.by ?? '-')],
    ['Events', `${events.length} event(s)`],
  ];
  report.addKeyValue(summaryRows);

  // The operator's stated reason for ending the cycle — stored since terminate()
  // was written and printed on no report until 2026-09-04. RETIRED / REPLACED
  // are the status, not a reason, and are already on the Status row.
  //
  // A TABLE, not another key-value pair: addKeyValue lays out 3 fixed ~61mm
  // columns and jsPDF's doc.text does not wrap, so a long reason would run off
  // the page edge and be lost. The live reasons are 92 and 171 characters —
  // ~273mm of 9pt helvetica for the longer one, on a 210mm page. autoTable
  // wraps.
  const terminationReason: string | null =
    cycle.terminationReason && cycle.terminationReason !== 'RETIRED' && cycle.terminationReason !== 'REPLACED'
      ? cycle.terminationReason : null;
  if (terminationReason) {
    report.addTable({
      head: ['Termination Reason'],
      body: [[terminationReason]],
      headColor: [185, 28, 28],
    });
  }

  // Stage progress.
  //
  // Every unreached stage used to read "Pending" — on a TERMINATED cycle that
  // asserts the work is still outstanding on a record that was abandoned, and on
  // a stage the cycle's profile does not even contain it invents work that was
  // never planned. Same rule as the Cleaning Record's stage columns
  // (resolveStageCell): NA / Skipped / Terminated / Retired / Replaced /
  // Pending, with "Pending" meaning ONLY an in-progress cycle. STAGE_ORDER is
  // the shared axis — this file used to keep its own copy of the six stages.
  report.addSectionTitle('Stage Progress');
  const profileStages: string[] = cycle.profileStages ?? [];
  const maxReachedIdx = maxReachedStageIndex(events, profileStages);
  report.addTable({
    head: STAGE_ORDER.map((st) => STAGE_LABELS[st] ?? st),
    body: [STAGE_ORDER.map((st) => stageCellText(resolveStageCell({
      stage: st,
      value: completedStages.includes(st) ? 'Done' : null,
      profileStages,
      effStatus: eff,
      maxReachedIdx,
    })))],
    headColor: [59, 130, 246],
  });

  // Events
  report.addSectionTitle('Event Timeline');
  const eventRows: string[][] = [];
  const checklistRows: { eventIdx: number; qa: { question: string; answer: any }[] }[] = [];

  events.forEach((ev: any, idx: number) => {
    // The two DRY_IN steps read as "Wash Out -> Dry In (Started)" and
    // "Dry In -> Dry In (Ended)"; everything else passes straight through.
    const { from, to, phase } = transitionEndpoints(ev);
    eventRows.push([
      String(idx + 1),
      ev.eventType.replace(/_/g, ' '),
      from
        ? (STAGE_LABELS[from] ?? from)
        : (ev.eventType === 'STATE_TRANSITION' && to ? 'To Be Cleaned' : '-'),
      to ? `${STAGE_LABELS[to] ?? to}${phaseSuffix(phase)}` : '-',
      performerLabel(ev),
      formatDateTime(ev.performedAt),
      ev.remarks || '-',
    ]);
    if (ev.enrichedAnswers?.length > 0) {
      checklistRows.push({ eventIdx: idx + 1, qa: ev.enrichedAnswers });
    }
  });

  report.addTable({
    head: ['S.No', 'Event', 'From', 'To', 'Performed By', 'Time', 'Remarks'],
    body: eventRows,
    columnStyles: { 0: { cellWidth: 14, halign: 'center' }, 6: { cellWidth: 50 } },
  });

  // Checklist answers
  for (const cl of checklistRows) {
    report.addSectionTitle(`Checklist Responses (S.No ${cl.eventIdx})`);
    const qaRows = cl.qa.map((qa, i) => [
      String(i + 1),
      qa.question,
      typeof qa.answer === 'boolean' ? (qa.answer ? 'Yes' : 'No') : String(qa.answer),
    ]);
    report.addTable({
      head: ['S.No', 'Question', 'Answer'],
      body: qaRows,
      headColor: [21, 128, 61],
      columnStyles: { 0: { cellWidth: 14, halign: 'center' }, 2: { cellWidth: 30 } },
    });
  }
}
