/**
 * Filter Operations — bulk-operate() orchestration.
 *
 * Batches advance / start-and-advance / submit-checklist ops for the tablet
 * to submit 50-100 filter cleaning ops in one request instead of one-per-filter.
 * Each item runs via the existing single-op service method (own transaction,
 * own audit row, all gates). Per-item try/catch -> partial success: a failed
 * filter does not affect the others.
 */
import type { RequestContext } from '../../../types/context.js';
import type { FilterOperationsService } from '../filter-operations.service.js';

export type BulkOpKind = 'advance' | 'start-and-advance' | 'submit-checklist';

export interface BulkOpItem {
  clientOpId: string;
  filterId: string;
  kind: BulkOpKind;
  payload?: any;          // advance | submit-checklist body
  cyclePayload?: any;     // start-and-advance: start-cycle body
  advancePayload?: any;   // start-and-advance: advance body
}

export type BulkOpResult =
  | { clientOpId: string; filterId: string; status: 'ok'; snapshot: any }
  | { clientOpId: string; filterId: string; status: 'failed'; error: { code: string; message: string } };

/** Reauth action implied by each op kind (mid-cycle advance is not reauth-gated). */
export function reauthActionsForItems(items: BulkOpItem[]): string[] {
  const set = new Set<string>();
  for (const it of items) {
    if (it.kind === 'advance') set.add('ADVANCE_FILTER_STAGE');
    else if (it.kind === 'start-and-advance') set.add('START_CLEANING_CYCLE');
    else if (it.kind === 'submit-checklist') set.add('SUBMIT_CHECKLIST_WITH_SIGNATURE');
  }
  return [...set];
}

/**
 * Orchestrate a batch of cleaning ops. Each item runs via the existing single-op
 * service method (own transaction, own audit row, all gates). Per-item try/catch
 * -> partial success: a failed filter does not affect the others.
 */
export async function bulkOperate(
  service: FilterOperationsService,
  ctx: RequestContext,
  items: BulkOpItem[],
): Promise<{ results: BulkOpResult[] }> {
  const results: BulkOpResult[] = [];
  for (const item of items) {
    try {
      let snapshot: any;
      if (item.kind === 'advance') {
        snapshot = await service.advance(ctx, item.filterId, item.payload);
      } else if (item.kind === 'start-and-advance') {
        await service.startCycle(ctx, item.filterId, item.cyclePayload);
        snapshot = await service.advance(ctx, item.filterId, item.advancePayload);
      } else {
        snapshot = await service.submitChecklist(ctx, item.filterId, item.payload);
      }
      results.push({ clientOpId: item.clientOpId, filterId: item.filterId, status: 'ok', snapshot });
    } catch (e: any) {
      results.push({
        clientOpId: item.clientOpId,
        filterId: item.filterId,
        status: 'failed',
        error: { code: e?.code ?? 'OP_FAILED', message: e?.message ?? 'Operation failed' },
      });
    }
  }
  return { results };
}
