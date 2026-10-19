// Tablet batch submit: an operator scans PERF_BULK_SIZE tags (default 50) and
// sends ONE POST /api/filters/bulk-operate with a start-and-advance item per
// filter (start the cycle, advance into WASH_IN with the two instrument readings).
// This is the request that holds the global audit lock longest — every item is
// its own transaction with its own audit rows, serialised behind the one
// advisory lock (lib/audit.ts) — so several operators submitting at once is the
// contention case the read-only runs could not show.
//
//   OPERATOR  — repeats: build a batch of idle filters from its own block,
//               submit, record per-item outcomes, think PERF_BULK_THINK_SEC
//               (default 60 / speed) like an operator walking to the next rack.
//   others    — unread-count poll every 30 s.
// Writes are real, audited rows on the *_perf clone only (runner refuses :3000).
import { randomUUID } from 'node:crypto';
import { request, sleep, jitter } from '../../lib/http.mjs';

const PW = 'PerfTest@2026!';
const SIZE = Number(process.env.PERF_BULK_SIZE ?? 50);
const THINK = Number(process.env.PERF_BULK_THINK_SEC ?? 60);
const REASON = process.env.PERF_CLEANING_REASON ?? 'FILTER';

export async function setup({ target, agent, token, users }) {
  const ctx = { target, agent, token };
  const bs = await request(ctx, 'GET', '/api/filters/batch-states', { parse: true, timeoutMs: 120_000 });
  if (bs.status !== 200) throw new Error(`batch-states ${bs.status}`);
  const eg = await request(ctx, 'GET', '/api/equipment-groups', { parse: true });
  const groups = (eg.json?.data ?? eg.json ?? []).filter((g) => g.isActive !== false);
  const groupByBlock = new Map(groups.map((g) => [g.blockId, g]));
  const byBlock = new Map();
  for (const s of Object.values(bs.json.states)) {
    if (s.currentCycle || !s.homeBlock?.id) continue;
    if (!byBlock.has(s.homeBlock.id)) byBlock.set(s.homeBlock.id, []);
    byBlock.get(s.homeBlock.id).push({ id: s.filterId, name: s.filterName, blockId: s.homeBlock.id });
  }
  const operators = users.filter((u) => u.role === 'OPERATOR').map((u) => u.username);
  // deal the blocks' idle filters out to operators in disjoint slices
  const slices = operators.map(() => []);
  let k = 0;
  for (const list of byBlock.values()) for (const f of list) slices[k++ % slices.length].push(f);
  console.log(`setup: ${[...byBlock.values()].reduce((a, l) => a + l.length, 0)} idle filters in ${byBlock.size} blocks, ${operators.length} operators, batch ${SIZE}`);
  return { slices, operators, groupByBlock };
}

export async function vu(ctx) {
  if (ctx.user.role !== 'OPERATOR') return idle(ctx);
  const speed = ctx.speed || 1;
  const rank = ctx.shared.operators.indexOf(ctx.user.username);
  const mine = ctx.shared.slices[rank] ?? [];
  let pos = 0;
  while (!ctx.stopped && pos < mine.length) {
    // one batch = filters of ONE block (the tablet is in one block at a time)
    const blockId = mine[pos].blockId;
    const batch = [];
    while (pos < mine.length && batch.length < SIZE && mine[pos].blockId === blockId) batch.push(mine[pos++]);
    const group = ctx.shared.groupByBlock.get(blockId);
    const items = batch.map((f) => ({
      clientOpId: randomUUID(), filterId: f.id, kind: 'start-and-advance',
      cyclePayload: { cleaningReasonKey: REASON, cleaningAreaId: blockId, ...(group ? { equipmentGroupId: group.id } : {}), clientOpId: randomUUID() },
      advancePayload: { targetState: 'WASH_IN', ...readingsFor(group, 'WASH_IN'), clientOpId: randomUUID() },
    }));
    const r = await request(ctx, 'POST', '/api/filters/bulk-operate', {
      body: { items, _currentPassword: PW }, label: `POST /api/filters/bulk-operate (${SIZE} items)`, parse: true, timeoutMs: 180_000,
    });
    const results = r.json?.results ?? [];
    const ok = results.filter((x) => x.status === 'ok').length;
    ctx.metrics.record('bulk item ok', 200, 0, 0);
    for (const x of results) {
      if (x.status !== 'ok') ctx.metrics.record(`bulk item failed ${x.error?.code ?? '?'}`, 409, 0, 0);
    }
    if (r.status === 200) ctx.metrics.record(`bulk batch: ${ok}/${items.length} ok`, 200, r.ms, 0);
    await sleep(jitter((THINK * 1000) / speed, 0.3));
  }
}

function readingsFor(group, stageKey) {
  const insts = (group?.instruments ?? []).filter((i) => i.stageKey === stageKey);
  if (!insts.length) return {};
  const instrumentReadings = {}, readingSources = {};
  for (const i of insts) {
    const v = Number.isFinite(i.operatingMin) && Number.isFinite(i.operatingMax) ? (i.operatingMin + i.operatingMax) / 2 : 1;
    instrumentReadings[i.id] = Math.round(v * 10) / 10; readingSources[i.id] = 'MANUAL';
  }
  return { instrumentReadings, readingSources };
}

async function idle(ctx) {
  const speed = ctx.speed || 1;
  while (!ctx.stopped) {
    await request(ctx, 'GET', '/api/notifications/unread-count', { label: 'GET /api/notifications/unread-count' });
    await sleep(jitter(30_000 / speed, 0.2));
  }
}
