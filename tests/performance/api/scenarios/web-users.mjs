// "Real users sitting in the app" — the background load that exists before anyone
// does any work. Each virtual user behaves like one person with one visible tab:
// opens a page (its first-load waterfall), then runs that page's timers at the
// intervals the web app really uses, and moves to another page every few minutes.
//
// Pages, URLs and intervals are taken from docs/production-readiness/05a_FRONTEND_STATIC_AUDIT.md
// (file:line evidence there). `--speed N` divides every interval by N (stress only).
// Mix: OPERATOR users are tablets on /m, other roles desktop users; lib/auth.mjs
// orders the pool so PERF_TABLET_SHARE (default 0.4) of the first N are operators.
import { request, sleep, jitter } from '../../lib/http.mjs';

const ALL = 1000000; // the web app's ALL_ROWS constant

// 2026-10-17 operator-approved changes to the app's polling (CHANGELOG). The
// scenario models the NEW behaviour; PERF_LEGACY_POLLING=1 replays the old one
// for before/after comparison.
const LEGACY = process.env.PERF_LEGACY_POLLING === '1';
const SINCE_30D = encodeURIComponent(new Date(Date.now() - 30 * 86_400_000).toISOString());
const CYCLES_URL = `/api/filters/cycles?limit=${ALL}&includeEvents=true${LEGACY ? '' : `&from=${SINCE_30D}`}`;
const APPROVALS_ALL_URL = LEGACY ? '/api/stage-approvals' : `/api/stage-approvals?from=${SINCE_30D}`;

// Every desktop page also runs these (header badge, sync engine, offline config).
const DESKTOP_GLOBAL = [
  { url: '/api/notifications/unread-count', every: 30 },
  { url: 'SYNC_SINCE', every: 60 },
  { url: '/api/config/offline-cache/current', every: 300 },
];
const TABLET_GLOBAL = [
  { url: '/api/health', every: 15 },
  { url: 'SYNC_SINCE', every: 60 },
  { url: '/api/config/offline-cache/current', every: 300 },
  { url: `/api/notifications?limit=${ALL}`, every: 60 },
  { url: '/api/pm-schedules/due', every: 120 },
  { url: '/api/replacement-schedules/tasks', every: 30 },
];

const DESKTOP_PAGES = {
  dashboard: {
    primary: 3, // dashboard-stats
    load: ['/api/users/stats', '/api/audit?limit=1', '/api/notifications?limit=1', '/api/filters/dashboard-stats',
      '/api/config/dashboard-cards/current', '/api/config/datetime/current'],
    polls: [
      { url: '/api/users/stats', every: 30 }, { url: '/api/audit?limit=1', every: 30 },
      { url: '/api/notifications?limit=1', every: 30 }, { url: '/api/filters/dashboard-stats', every: 20 },
    ],
  },
  filterList: {
    primary: 2, // hierarchy/tree
    load: ['/api/filters/field-options', '/api/assets/templates', '/api/hierarchy/tree', '/api/assets/identifiers',
      '/api/config/export-limit/current', '/api/config/pagination/current', '/api/config/action-reauth/my-actions',
      '/api/config/datetime/current'],
    polls: [{ url: '/api/hierarchy/tree', every: 30 }],
  },
  stageApprovals: {
    load: ['/api/stage-approvals/queue', APPROVALS_ALL_URL, '/api/config/action-reauth/my-actions', '/api/config/datetime/current'],
    polls: [{ url: '/api/stage-approvals/queue', every: 30 }],
  },
  myTasks: {
    load: ['/api/pm-schedules/due', '/api/hierarchy/blocks', '/api/hierarchy/areas', '/api/config/datetime/current'],
    polls: [{ url: '/api/pm-schedules/due', every: 30 }],
  },
  cleaningRecord: {
    primary: 2, // cleaning-record
    load: ['/api/hierarchy/filters', '/api/hierarchy/blocks', '/api/filters/cleaning-record?page=1&limit=25',
      '/api/config/export-limit/current', '/api/config/report-labels/current', '/api/config/pagination/current',
      '/api/config/action-reauth/my-actions', '/api/config/datetime/current'],
    polls: [],
    // a user on this page pages through history now and then
    actions: [{ url: () => `/api/filters/cleaning-record?page=${1 + Math.floor(Math.random() * 20)}&limit=25`, every: 45 }],
  },
  filterOps: {
    load: ['/api/assets/instances', '/api/hierarchy/filters', '/api/config/action-reauth/my-actions'],
    polls: [{ url: '/api/assets/instances', every: 30 }, { url: '/api/hierarchy/filters', every: 30 }, { url: '/api/health', every: 15 }],
  },
};
const DESKTOP_WEIGHTS = [['dashboard', 3], ['filterList', 2], ['stageApprovals', 1], ['myTasks', 1], ['cleaningRecord', 2], ['filterOps', 1]];

const TABLET_PAGES = {
  operations: {
    load: ['/api/assets/instances', '/api/assets/identifiers', '/api/replacement-schedules/blocked-filters',
      '/api/hierarchy/blocks', '/api/hierarchy/areas', '/api/filters/batch-states',
      `/api/block-change-requests?status=APPROVED&limit=${ALL}`, '/api/config/cleaning-profile-assignment/current'],
    polls: [
      { url: '/api/assets/instances', every: 30 }, { url: '/api/assets/identifiers', every: 30 },
      { url: '/api/replacement-schedules/blocked-filters', every: 30 },
      // offline-cache refresh: was tied to the 30 s instances poll; now every 5 min while online
      { url: '/api/filters/batch-states', every: LEGACY ? 30 : 300 },
    ],
  },
  cycles: {
    load: [CYCLES_URL],
    polls: [{ url: CYCLES_URL, every: 30 }],
  },
  approvals: {
    load: ['/api/stage-approvals/queue', APPROVALS_ALL_URL],
    polls: [{ url: '/api/stage-approvals/queue', every: 30 }],
  },
};
const TABLET_WEIGHTS = [['operations', 6], ['cycles', 2], ['approvals', 1]];

function pick(weights) {
  const total = weights.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of weights) { if ((r -= w) <= 0) return k; }
  return weights[0][0];
}

function syncSinceUrl(first) {
  if (first) return '/api/sync/since?profileVersion=0&filterProfileVersion=0&equipmentGroupVersion=0&checklistVersion=0&assetTemplateVersion=0';
  const since = new Date(Date.now() - 60_000).toISOString();
  return `/api/sync/since?profileVersion=999999&filterProfileVersion=999999&equipmentGroupVersion=999999&checklistVersion=999999&assetTemplateVersion=999999&filterUpdatedSince=${encodeURIComponent(since)}`;
}

function labelOf(url) {
  const [p, q = ''] = url.split('?');
  const suffix = q.includes('limit=1000000') ? '?limit=ALL' : q === 'limit=1' ? '?limit=1' : '';
  return 'GET ' + p.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id') + suffix;
}

// WHAT-IF ONLY: PERF_SKIP_URLS=/api/filters/batch-states,... never sends those
// requests, to measure what fixing one endpoint would buy. Label such runs.
const SKIP = (process.env.PERF_SKIP_URLS ?? '').split(',').filter(Boolean);

async function get(ctx, url) {
  if (SKIP.some((s) => url.startsWith(s))) return { status: -1 };
  const u = url === 'SYNC_SINCE' ? syncSinceUrl(!ctx.synced) : url;
  if (url === 'SYNC_SINCE') ctx.synced = true;
  return request(ctx, 'GET', u, { label: url === 'SYNC_SINCE' ? 'GET /api/sync/since' : labelOf(u) });
}

export async function vu(ctx) {
  // operators work on tablets; every other role at a desktop (lib/auth.mjs mixes the pool)
  const tablet = ctx.user.role === 'OPERATOR';
  ctx.persona = tablet ? 'tablet' : 'desktop';
  const speed = ctx.speed || 1;
  // PERF_EXCLUDE_PAGES=cycles,... leaves pages out (documented per run).
  const excluded = new Set((process.env.PERF_EXCLUDE_PAGES ?? '').split(',').filter(Boolean));
  const forbidden = new Set();
  while (!ctx.stopped) {
    const weights = (tablet ? TABLET_WEIGHTS : DESKTOP_WEIGHTS).filter(([k]) => !excluded.has(k) && !forbidden.has(k));
    if (weights.length === 0) { await sleep(5000); continue; }
    const pageName = pick(weights);
    const page = (tablet ? TABLET_PAGES : DESKTOP_PAGES)[pageName];
    // first-load waterfall: the browser fires these together (max 6 sockets per agent)
    const loaded = await Promise.all(page.load.map((u) => get(ctx, u)));
    // The app's menu hides a page whose data the role may not read, so a real user
    // never sits on it: a 403 on the page's MAIN request (load[primary]) drops the
    // page for this user. 403s on secondary cards are kept (the app makes them too).
    if (loaded[page.primary ?? 0]?.status === 403) { forbidden.add(pageName); continue; }
    const now = Date.now();
    const timers = [...(tablet ? TABLET_GLOBAL : DESKTOP_GLOBAL), ...page.polls, ...(page.actions ?? [])]
      .map((t) => ({ ...t, next: now + jitter((t.every * 1000) / speed, 0.5) }));
    const leaveAt = now + jitter((180_000) / speed, 0.5); // ~3 min on a page
    while (!ctx.stopped && Date.now() < leaveAt) {
      timers.sort((a, b) => a.next - b.next);
      const t = timers[0];
      const wait = t.next - Date.now();
      if (wait > 0) await sleep(Math.min(wait, 1000));
      if (Date.now() < t.next) continue;
      t.next = Date.now() + jitter((t.every * 1000) / speed, 0.05);
      // SWR fires on schedule and skips a key that is still in flight (dedupe) —
      // so a slow server does not make the client back off, it just skips a tick.
      if (t.inflight) continue;
      t.inflight = true;
      get(ctx, typeof t.url === 'function' ? t.url() : t.url).finally(() => { t.inflight = false; });
    }
  }
}
