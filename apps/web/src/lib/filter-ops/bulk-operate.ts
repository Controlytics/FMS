import { apiClient } from '@/lib/api-client';

export type BulkClientKind = 'advance' | 'start-and-advance' | 'submit-checklist';

export interface BulkClientItem {
  clientOpId: string;
  filterId: string;
  kind: BulkClientKind;
  payload?: any;
  cyclePayload?: any;
  advancePayload?: any;
}

export type BulkClientResult =
  | { clientOpId: string; filterId: string; status: 'ok'; snapshot: any }
  | { clientOpId: string; filterId: string; status: 'failed'; error: { code: string; message: string } };

/**
 * POST a whole batch of cleaning ops in one request. When `password` is given
 * (reauth retry), use the reauth-aware post so the server-side enforceReauth
 * gate is satisfied. Returns the per-item results array.
 */
export async function bulkOperate(
  items: BulkClientItem[],
  password?: string,
): Promise<{ results: BulkClientResult[] }> {
  const body = { items };
  return password
    ? apiClient.postWithReauth('/api/filters/bulk-operate', body, password)
    : apiClient.post('/api/filters/bulk-operate', body);
}
