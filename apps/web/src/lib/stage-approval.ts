/** Cleaning Stage Interlock — approver-side types + helpers. */

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
