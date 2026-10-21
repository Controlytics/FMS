import { describe, it, expect, vi, afterEach } from 'vitest';
import { mockApi, type MockRequest } from '@/test-utils/page-harness';

// The PDF renderer is owned by pdf-report (jsPDF); mock it at that boundary so
// these tests assert what report-review hands it, not the drawing itself.
const pdf = vi.hoisted(() => ({ renderSnapshotToPdf: vi.fn(async () => undefined) }));
vi.mock('../pdf-report', () => ({ renderSnapshotToPdf: pdf.renderSnapshotToPdf }));

import { canDownloadReview, submitForReview, fetchReview, reviewSignatures, downloadReview, type ReviewSummary } from '../report-review';


// #reports-2: the "Download PDF" button must mirror the backend snapshot scope
// (canViewReportReview) so a non-party never sees a button that only 403s.
const base: ReviewSummary = {
  id: 'rr1', reportType: 'audit', title: 'T', status: 'APPROVED',
  generatedByName: 'gen', generatedAt: '', createdAt: '',
  reviewedByName: null, approvedByName: null, rejectedByName: null,
  assigneeUserId: null, assigneeRole: null,
};
const gen = { id: 'g-id', username: 'gen', role: 'OPERATOR' };
const stranger = { id: 's-id', username: 'stranger', role: 'OPERATOR' };

describe('canDownloadReview', () => {
  it('no user → false', () => {
    expect(canDownloadReview(undefined, base)).toBe(false);
  });
  it('SUPER_ADMIN → true for any report', () => {
    expect(canDownloadReview({ id: 'x', username: 'sa', role: 'SUPER_ADMIN' }, base)).toBe(true);
  });
  it('generator (by username) → true', () => {
    expect(canDownloadReview(gen, base)).toBe(true);
  });
  it('assignee by user id → true', () => {
    expect(canDownloadReview({ id: 'rev-id', username: 'rev', role: 'REVIEWER' }, { ...base, assigneeUserId: 'rev-id' })).toBe(true);
  });
  it('assignee by role → true', () => {
    expect(canDownloadReview({ id: 'x', username: 'anyone', role: 'QA' }, { ...base, assigneeRole: 'QA' })).toBe(true);
  });
  it('past reviewer/approver/rejecter (by username) → true', () => {
    expect(canDownloadReview({ id: 'x', username: 'rev', role: 'R' }, { ...base, reviewedByName: 'rev' })).toBe(true);
    expect(canDownloadReview({ id: 'x', username: 'app', role: 'A' }, { ...base, approvedByName: 'app' })).toBe(true);
    expect(canDownloadReview({ id: 'x', username: 'rej', role: 'R' }, { ...base, rejectedByName: 'rej' })).toBe(true);
  });
  it('uninvolved stranger → false (the core leak)', () => {
    expect(canDownloadReview(stranger, { ...base, assigneeUserId: 'rev-id', assigneeRole: 'REVIEWER' })).toBe(false);
  });
});

describe('submitForReview', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const snap = { reportType: 'audit', title: 'Audit Trail', subtitle: 'Oct', sections: [{ type: 'kv', rows: [] }] } as any;

  it('assigns to a user when a userId is given (role ignored)', async () => {
    const m = mockApi([{ method: 'POST', path: '/api/report-reviews', body: (req: MockRequest) => ({ id: 'rr9', status: 'PENDING_REVIEW', got: req.json }) }]);
    const res: any = await submitForReview(snap, { userId: 'u-7', role: 'QA' });
    expect(res.id).toBe('rr9');
    expect(m.requests[0].json).toEqual({ reportType: 'audit', title: 'Audit Trail', subtitle: 'Oct', dataSnapshot: snap, assigneeUserId: 'u-7' });
  });

  it('assigns to a role when only a role is given; reportType defaults to ""', async () => {
    const m = mockApi([{ method: 'POST', path: '/api/report-reviews', body: { id: 'rr1', status: 'PENDING_REVIEW' } }]);
    await submitForReview({ title: 'T', sections: [] } as any, { role: 'QA' });
    expect(m.requests[0].json).toEqual({ reportType: '', title: 'T', dataSnapshot: { title: 'T', sections: [] }, assigneeRole: 'QA' });
  });
});

describe('reviewSignatures', () => {
  it('always prints Printed By; adds Reviewed / Approved only when present', () => {
    expect(reviewSignatures({ generatedByName: 'gen' })).toEqual([{ label: 'Printed By', value: 'gen' }]);
    expect(reviewSignatures({ generatedByName: 'gen', reviewedByName: 'rev', approvedByName: 'app' })).toEqual([
      { label: 'Printed By', value: 'gen' }, { label: 'Reviewed By', value: 'rev' }, { label: 'Approved By', value: 'app' },
    ]);
    expect(reviewSignatures({ generatedByName: 'gen', reviewedByName: null, approvedByName: 'app' })).toEqual([
      { label: 'Printed By', value: 'gen' }, { label: 'Approved By', value: 'app' },
    ]);
  });
});

describe('fetchReview / downloadReview', () => {
  afterEach(() => { vi.unstubAllGlobals(); pdf.renderSnapshotToPdf.mockClear(); });
  const record = { ...base, id: 'rr 1', title: 'Audit Trail: Oct/2026', generatedByName: 'gen', reviewedByName: 'rev', approvedByName: 'app', dataSnapshot: { title: 'Snap', sections: [] } };

  it('fetchReview GETs the full record', async () => {
    const m = mockApi([{ path: '/api/report-reviews/rr1', body: { ...record, id: 'rr1' } }]);
    await expect(fetchReview('rr1')).resolves.toMatchObject({ id: 'rr1', dataSnapshot: { title: 'Snap' } });
    expect(m.requests[0].path).toBe('/api/report-reviews/rr1');
  });

  it('re-renders the stored snapshot with the signature lines and a filesystem-safe name', async () => {
    mockApi([{ path: '/api/report-reviews/rr1', body: record }]);
    const fmt = (d: string) => d;
    await downloadReview('rr1', fmt);
    expect(pdf.renderSnapshotToPdf).toHaveBeenCalledWith(
      { title: 'Snap', sections: [] },
      [{ label: 'Printed By', value: 'gen' }, { label: 'Reviewed By', value: 'rev' }, { label: 'Approved By', value: 'app' }],
      fmt,
      'Audit_Trail_Oct_2026.pdf',
    );
  });

  it('falls back to report.pdf when the record has no title', async () => {
    mockApi([{ path: '/api/report-reviews/rr2', body: { ...record, title: '' } }]);
    await downloadReview('rr2', (d) => d);
    expect((pdf.renderSnapshotToPdf.mock.calls[0] as unknown[])[3]).toBe('report.pdf');
  });

  it('does not render anything when the record cannot be fetched', async () => {
    mockApi([{ path: '/api/report-reviews/gone', status: 403, body: { error: 'FORBIDDEN', message: 'Not a party' } }]);
    await expect(downloadReview('gone', (d) => d)).rejects.toThrow('Not a party');
    expect(pdf.renderSnapshotToPdf).not.toHaveBeenCalled();
  });
});
