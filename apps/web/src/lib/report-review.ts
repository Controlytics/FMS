import { apiClient } from './api-client';
import { renderSnapshotToPdf, type ReportSnapshot } from './pdf-report';

export interface ReviewSummary {
  id: string; reportType: string; title: string; subtitle?: string; status: string;
  generatedByName: string; generatedAt: string;
  reviewedByName?: string | null; reviewedAt?: string | null;
  approvedByName?: string | null; approvedAt?: string | null;
  rejectionStage?: string | null; rejectedByName?: string | null; rejectedAt?: string | null;
  reviewRemarks?: string | null; approvalRemarks?: string | null;
  assigneeUserId?: string | null; assigneeRole?: string | null;
  createdAt: string; stage?: 'REVIEW' | 'APPROVE';
}
export interface ReviewFull extends ReviewSummary { dataSnapshot: ReportSnapshot; }

/** Send a generated report (its snapshot) for review, to a user OR a role. */
export async function submitForReview(snapshot: ReportSnapshot, assignee: { userId?: string; role?: string }) {
  return apiClient.post<{ id: string; status: string }>('/api/report-reviews', {
    reportType: snapshot.reportType ?? '',
    title: snapshot.title,
    subtitle: snapshot.subtitle,
    dataSnapshot: snapshot,
    ...(assignee.userId ? { assigneeUserId: assignee.userId } : {}),
    ...(assignee.role && !assignee.userId ? { assigneeRole: assignee.role } : {}),
  });
}

export async function fetchReview(id: string): Promise<ReviewFull> {
  return apiClient.get<ReviewFull>(`/api/report-reviews/${id}`);
}

/** Build the Printed/Reviewed/Approved By lines from a review record. */
export function reviewSignatures(r: { generatedByName: string; reviewedByName?: string | null; approvedByName?: string | null }): { label: string; value: string }[] {
  const lines = [{ label: 'Printed By', value: r.generatedByName }];
  if (r.reviewedByName) lines.push({ label: 'Reviewed By', value: r.reviewedByName });
  if (r.approvedByName) lines.push({ label: 'Approved By', value: r.approvedByName });
  return lines;
}

/** Re-download an approved (or any) report from its snapshot with the signatures. */
export async function downloadReview(id: string, formatDateTime: (d: string) => string) {
  const r = await fetchReview(id);
  const fname = `${(r.title || 'report').replace(/[^\w-]+/g, '_')}.pdf`;
  await renderSnapshotToPdf(r.dataSnapshot, reviewSignatures(r), formatDateTime, fname);
}
