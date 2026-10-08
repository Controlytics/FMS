import { describe, it, expect } from 'vitest';
import { workflowRowActions, type WorkflowPerms } from '../workflow-row-actions';

const none: WorkflowPerms = { canReview: false, canApprove: false, canEdit: false, canDelete: false, canSubmit: false };
const reviewer: WorkflowPerms = { ...none, canReview: true };
const approver: WorkflowPerms = { ...none, canApprove: true };
const creator: WorkflowPerms = { ...none, canEdit: true, canDelete: true, canSubmit: true };
const superAdmin: WorkflowPerms = { canReview: true, canApprove: true, canEdit: true, canDelete: true, canSubmit: true };

describe('workflowRowActions', () => {
  it('APPROVED (and a missing status) is an ordinary, selectable row with no workflow step, Details kept', () => {
    for (const status of ['APPROVED', null, undefined]) {
      const a = workflowRowActions(status, superAdmin);
      expect(a.operable).toBe(true);
      expect(a.selectable).toBe(true);
      // The eye stays after approval: it is where the review/approval record is read.
      expect(a.showDetails).toBe(true);
      expect(a.primary).toBeNull();
      expect(a.showResubmit).toBe(false);
    }
  });

  it('Details is offered on every status, whoever looks', () => {
    for (const status of ['APPROVED', 'PENDING_REVIEW', 'PENDING_APPROVAL', 'REJECTED', 'SOMETHING_NEW']) {
      expect(workflowRowActions(status, none).showDetails).toBe(true);
    }
  });

  it('a retired APPROVED filter keeps its actions but loses the bulk checkbox', () => {
    const a = workflowRowActions('APPROVED', superAdmin, { isRetired: true });
    expect(a.operable).toBe(true);
    expect(a.selectable).toBe(false);
  });

  it('PENDING_REVIEW: details for everyone; Review + a bulk checkbox only for the reviewer', () => {
    expect(workflowRowActions('PENDING_REVIEW', none)).toMatchObject({ operable: false, selectable: false, showDetails: true, primary: null });
    // 2026-10-08: the reviewer can tick several and review them in one popup.
    expect(workflowRowActions('PENDING_REVIEW', reviewer)).toMatchObject({ operable: false, selectable: true });
    expect(workflowRowActions('PENDING_REVIEW', approver).selectable).toBe(false);
    expect(workflowRowActions('PENDING_REVIEW', reviewer).primary).toBe('review');
    // Sequence: an approver must wait for the review step even though the
    // endpoint would accept an approve on PENDING_REVIEW.
    expect(workflowRowActions('PENDING_REVIEW', approver).primary).toBeNull();
    expect(workflowRowActions('PENDING_REVIEW', superAdmin).primary).toBe('review');
  });

  it('PENDING_APPROVAL: Approve only for the approver; the reviewer is done', () => {
    expect(workflowRowActions('PENDING_APPROVAL', reviewer).primary).toBeNull();
    expect(workflowRowActions('PENDING_APPROVAL', approver).primary).toBe('approve');
    expect(workflowRowActions('PENDING_APPROVAL', approver)).toMatchObject({ operable: false, selectable: true });
    expect(workflowRowActions('PENDING_APPROVAL', reviewer).selectable).toBe(false);
  });

  it('pending rows never expose edit / delete / resubmit, whoever looks', () => {
    for (const status of ['PENDING_REVIEW', 'PENDING_APPROVAL']) {
      const a = workflowRowActions(status, superAdmin);
      expect(a.showEdit).toBe(false);
      expect(a.showDelete).toBe(false);
      expect(a.showResubmit).toBe(false);
    }
  });

  it('REJECTED: the creator can edit, delete and resubmit; nobody gets a workflow step', () => {
    const a = workflowRowActions('REJECTED', creator);
    expect(a).toMatchObject({ operable: false, selectable: false, showDetails: true, primary: null, showEdit: true, showDelete: true, showResubmit: true });
    const r = workflowRowActions('REJECTED', reviewer);
    expect(r).toMatchObject({ primary: null, showEdit: false, showDelete: false, showResubmit: false });
  });

  it('an unknown status fails closed: details only', () => {
    expect(workflowRowActions('SOMETHING_NEW', superAdmin)).toMatchObject({ operable: false, selectable: false, showDetails: true, primary: null, showEdit: false });
  });
});
