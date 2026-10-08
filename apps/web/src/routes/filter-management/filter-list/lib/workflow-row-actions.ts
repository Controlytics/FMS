// Filter creation workflow (2026-09-24 redesign): which controls a Filters page
// ROW offers, decided in one place from the filter's approval status + the
// viewer's permissions.
//
// The operator's rule: a filter that is not yet APPROVED shows its details
// only. No edit / delete / status / retire / RFID controls.
// The ONE thing it offers is the next workflow step, inline on the row, to the
// role that owns that step: Review (PENDING_REVIEW → reviewer) or Approve
// (PENDING_APPROVAL → approver). Both open the details popup; the decision is
// taken there.
//
// Bulk (2026-10-08, operator): a pending row DOES get a checkbox for the viewer
// who owns its step, so several can be ticked and reviewed / approved at once.
// The ticked rows still open the bulk popup, which lists each record before the
// decision — a selection never decides on its own. Ticked pending rows are
// never fed to Update Status / Retire / Replace (see `operable`).
//
// A REJECTED filter is the exception: the creator must be able to
// correct it (Edit), resubmit it, or give up on it (Delete).
//
// Sequence is enforced here as well as on the server: an approver looking at a
// PENDING_REVIEW row sees Details, not Approve, even though the endpoint would
// accept the call (it tolerates that for installs with no review role).

export type FilterApprovalStatus = 'PENDING_REVIEW' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | string;

export type WorkflowPerms = {
  canReview: boolean;
  canApprove: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Holds a create / bulk-upload grant — the roles allowed to resubmit. */
  canSubmit: boolean;
};

export type WorkflowRowActions = {
  /** APPROVED (or unknown/legacy) — the ordinary action cluster and checkbox apply. */
  operable: boolean;
  /** Bulk checkbox shown: an operable row, or a pending row whose step THIS
   *  viewer owns (it can then be ticked for bulk Review / Approve). */
  selectable: boolean;
  /** Read-only details popup for anyone who can see the row. Always on — an
   *  approved filter's popup is where its review/approval record is read. */
  showDetails: boolean;
  /** The inline workflow step for THIS viewer, or null. */
  primary: 'review' | 'approve' | null;
  showResubmit: boolean;
  showEdit: boolean;
  showDelete: boolean;
};

export function workflowRowActions(
  status: FilterApprovalStatus | null | undefined,
  perms: WorkflowPerms,
  opts: { isRetired?: boolean } = {},
): WorkflowRowActions {
  const s = status ?? 'APPROVED';
  const retired = opts.isRetired === true;

  if (s === 'APPROVED' || s === 'PENDING' /* never written for filters; treat as usable */) {
    return {
      operable: true,
      selectable: !retired,
      // The Details popup stays after approval (operator, 2026-09-24): it is
      // where the who-submitted / reviewed / approved record is read later.
      showDetails: true,
      primary: null,
      showResubmit: false,
      showEdit: false,
      showDelete: false,
    };
  }

  if (s === 'PENDING_REVIEW') {
    return {
      operable: false, selectable: perms.canReview, showDetails: true,
      primary: perms.canReview ? 'review' : null,
      showResubmit: false, showEdit: false, showDelete: false,
    };
  }

  if (s === 'PENDING_APPROVAL') {
    return {
      operable: false, selectable: perms.canApprove, showDetails: true,
      primary: perms.canApprove ? 'approve' : null,
      showResubmit: false, showEdit: false, showDelete: false,
    };
  }

  if (s === 'REJECTED') {
    return {
      operable: false, selectable: false, showDetails: true,
      primary: null,
      showResubmit: perms.canSubmit,
      showEdit: perms.canEdit,
      showDelete: perms.canDelete,
    };
  }

  // An unrecognised status: fail closed — details only, no workflow step.
  return {
    operable: false, selectable: false, showDetails: true,
    primary: null, showResubmit: false, showEdit: false, showDelete: false,
  };
}
