// The WRITE path: tablet operators driving cleaning cycles end to end, shift
// officers approving the gated stages, everyone else idling at a desktop.
//
//   OPERATOR     — takes a filter with no cycle, starts it, then does whatever the
//                  server's decision tape (`actions`) offers: checklists, dryer
//                  duration (1 min) + readings, stage advances with instrument
//                  readings, until the cycle completes. Waits (polling
//                  current-state every 15 s, like the Dry In panel) while an
//                  interlock approval or the dryer half-time blocks it.
//   SHIFTOFFICER — polls the approvals queue every 30 s and approves everything
//                  (bulk-decide when > 1 row), as the Stage Approvals page does.
//   other roles  — unread-count poll every 30 s (a desktop user sitting there).
//
// Writes are real, audited rows on the *_perf clone (never a real database — the
// runner refuses :3000). Each write carries a clientOpId like the tablet's.
// `--speed N` divides think times; the dryer minute and the 15/30 s polls are
// also divided (they are what the app does, but the stress runs want more
// writes per second, not more patience).
import { randomUUID } from 'node:crypto';
import { request, sleep, jitter } from '../../lib/http.mjs';

const PW = 'PerfTest@2026!';            // synthetic accounts only (perf-users.json)
const REASON = process.env.PERF_CLEANING_REASON ?? 'FILTER'; // 'PM' exercises the missed-PM gate

const L = {
  state: 'GET /api/filters/:id/current-state',
  wait: 'GET /api/filters/:id/current-state (waiting)',
  start: 'POST /api/filters/:id/start-cycle',
  advance: 'POST /api/filters/:id/advance',
  checklist: 'POST /api/filters/:id/submit-checklist',
  queue: 'GET /api/stage-approvals/queue',
  approve: 'POST /api/stage-approvals/:id/approve',
  bulk: 'POST /api/stage-approvals/bulk-decide',
  cycle: 'CYCLE COMPLETED (wall time)',
  unread: 'GET /api/notifications/unread-count',
};

export async function setup({ target, agent, token, users }) {
  const ctx = { target, agent, token };
  // one batch call = every filter's state (fix 6 made this ~1 s); one list of groups
  const bs = await request(ctx, 'GET', '/api/filters/batch-states', { parse: true, timeoutMs: 120_000 });
  if (bs.status !== 200) throw new Error(`batch-states ${bs.status}: cannot find idle filters`);
  const eg = await request(ctx, 'GET', '/api/equipment-groups', { parse: true });
  const groups = eg.json?.data ?? eg.json ?? [];
  const groupByBlock = new Map(groups.filter((g) => g.isActive !== false).map((g) => [g.blockId, g.id]));
  const idle = Object.values(bs.json.states)
    .filter((s) => !s.currentCycle && s.homeBlock?.id)
    .map((s) => ({ id: s.filterId, name: s.filterName, blockId: s.homeBlock.id }));
  const operators = users.filter((u) => u.role === 'OPERATOR').map((u) => u.username);
  console.log(`setup: ${idle.length} idle filters, ${groupByBlock.size} equipment groups, ${operators.length} operators, ${users.filter((u) => u.role === 'SHIFTOFFICER').length} shift officers`);
  return { idle, groupByBlock, operators };
}

export async function vu(ctx) {
  if (ctx.user.role === 'OPERATOR') return operator(ctx);
  if (ctx.user.role === 'SHIFTOFFICER') return approver(ctx);
  return desktopIdle(ctx);
}

// ---- operator ---------------------------------------------------------------
async function operator(ctx) {
  const speed = ctx.speed || 1;
  const rank = ctx.shared.operators.indexOf(ctx.user.username);
  const n = ctx.shared.operators.length;
  const mine = ctx.shared.idle.filter((_, i) => i % n === rank);   // disjoint filters per operator
  let k = 0;
  while (!ctx.stopped && mine.length) {
    const f = mine[k++ % mine.length];
    const t0 = Date.now();
    const done = await runCycle(ctx, f, speed);
    if (done) ctx.metrics.record(L.cycle, 200, Date.now() - t0, 0);
    await sleep(jitter(10_000 / speed, 0.5));               // walk to the next filter
  }
}

const post = (ctx, path, body, label) => request(ctx, 'POST', path, { body, label, parse: true });
const stateOf = (ctx, id, label = L.state) => request(ctx, 'GET', `/api/filters/${id}/current-state`, { label, parse: true });

async function runCycle(ctx, f, speed) {
  let st = await stateOf(ctx, f.id);
  if (st.status !== 200) return false;
  let s = st.json;
  if (!s.currentCycle) {
    const body = {
      cleaningReasonKey: REASON, cleaningAreaId: f.blockId, clientOpId: randomUUID(), _currentPassword: PW,
      ...(ctx.shared.groupByBlock.get(f.blockId) ? { equipmentGroupId: ctx.shared.groupByBlock.get(f.blockId) } : {}),
    };
    let r = await post(ctx, `/api/filters/${f.id}/start-cycle`, body, L.start);
    if (r.status === 409 && r.json?.error === 'PM_PREVIOUS_TASK_PENDING') {
      const pmSkips = (r.json.details?.pendingPmTasks ?? []).map((t) => ({ entryId: t.entryId ?? t.id, reason: 'Perf test: earlier visit written off' }));
      r = await post(ctx, `/api/filters/${f.id}/start-cycle`, { ...body, clientOpId: randomUUID(), pmSkips }, L.start);
    }
    if (r.status !== 200 && r.status !== 201) return false;     // refused (409 business rule) — recorded by status
    s = r.json?.actions ? r.json : (await stateOf(ctx, f.id)).json;
  }
  for (let step = 0; step < 60 && !ctx.stopped; step++) {
    if (!s?.currentCycle) return true;                           // completed
    const acts = s.actions ?? [];
    const pick = acts.find((a) => a.type === 'SUBMIT_CHECKLIST')
      ?? acts.find((a) => a.type === 'SUBMIT_DRYER_READINGS')
      ?? acts.find((a) => a.type === 'SET_DRYER_DURATION')
      ?? acts.find((a) => a.type === 'ADVANCE_TO_STAGE')
      ?? acts.find((a) => a.type === 'COMPLETE_CYCLE');
    if (!pick) {
      // blocked: interlock approval pending or dryer half-time — wait like the app does
      await sleep(jitter(15_000 / speed, 0.2));
      const w = await stateOf(ctx, f.id, L.wait);
      if (w.status !== 200) return false;
      s = w.json;
      continue;
    }
    await sleep(jitter(8_000 / speed, 0.6));                    // operator think / scan time
    let r;
    const p = pick.params ?? {};
    if (pick.type === 'SUBMIT_CHECKLIST') {
      const answers = Object.fromEntries((p.questions ?? []).map((q) => [q.id, answerFor(q)]));
      r = await post(ctx, `/api/filters/${f.id}/submit-checklist`, { answers, tapeVersion: s.tapeVersion, clientOpId: randomUUID(), _currentPassword: PW }, L.checklist);
    } else if (pick.type === 'SET_DRYER_DURATION') {
      r = await post(ctx, `/api/filters/${f.id}/advance`, { targetState: 'DRY_IN', tapeVersion: s.tapeVersion, dryerAction: 'SET_DURATION', dryerDurationMinutes: 1, clientOpId: randomUUID(), _currentPassword: PW }, L.advance);
    } else if (pick.type === 'SUBMIT_DRYER_READINGS') {
      r = await post(ctx, `/api/filters/${f.id}/advance`, { targetState: 'DRY_IN', tapeVersion: s.tapeVersion, dryerAction: 'SUBMIT_READINGS', ...readings(p.instrumentIds, pick.validations?.operatingRanges), clientOpId: randomUUID(), _currentPassword: PW }, L.advance);
    } else if (pick.type === 'ADVANCE_TO_STAGE') {
      r = await post(ctx, `/api/filters/${f.id}/advance`, { targetState: p.targetState, tapeVersion: s.tapeVersion, ...readings(p.requiresInstrumentReadings, pick.validations?.operatingRanges), clientOpId: randomUUID(), _currentPassword: PW }, L.advance);
    } else { // COMPLETE_CYCLE
      r = await post(ctx, `/api/filters/${f.id}/advance`, { targetState: 'CLEANING_CYCLE_COMPLETED', tapeVersion: s.tapeVersion, clientOpId: randomUUID(), _currentPassword: PW }, L.advance);
    }
    if (r.status === 200 && r.json?.tapeVersion !== undefined) { s = r.json; continue; }
    // 409 (STALE_TAPE / business rule) and 423 (STAGE_APPROVAL_PENDING: the tape
    // offered the step but the interlock holds it) — re-read the truth and carry
    // on from it, as the tablet does. Anything else is unexpected: keep a sample
    // and give the filter up.
    if (r.status !== 409 && r.status !== 423) {
      ctx.metrics.errorSamples.push({ key: `${pick.type} ${r.status}`, body: JSON.stringify(r.json)?.slice(0, 300) });
      return false;
    }
    if (r.status === 423) await sleep(jitter(15_000 / speed, 0.2));
    const w = await stateOf(ctx, f.id, r.status === 423 ? L.wait : L.state);
    if (w.status !== 200) return false;
    s = w.json;
  }
  return false;
}

function readings(ids, ranges) {
  if (!ids?.length) return {};
  const instrumentReadings = {}, readingSources = {};
  for (const id of ids) {
    const rg = ranges?.[id];
    const v = rg && Number.isFinite(rg.min) && Number.isFinite(rg.max) ? (rg.min + rg.max) / 2 : 1;
    instrumentReadings[id] = Math.round(v * 10) / 10; readingSources[id] = 'MANUAL';
  }
  return { instrumentReadings, readingSources };
}

function answerFor(q) {
  // ChecklistQuestionType: YES_NO PASS_FAIL YES_NO_NA TEXT NUMERIC DROPDOWN MULTI_SELECT DATE_TIME
  const t = String(q.questionType ?? q.type ?? 'YES_NO').toUpperCase();
  const opts = (Array.isArray(q.options) ? q.options : []).map((o) => (typeof o === 'string' ? o : (o.value ?? o.label ?? 'OK')));
  if (t.startsWith('YES')) return 'Yes';
  if (t === 'PASS_FAIL') return 'Pass';
  if (t === 'NUMERIC') return 1;
  if (t === 'DATE_TIME') return new Date().toISOString();
  if (t === 'MULTI_SELECT') return opts.length ? [opts[0]] : [];
  if (t === 'DROPDOWN') return opts[0] ?? 'OK';
  return 'OK';
}

// ---- shift officer ------------------------------------------------------------
async function approver(ctx) {
  const speed = ctx.speed || 1;
  while (!ctx.stopped) {
    const q = await request(ctx, 'GET', '/api/stage-approvals/queue', { label: L.queue, parse: true });
    const rows = q.json?.data ?? [];
    if (rows.length > 1) {
      await post(ctx, '/api/stage-approvals/bulk-decide', { ids: rows.map((r) => r.id), action: 'approve', remarks: 'Approved (perf test)', _currentPassword: PW }, L.bulk);
    } else if (rows.length === 1) {
      await post(ctx, `/api/stage-approvals/${rows[0].id}/approve`, { remarks: 'Approved (perf test)', _currentPassword: PW }, L.approve);
    }
    await sleep(jitter(30_000 / speed, 0.2));
  }
}

// ---- everyone else ------------------------------------------------------------
async function desktopIdle(ctx) {
  const speed = ctx.speed || 1;
  while (!ctx.stopped) {
    await request(ctx, 'GET', '/api/notifications/unread-count', { label: L.unread });
    await sleep(jitter(30_000 / speed, 0.2));
  }
}
