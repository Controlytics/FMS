# Bulk Filter-Operate Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the tablet's 50–100 tag batch submit from N sequential HTTP round-trips into one `POST /api/filters/bulk-operate` request, with partial success and one reauth prompt.

**Architecture:** A new route handler orchestrates the existing `service.advance / startCycle / submitChecklist` methods in a server-side per-item loop (each in its own transaction, per-item try/catch → partial success). The tablet's online `handleSubmitQueue` / `handleChecklistSubmit` accumulate resolved ops and post them once; offline path and the offline-sync engine are untouched; the old per-item loop stays as a transport-level fallback.

**Tech Stack:** Fastify + Prisma + PostgreSQL (backend); React 19 + Vite + SWR + IndexedDB (frontend); vitest (both).

## Global Constraints

- **No Prisma schema / migration change.** Code + no shared constant. (Reauth reuses existing actions.)
- **Reuse existing service methods verbatim** — no cleaning logic reimplemented. `service.advance(ctx, filterId, data)`, `service.startCycle(ctx, filterId, data)`, `service.submitChecklist(ctx, filterId, data)` (`apps/api/src/modules/filter-operations/filter-operations.service.ts:70-81`).
- **Reauth** via `enforceReauth(actions[], req, reply)` (`apps/api/src/lib/reauth-check.ts:134`) — one call, over the union of actions the batch's kinds imply: `advance→ADVANCE_FILTER_STAGE`, `start-and-advance→START_CLEANING_CYCLE`, `submit-checklist→SUBMIT_CHECKLIST_WITH_SIGNATURE`.
- **Permission gate** `FILTER_OPERATE` (matches the single write routes).
- **Batch cap 200** → `400 BATCH_TOO_LARGE` above it. **`bypass` excluded.**
- **Partial success:** one item failing must not affect the others or roll back their audit rows.
- **Offline path untouched** — the bulk endpoint is online-only, gated on the existing `online` flag. Never touch `OFFLINE_SYNC_ARCHITECTURE.md` or the sync engine.
- **Backend tests run against `digilog_test_db`**; run the suite single-fork: `cd apps/api && npm test`.
- **Commit messages** end with the Co-Authored-By trailer used in this repo.

---

### Task 1: Backend `POST /api/filters/bulk-operate` endpoint

**Files:**
- Modify: `apps/api/src/modules/filter-operations/routes.ts` (add handler near the other write routes, after `/:id/bypass` ~line 450)
- Create: `apps/api/src/modules/filter-operations/cycle-write/bulk-operate.ts` (orchestration function)
- Create: `apps/api/src/e2e/bulk-operate.test.ts` (route-level e2e, mocked service)

**Interfaces:**
- Consumes: `service.advance / startCycle / submitChecklist(ctx, filterId, data)`; `enforceReauth`; `buildContext`.
- Produces: `bulkOperate(service, ctx, items)` → `Promise<{ results: BulkOpResult[] }>` where
  `BulkOpItem = { clientOpId: string; filterId: string; kind: 'advance'|'start-and-advance'|'submit-checklist'; payload?: any; cyclePayload?: any; advancePayload?: any }`
  and `BulkOpResult = { clientOpId: string; filterId: string; status: 'ok'; snapshot: any } | { clientOpId: string; filterId: string; status: 'failed'; error: { code: string; message: string } }`.

- [ ] **Step 1: Write the orchestration function**

Create `apps/api/src/modules/filter-operations/cycle-write/bulk-operate.ts`:

```typescript
import type { RequestContext } from '../../../lib/build-context.js';
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
 * → partial success: a failed filter does not affect the others.
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
```

- [ ] **Step 2: Register the route** in `apps/api/src/modules/filter-operations/routes.ts`

Add this import near the top (with the other `./cycle-write/...`-adjacent imports is fine; it's imported here directly):

```typescript
import { bulkOperate, reauthActionsForItems, type BulkOpItem } from './cycle-write/bulk-operate.js';
```

Add the handler after the `/:id/bypass` route (~line 450), before the retire/replace routes:

```typescript
  app.post('/bulk-operate', {
    preHandler: [app.requirePermission('FILTER_OPERATE')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Batch cleaning ops (advance / start-and-advance / submit-checklist) in one request',
      body: {
        type: 'object',
        required: ['items'],
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 200,
            items: {
              type: 'object',
              required: ['clientOpId', 'filterId', 'kind'],
              properties: {
                clientOpId: { type: 'string', maxLength: 100 },
                filterId: { type: 'string', format: 'uuid' },
                kind: { type: 'string', enum: ['advance', 'start-and-advance', 'submit-checklist'] },
                payload: { type: 'object', additionalProperties: true, maxProperties: MAX_OBJECT_PROPS },
                cyclePayload: { type: 'object', additionalProperties: true, maxProperties: MAX_OBJECT_PROPS },
                advancePayload: { type: 'object', additionalProperties: true, maxProperties: MAX_OBJECT_PROPS },
              },
            },
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { items } = req.body as { items: BulkOpItem[] };
    const { ok } = await enforceReauth(reauthActionsForItems(items), req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    return service.bulkOperate(ctx, items);
  });
```

- [ ] **Step 3: Add the thin service method** in `apps/api/src/modules/filter-operations/filter-operations.service.ts` (after the `advance` method, ~line 82):

```typescript
  async bulkOperate(ctx: RequestContext, items: BulkOpItem[]) {
    return bulkOperate(this, ctx, items);
  }
```

Add its import at the top of that file (near the other `./cycle-write/...` imports, lines 18-20):

```typescript
import { bulkOperate, type BulkOpItem } from './cycle-write/bulk-operate.js';
```

- [ ] **Step 4: Write the route-level e2e test** — mirror `apps/api/src/e2e/phase2-filter-operations.test.ts` (real auth + prisma, **mocked** `FilterOperationsService`).

Create `apps/api/src/e2e/bulk-operate.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, loginAs } from './test-helper.js';

// Mock the service so the test controls each method's return + can assert dispatch.
const advance = vi.fn();
const startCycle = vi.fn();
const submitChecklist = vi.fn();
const bulkOperateSpy = vi.fn();
vi.mock('../modules/filter-operations/filter-operations.service.js', () => ({
  FilterOperationsService: vi.fn().mockImplementation(() => ({
    advance, startCycle, submitChecklist,
    // real orchestration over the mocked single methods:
    bulkOperate: async (_ctx: any, items: any[]) => {
      bulkOperateSpy(items);
      const results = [];
      for (const it of items) {
        try {
          let snapshot;
          if (it.kind === 'advance') snapshot = await advance(_ctx, it.filterId, it.payload);
          else if (it.kind === 'start-and-advance') { await startCycle(_ctx, it.filterId, it.cyclePayload); snapshot = await advance(_ctx, it.filterId, it.advancePayload); }
          else snapshot = await submitChecklist(_ctx, it.filterId, it.payload);
          results.push({ clientOpId: it.clientOpId, filterId: it.filterId, status: 'ok', snapshot });
        } catch (e: any) {
          results.push({ clientOpId: it.clientOpId, filterId: it.filterId, status: 'failed', error: { code: e?.code ?? 'OP_FAILED', message: e?.message } });
        }
      }
      return { results };
    },
  })),
}));

const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

describe('POST /api/filters/bulk-operate', () => {
  let app: FastifyInstance;
  let token: string;
  beforeAll(async () => {
    app = await buildApp();
    const { default: routes } = await import('../modules/filter-operations/routes.js');
    await app.register(routes, { prefix: '/api/filters' });
    await app.ready();
    ({ token } = await loginAs(app, 'admin'));
    advance.mockResolvedValue({ filterId: 'x', currentState: 'WASH_OUT', tapeVersion: 2, actions: [] });
    startCycle.mockResolvedValue({ id: 'cyc' });
    submitChecklist.mockResolvedValue({ filterId: 'x', currentState: 'DRY_IN', tapeVersion: 3, actions: [] });
  });
  afterAll(async () => { await app.close(); });

  it('dispatches a mixed batch and returns per-item ok results', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/filters/bulk-operate',
      headers: { authorization: `Bearer ${token}` },
      payload: { items: [
        { clientOpId: 'a', filterId: uuid(1), kind: 'advance', payload: { targetState: 'WASH_OUT', tapeVersion: 1 } },
        { clientOpId: 'b', filterId: uuid(2), kind: 'start-and-advance', cyclePayload: { cleaningReasonKey: 'ROUTINE' }, advancePayload: { targetState: 'WASH_IN', tapeVersion: 1 } },
        { clientOpId: 'c', filterId: uuid(3), kind: 'submit-checklist', payload: { answers: {}, tapeVersion: 1 } },
      ] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toHaveLength(3);
    expect(body.results.every((r: any) => r.status === 'ok')).toBe(true);
    expect(startCycle).toHaveBeenCalledTimes(1);
    expect(advance).toHaveBeenCalledTimes(2); // advance item + start-and-advance's advance
    expect(submitChecklist).toHaveBeenCalledTimes(1);
  });

  it('returns partial success — one failed item does not fail the batch', async () => {
    advance.mockReset();
    advance.mockImplementationOnce(async () => { const e: any = new Error('stale'); e.code = 'STALE_TAPE'; throw e; });
    advance.mockResolvedValue({ filterId: 'x', currentState: 'WASH_OUT', tapeVersion: 2, actions: [] });
    const res = await app.inject({
      method: 'POST', url: '/api/filters/bulk-operate',
      headers: { authorization: `Bearer ${token}` },
      payload: { items: [
        { clientOpId: 'a', filterId: uuid(1), kind: 'advance', payload: { targetState: 'WASH_OUT', tapeVersion: 1 } },
        { clientOpId: 'b', filterId: uuid(2), kind: 'advance', payload: { targetState: 'WASH_OUT', tapeVersion: 1 } },
      ] },
    });
    const body = res.json();
    expect(body.results[0]).toMatchObject({ status: 'failed', error: { code: 'STALE_TAPE' } });
    expect(body.results[1]).toMatchObject({ status: 'ok' });
  });

  it('rejects >200 items with 400', async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ clientOpId: `k${i}`, filterId: uuid(1), kind: 'advance', payload: { targetState: 'X', tapeVersion: 1 } }));
    const res = await app.inject({ method: 'POST', url: '/api/filters/bulk-operate', headers: { authorization: `Bearer ${token}` }, payload: { items } });
    expect(res.statusCode).toBe(400);
  });

  it('requires auth (401 without token)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/filters/bulk-operate', payload: { items: [] } });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/api && npx vitest run src/e2e/bulk-operate.test.ts --pool=forks --poolOptions.forks.singleFork=true`
Expected: 4 tests PASS. (If the mock-registration order needs adjusting, follow the exact `vi.mock` + dynamic route `import()` ordering in `phase2-filter-operations.test.ts`.)

- [ ] **Step 6: Typecheck backend**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/filter-operations/cycle-write/bulk-operate.ts \
        apps/api/src/modules/filter-operations/routes.ts \
        apps/api/src/modules/filter-operations/filter-operations.service.ts \
        apps/api/src/e2e/bulk-operate.test.ts
git commit -m "feat(filter-ops): add POST /api/filters/bulk-operate batch endpoint

Orchestrates advance/start-and-advance/submit-checklist over the existing
single-op service methods (per-item tx, partial success). One reauth over
the union of implied actions. Additive — no client caller yet.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Client `bulkOperate` helper

**Files:**
- Create: `apps/web/src/lib/filter-ops/bulk-operate.ts`
- Create: `apps/web/src/lib/filter-ops/__tests__/bulk-operate.test.ts`

**Interfaces:**
- Consumes: `apiClient.post` / `apiClient.postWithReauth` (`apps/web/src/lib/api-client.ts`).
- Produces: `bulkOperate(items, password?)` → `Promise<{ results: BulkClientResult[] }>` with the same `results` shape the backend returns.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/filter-ops/__tests__/bulk-operate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api-client', () => ({
  apiClient: { post: vi.fn(), postWithReauth: vi.fn() },
}));
import { apiClient } from '@/lib/api-client';
import { bulkOperate } from '../bulk-operate';

describe('bulkOperate client helper', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('posts all items in one request and returns results', async () => {
    (apiClient.post as any).mockResolvedValue({ results: [{ clientOpId: 'a', filterId: 'f1', status: 'ok', snapshot: {} }] });
    const items = [{ clientOpId: 'a', filterId: 'f1', kind: 'advance' as const, payload: {} }];
    const out = await bulkOperate(items);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(apiClient.post).toHaveBeenCalledWith('/api/filters/bulk-operate', { items });
    expect(out.results).toHaveLength(1);
  });

  it('uses postWithReauth when a password is supplied', async () => {
    (apiClient.postWithReauth as any).mockResolvedValue({ results: [] });
    const items = [{ clientOpId: 'a', filterId: 'f1', kind: 'submit-checklist' as const, payload: {} }];
    await bulkOperate(items, 'pw');
    expect(apiClient.postWithReauth).toHaveBeenCalledWith('/api/filters/bulk-operate', { items }, 'pw');
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found)

Run: `cd apps/web && npx vitest run src/lib/filter-ops/__tests__/bulk-operate.test.ts`
Expected: FAIL — cannot resolve `../bulk-operate`.

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/lib/filter-ops/bulk-operate.ts`:

```typescript
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
```

- [ ] **Step 4: Run it — expect PASS**

Run: `cd apps/web && npx vitest run src/lib/filter-ops/__tests__/bulk-operate.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/filter-ops/bulk-operate.ts apps/web/src/lib/filter-ops/__tests__/bulk-operate.test.ts
git commit -m "feat(filter-ops-web): add bulkOperate client helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire the online `handleSubmitQueue` batch to `bulkOperate`

**Files:**
- Modify: `apps/web/src/routes/mobile/mobile-operations.tsx` — `handleSubmitQueue` (~line 823–1300) and its post-loop priming.

**Interfaces:**
- Consumes: `bulkOperate(items, password?)` from Task 2; `reauth.execute` (already used in this file).
- Produces: no new exports; behavior change only.

**This is the delicate integration. Change the leaf, preserve every gate.** The precise transformation:

- [ ] **Step 1:** At the top of `handleSubmitQueue`, add an accumulator alongside the existing snapshot vars:

```typescript
    const bulkOps: import('@/lib/filter-ops/bulk-operate').BulkClientItem[] = [];
```

- [ ] **Step 2:** Inside the loop, at each place that currently performs a network write **when `online`**, instead of awaiting the per-filter call, **push a resolved op** and `continue`. Concretely:
  - The mid-cycle advance leaf (`executeOrQueue('advance', …)` at ~line 1115): when `online`, push `{ clientOpId, filterId: item.filterId, kind: 'advance', payload: { targetState: activeStage.key, cleaningAreaId: selectedBlock?.id, remarks, tapeVersion } }` and `continue`. (Offline: leave the existing `executeOrQueue` path exactly as-is.)
  - The DRY_IN `SET_DURATION` advance (`core.advance({ … dryerAction:'SET_DURATION' … })` at ~line 1059): when `online`, push `{ clientOpId, filterId, kind: 'advance', payload: { targetState:'DRY_IN', cleaningAreaId, dryerAction:'SET_DURATION', dryerDurationMinutes: dur, remarks, tapeVersion } }` and `continue`.
  - The cycle-start path is dialog-driven and returns early (reason/equipment dialog); it re-enters via the equipment-submit handler which is a separate flow — leave it to Task 4-adjacent follow-up **only if** it currently posts per filter online; if it already batches via the reason dialog's `remainingBatch`, push `{ kind:'start-and-advance', cyclePayload, advancePayload }` at the point it would post.

  `clientOpId` for each: reuse the same client-op-id generation the offline queue uses (a `crypto.randomUUID()` per op) so replay/idempotency is consistent.

- [ ] **Step 3:** After the loop, replace the online post-loop block (the `if (online) { await mutate(...); await runWithConcurrency(queuedIds, 6, … /current-state …) }` at ~line 1261-1272) with a single bulk dispatch when `bulkOps.length > 0`:

```typescript
    if (online && bulkOps.length > 0) {
      let resp: { results: any[] };
      try {
        resp = await reauth.execute(
          bulkOps.some(o => o.kind === 'submit-checklist') ? 'SUBMIT_CHECKLIST_WITH_SIGNATURE'
            : bulkOps.some(o => o.kind === 'start-and-advance') ? 'START_CLEANING_CYCLE'
            : 'ADVANCE_FILTER_STAGE',
          (password?: string) => bulkOperate(bulkOps, password),
        );
      } catch (e: any) {
        const code = e?.error ?? e?.code;
        if (code === 'REAUTH_REQUIRED' || code === 'REAUTH_FAILED') throw e;
        // Transport-level failure → fall back to the legacy per-item loop for this submit.
        await submitQueuePerItemFallback(scanQueueSnapshot);  // see Step 5
        return;
      }
      // Apply results: prime caches from each ok snapshot; collect failures.
      for (const r of resp.results) {
        if (r.status === 'ok' && r.snapshot) {
          await cache(`filter-state-${r.filterId}`, r.snapshot, 24 * 60 * 60 * 1000);
          setRecentOps(prev => [{ stage: activeStage.label, filter: r.filterId, time: formatTime(new Date()), queued: false }, ...prev].slice(0, 20));
        } else if (r.status === 'failed') {
          failed.push(`${r.filterId}: ${r.error?.message ?? 'failed'}`);
        }
      }
      await mutate('/api/assets/instances', undefined, { revalidate: true });
    }
```

  (Keep the existing `successCount`/`failed` messaging that follows. Use the response's `ok` count for `successCount`.)

- [ ] **Step 4:** **Delete** the now-dead post-loop `runWithConcurrency(queuedIds, 6, …/current-state…)` priming block — the snapshots come from the bulk response. (Leave `runWithConcurrency` in the file; the checklist path in Task 4 and the offline path may still use it.)

- [ ] **Step 5:** Extract the **existing** online per-item loop body into a `submitQueuePerItemFallback(queue)` function (a near-verbatim copy of today's loop that posts per filter) so Step 3's fallback can call it. This preserves the old behavior exactly as the safety net. Do not delete the offline path.

- [ ] **Step 6: Typecheck**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Run existing filter-ops web tests** (ensure no regression):

Run: `cd apps/web && npx vitest run src/lib/filter-ops`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/routes/mobile/mobile-operations.tsx
git commit -m "feat(mobile-ops): route online batch submit through bulk-operate

handleSubmitQueue accumulates resolved ops and posts one /bulk-operate
request instead of N per-filter calls; primes caches from the response;
deletes the post-loop current-state storm. Offline path unchanged;
legacy per-item loop retained as a transport-level fallback.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire the batch checklist submit to `bulkOperate`

**Files:**
- Modify: `apps/web/src/routes/mobile/mobile-operations.tsx` — `handleChecklistSubmit` batch branch (~line 2274-2321).

**Interfaces:**
- Consumes: `bulkOperate` (Task 2), `reauth.execute`.

- [ ] **Step 1:** In the batch branch (the `for (const item of batch)` loop that calls `core.submitChecklist` per member, ~line 2275-2288), when `online`, build a `submit-checklist` bulk op per member instead of awaiting per item:

```typescript
      const ops = batch.map(item => ({
        clientOpId: crypto.randomUUID(),
        filterId: item.filterId,
        kind: 'submit-checklist' as const,
        payload: { answers: checklistAnswers, tapeVersion: /* the member's current tapeVersion */ item.tapeVersion },
      }));
      const resp = await reauth.execute('SUBMIT_CHECKLIST_WITH_SIGNATURE',
        (password?: string) => bulkOperate(ops, password));
      const failedNames: string[] = [];
      for (const r of resp.results) {
        if (r.status === 'ok' && r.snapshot) await cache(`filter-state-${r.filterId}`, r.snapshot, 24 * 60 * 60 * 1000);
        else if (r.status === 'failed') failedNames.push(r.filterId);
      }
```

  (Preserve the terminal-checklist detection + `willComplete` queue-clear that follows; replace only the per-item POST loop. Offline branch — unchanged.)

- [ ] **Step 2:** Replace the batch branch's post-loop `Promise.all(batch.map(... /current-state ...))` prime (~line 2315) — no longer needed; snapshots come from `resp.results`.

- [ ] **Step 3: Typecheck + tests**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json && npx vitest run src/lib/filter-ops`
Expected: no errors; tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/mobile/mobile-operations.tsx
git commit -m "feat(mobile-ops): batch checklist submit via bulk-operate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Real end-to-end verification + measurement

**Files:** none (verification only).

- [ ] **Step 1:** Rebuild web + start API. `cd apps/api && npx tsx watch src/app.ts` (restart — tsx watch is stale-prone on Windows). `cd apps/web && npx vite --host`.

- [ ] **Step 2:** Confirm TLS: `curl -sk -o /dev/null -w "%{http_code}" https://localhost:3000/health` returns a code.

- [ ] **Step 3:** Use the `manual-tester` skill (or Playwright) to drive `http://localhost:5175/m`: log in, select a block, scan/enter ~30–50 filters at a stage (mix of new-cycle + mid-cycle), Submit. Confirm: one `POST /api/filters/bulk-operate` in the network tab (not N calls); all filters land in the correct state; the Currently-Drying panel populates; failures (if any) show per-filter.

- [ ] **Step 4:** Verify audit integrity: `curl -sk https://localhost:3000/api/audit/verify-chain -H "Authorization: Bearer <token>"` → valid; one ordered audit row per submitted op.

- [ ] **Step 5:** Measure: record wall-clock for the 50-filter submit before (git stash the client wiring) vs after. Note the numbers in the CHANGELOG entry (Task 6). No console errors, no unstyled UI.

- [ ] **Step 6 (tablet):** Rebuild APK (`cd apps/web && npx vite build; cd ../android && npx cap copy android && cd android && ./gradlew assembleDebug`), sideload, and take one real tablet timing.

---

### Task 6: Doc sync + memory

**Files:**
- Modify: `CHANGELOG.md`, `API_REFERENCE.md`, `CLAUDE.md` (root), `apps/api/CLAUDE.md` (endpoint list).
- Create: a memory note.

- [ ] **Step 1:** Add the endpoint to `API_REFERENCE.md` and the "Key API Endpoints (filter operations)" block in root `CLAUDE.md` + `apps/api/CLAUDE.md`:
  `POST /api/filters/bulk-operate — Batch advance / start-and-advance / submit-checklist in one request (partial success)`.

- [ ] **Step 2:** Add a `CHANGELOG.md` entry with the measured before/after numbers from Task 5.

- [ ] **Step 3:** Write a memory file `project_bulk_filter_operate_2026_07_09.md` (+ `MEMORY.md` pointer): what the endpoint is, that it reuses the single-op service methods, reauth-via-existing-actions, offline untouched, fallback retained.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md API_REFERENCE.md CLAUDE.md apps/api/CLAUDE.md
git commit -m "docs: bulk filter-operate endpoint + measured perf numbers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **Tasks 3 & 4 are the risk.** `handleSubmitQueue`/`handleChecklistSubmit` carry hard-won behavior (DRY_IN replay via `pendingBatchReplayRef`, terminal-checklist suppression, cross-block gate, AHU pre-flight). Preserve every branch; change only the execute-leaf. If a branch's exact tapeVersion/payload source is unclear, read how the current `core.advance`/`core.submitChecklist` call at that spot builds its payload and mirror it into the bulk op.
- **Do not touch** the offline `executeOrQueue` branches, `sync-engine.ts`, or `OFFLINE_SYNC_ARCHITECTURE.md`.
- **After Task 1**, the endpoint is live and testable with `curl` before any client change — verify it there first.
