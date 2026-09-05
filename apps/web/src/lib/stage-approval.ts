/** Cleaning Stage Interlock — approver-side types + helpers. */
import { formatByLeastCount } from './format-by-least-count';
import { fmtMinutes } from './cleaning-cycle-report';

export interface StageApprovalDetails {
  filterName: string | null;
  block: string | null;
  area: string | null;
  ahu: string | null;
  ahuType: string | null;
  micronSize: string | null;
  filterType: string | null;
  filterDimensions: string | null;
  filterSet: string | null;
}

/** One instrument reading as the server returns it on a stage step. */
export interface StageReading {
  description: string | null;
  value: number | null;
  uom: string | null;
  leastCount: number | null;
  outOfRange?: boolean;
}

export interface StageStep {
  at: string | null;
  by: string | null;
  readings: StageReading[];
}

/**
 * Live stage details the SERVER derives from the cycle + filter_events for each
 * approval (2026-09-05): what the wash / dry actually recorded, so the approver
 * decides on evidence rather than on the filter's identity alone. `washIn` /
 * `washOut` are set for a WASH_OUT approval, `dryIn` / `dryOut` for a DRY_OUT
 * one. Not frozen: a SUPER_ADMIN correction of an event shows on the next read.
 */
export interface StageDetails {
  cleaningReason: string | null;
  washIn?: StageStep;
  washOut?: StageStep;
  dryIn?: {
    startedAt: string | null;
    startedBy: string | null;
    durationMinutes: number | null;
    endedAt: string | null;
    endedBy: string | null;
    readings: StageReading[];
  };
  dryOut?: StageStep;
}

export interface StageApprovalSummary {
  id: string;
  cycleId: string | null;
  filterId: string;
  stageKey: string;
  // SUPERSEDED = closed without a decision (the filter left the gate before the
  // approver acted). Never appears in the queue; archive-only.
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  approverRole: string;
  rejectToStateKey: string;
  attemptSeq: number;
  detailsSnapshot: StageApprovalDetails;
  requestedByName: string;
  requestedAt: string;
  decidedByName?: string | null;
  decidedAt?: string | null;
  decisionRemarks?: string | null;
  /**
   * True when segregation of duties is ON *and* the reader is the person who
   * performed this stage — so approve/reject would 403 SELF_APPROVAL_FORBIDDEN.
   * The row stays in the queue (another holder of the approver role can decide
   * it); it is simply not actionable by this reader.
   *
   * The SERVER computes this — never re-derive it here. It needs
   * `requireDifferentApprover` from the stage-interlock config, which an
   * approver role typically cannot read. Optional so an older/cached response
   * degrades to "actionable" rather than hiding every button.
   */
  selfRequested?: boolean;
  /** See StageDetails. Optional so an older/cached response renders without the section. */
  stageDetails?: StageDetails;
}

const STAGE_LABELS: Record<string, string> = {
  WASH_IN: 'Wash In', WASH_OUT: 'Wash Out',
  DRY_IN: 'Dry In', DRY_OUT: 'Dry Out',
  STORAGE_IN: 'Storage In', STORAGE_OUT: 'Storage Out',
};

export function prettyStage(stateKey: string | null | undefined): string {
  if (!stateKey) return '';
  return STAGE_LABELS[stateKey] ?? stateKey;
}

/** The labelled detail rows an approver verifies, in display order. */
export function detailRows(d: StageApprovalDetails): { label: string; value: string }[] {
  return [
    { label: 'Filter', value: d.filterName ?? '—' },
    { label: 'Block', value: d.block ?? '—' },
    { label: 'Area', value: d.area ?? '—' },
    { label: 'AHU', value: d.ahu ?? '—' },
    { label: 'AHU Type', value: d.ahuType ?? '—' },
    { label: 'Micron Size', value: d.micronSize ?? '—' },
    { label: 'Filter Type', value: d.filterType ?? '—' },
    { label: 'Filter Dimensions', value: d.filterDimensions ?? '—' },
    { label: 'Filter Set', value: d.filterSet ?? '—' },
  ];
}

export interface StageDetailGroup {
  /** Section heading — "Wash In", "Wash Out", "Dry In", "Dry Out". */
  title: string;
  rows: { label: string; value: string }[];
}

/** Format a reading with its least count and unit. */
export function formatReading(r: StageReading): string {
  if (r.value == null) return '—';
  const num = r.leastCount != null ? formatByLeastCount(r.value, r.leastCount) : String(r.value);
  return `${num}${r.uom ? ` ${r.uom}` : ''}${r.outOfRange ? ' (out of range)' : ''}`;
}

/**
 * The stage-details sections for one approval, in display order. `fmt` formats
 * an ISO instant in the configured zone (useDatetimeFormat().formatDateTime).
 * Readings are rendered by their own description, so whatever instruments the
 * equipment group carries (RO water pressure, compressed air pressure, dryer
 * temperature, …) appear under the stage that recorded them.
 */
export function stageDetailGroups(
  stageKey: string,
  d: StageDetails | null | undefined,
  fmt: (iso: string) => string,
): StageDetailGroup[] {
  if (!d) return [];
  const when = (iso: string | null) => (iso ? fmt(iso) : '—');
  const who = (name: string | null) => name ?? '—';
  const readingRows = (rs: StageReading[]) => rs.map((r) => ({ label: r.description ?? 'Reading', value: formatReading(r) }));

  if (stageKey === 'WASH_OUT') {
    return [
      {
        title: 'Wash In',
        rows: [
          { label: 'Done at', value: when(d.washIn?.at ?? null) },
          ...readingRows(d.washIn?.readings ?? []),
          { label: 'Cleaning reason', value: d.cleaningReason ?? '—' },
          { label: 'Cleaned by', value: who(d.washIn?.by ?? null) },
        ],
      },
      {
        title: 'Wash Out',
        rows: [
          { label: 'Done at', value: when(d.washOut?.at ?? null) },
          { label: 'By', value: who(d.washOut?.by ?? null) },
        ],
      },
    ];
  }

  if (stageKey === 'DRY_OUT') {
    const di = d.dryIn;
    return [
      {
        title: 'Dry In',
        rows: [
          { label: 'Started at', value: when(di?.startedAt ?? null) },
          { label: 'Duration', value: di?.durationMinutes != null ? `${fmtMinutes(di.durationMinutes)}` : '—' },
          ...readingRows(di?.readings ?? []),
          { label: 'Ended at', value: when(di?.endedAt ?? null) },
          { label: 'Cleaning reason', value: d.cleaningReason ?? '—' },
          // One person normally does both halves; show a second name only when they differ.
          { label: 'By', value: di?.startedBy && di?.endedBy && di.startedBy !== di.endedBy ? `${di.startedBy} / ${di.endedBy}` : who(di?.endedBy ?? di?.startedBy ?? null) },
        ],
      },
      {
        title: 'Dry Out',
        rows: [
          { label: 'Done at', value: when(d.dryOut?.at ?? null) },
          { label: 'By', value: who(d.dryOut?.by ?? null) },
        ],
      },
    ];
  }

  return d.cleaningReason ? [{ title: prettyStage(stageKey), rows: [{ label: 'Cleaning reason', value: d.cleaningReason }] }] : [];
}
