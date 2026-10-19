/**
 * Synthetic production-volume data for performance testing — digilog_perf ONLY.
 *
 *   cd apps/api
 *   npx tsx ../../tests/performance/data-generation/seed-perf-db.ts --scale 1 --users 300
 *
 * See README.md next to this file for the data model, the choices made, and how
 * to start over. Hard rules enforced here:
 *   - refuses (before connecting) unless the database name ends in `_perf`;
 *   - never runs migrate / db push / reset; never edits application source;
 *   - every audit_trail row is hash-chain valid: the checksum is the app's own
 *     computeChainedChecksumV3 (lib/hash-chain.ts) over the exact field set
 *     lib/audit.ts hashes, written under the app's advisory lock, and each row is
 *     re-verified in memory with the app's verifyAuditChecksum before insert.
 *     USER_CREATED rows go through the real lib/audit.ts auditLog() so both
 *     writers interleave on one chain.
 *
 * Resumable at DAY granularity: each simulated day (cycles, events, stage
 * approvals, deviations and its audit rows) is ONE transaction; a re-run
 * continues after the last committed day. Setup steps are idempotent by name.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootstrapPerfEnv, argValue, hasFlag, assertConnectedToPerf, RESULTS_DIR } from './perf-env.js';

const { dbName } = bootstrapPerfEnv();   // throws before any connection if not *_perf

const { prisma } = await import('../../../apps/api/src/lib/prisma.js');
const { auditLog } = await import('../../../apps/api/src/lib/audit.js');
const { computeChainedChecksumV3, verifyAuditChecksum, getAuditChainKey } = await import('../../../apps/api/src/lib/hash-chain.js');
const { hashPassword } = await import('../../../apps/api/src/lib/password.js');
const { computeChecksum: eventChecksum } = await import('../../../apps/api/src/modules/filter-operations/helpers.js');
const { formatConfiguredDate } = await import('../../../apps/api/src/lib/format-datetime.js');

// ─────────────────────────────── options ───────────────────────────────
const SCALE = Number(argValue('--scale') ?? '1');
const N_USERS = Number(argValue('--users') ?? '300');
const CYCLES_PER_DAY = Number(argValue('--cycles-per-day') ?? '1500');
const N_BLOCKS = Number(argValue('--blocks') ?? '5');
const N_AHUS = Number(argValue('--ahus') ?? '150');
const N_FILTERS = Number(argValue('--filters') ?? '3000');
const MAX_DAYS_THIS_RUN = argValue('--max-days') ? Number(argValue('--max-days')) : Infinity;
const START_DATE_ARG = argValue('--start-date');            // YYYY-MM-DD, first run only
const DO_VERIFY = hasFlag('--verify');
const PASSWORD = 'PerfTest@2026!';
const PREFIX = 'PF';                                         // every synthetic hierarchy name starts with "PF-"
const AUDIT_CHAIN_LOCK_ID = 7421151037n;                     // = lib/audit.ts AUDIT_CHAIN_LOCK_ID
const DAY_MS = 86_400_000;
const PM_TOLERANCE_DAYS = 3;
const PM_MISS_RATE = 0.04;

if (!(SCALE > 0)) throw new Error('--scale must be > 0');
if (!(N_USERS >= 10)) throw new Error('--users must be >= 10');

const TABLET_UA = 'Dalvik/2.1.0 (Linux; U; Android 15; TB330XU Build/AP3A.240905.015.A2)';
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

// ─────────────────────────────── helpers ───────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const randInt = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rng, xs: T[]): T => xs[Math.floor(r() * xs.length)];
const pad = (n: number, w: number) => String(n).padStart(w, '0');
const ymdLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
const addMs = (d: Date, ms: number) => new Date(d.getTime() + ms);
const MIN = 60_000;
const prettyStage = (k: string) => k.split('_').map(s => s.charAt(0) + s.slice(1).toLowerCase()).join(' ');
const roundTo = (v: number, step: number) => Math.round(Math.round(v / step) * step * 1000) / 1000;
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Bulk insert through json_populate_recordset: one bound parameter per chunk. */
async function insertRows(tx: any, table: string, rows: Record<string, unknown>[], chunk = 4000, returning?: string): Promise<any[]> {
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  const colList = cols.map(c => `"${c}"`).join(', ');
  const out: any[] = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    for (const r of part) if (Object.keys(r).length !== cols.length) throw new Error(`insertRows(${table}): ragged row keys`);
    const sql = `INSERT INTO "${table}" (${colList}) SELECT ${colList} FROM json_populate_recordset(NULL::"${table}", $1::json)` + (returning ? ` RETURNING ${returning}` : '');
    if (returning) out.push(...await tx.$queryRawUnsafe(sql, JSON.stringify(part)));
    else await tx.$executeRawUnsafe(sql, JSON.stringify(part));
  }
  return out;
}

// ───────────────────────────── audit writer ─────────────────────────────
// Mirrors lib/audit.ts exactly (field set, cleaning, signatureAuditId-only-when-
// present, system-action userId rule); the checksum itself is the app's
// computeChainedChecksumV3. Batched: one advisory lock + one head read per flush.
const SYSTEM_AUDIT_ACTIONS = new Set(['SYSTEM_BOOT', 'SYSTEM_HEALTH_CHECK', 'SYSTEM_SHUTDOWN', 'MOSQUITTO_ACL_REFRESH', 'PIPELINE_TRACE',
  'NOTIFICATION_DISPATCH', 'BACKUP_RETENTION_PRUNE', 'DLQ_OVERFLOW', 'DEVIATION_OPENED', 'DEVIATION_CLOSED', 'DEVIATION_OPEN_BLOCKED']);
interface AEntry {
  id?: string; timestamp: Date; userId?: string; userName?: string; userRole?: string; action: string;
  targetType?: string; targetId?: string; beforeValue?: unknown; afterValue?: unknown; reason?: string;
  ipAddress?: string; userAgent?: string; sessionId?: string; signatureMeaning?: string; signatureAuditId?: string;
}
const LIMITS: Array<[keyof AEntry, number]> = [['userId', 100], ['userName', 100], ['userRole', 20], ['action', 100], ['targetType', 50],
  ['targetId', 255], ['ipAddress', 45], ['sessionId', 100], ['signatureMeaning', 255]];

let auditRowsWritten = 0;
let firstPositionThisRun: number | null = null;

async function writeAuditBatch(tx: any, entries: AEntry[]): Promise<void> {
  if (!entries.length) return;
  const key = getAuditChainKey();
  if (!key) throw new Error('AUDIT_CHAIN_KEY missing');
  // Pre-validate everything that could make the INSERT fail: a failure after
  // nextval() would leave a permanent CHAIN_POSITION_GAP.
  for (const e of entries) {
    if (!e.userId && !SYSTEM_AUDIT_ACTIONS.has(e.action)) throw new Error(`audit.userId required for action='${e.action}'`);
    if (!(e.timestamp instanceof Date) || Number.isNaN(e.timestamp.getTime())) throw new Error(`bad audit timestamp for ${e.action}`);
    for (const [k, max] of LIMITS) { const v = e[k] as string | undefined; if (v != null && v.length > max) throw new Error(`audit.${k} too long (${v.length}>${max})`); }
  }
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_ID})`);
  const head = await tx.$queryRawUnsafe(`SELECT checksum FROM audit_trail ORDER BY chain_position DESC NULLS LAST LIMIT 1`) as Array<{ checksum: string | null }>;
  let prev: string | null = head[0]?.checksum ?? null;

  const rows: Record<string, unknown>[] = [];
  for (const e of entries) {
    const timestamp = new Date(e.timestamp);
    const afterValueClean = e.afterValue ? JSON.parse(JSON.stringify(e.afterValue)) : undefined;
    const beforeValueClean = e.beforeValue ? JSON.parse(JSON.stringify(e.beforeValue)) : undefined;
    const baseFields: Record<string, unknown> = {
      timestamp: timestamp.toISOString(),
      userId: e.userId ?? undefined, userName: e.userName ?? undefined, userRole: e.userRole ?? undefined,
      action: e.action, targetType: e.targetType ?? undefined, targetId: e.targetId ?? undefined,
      beforeValue: beforeValueClean, afterValue: afterValueClean, reason: e.reason ?? undefined,
      ipAddress: e.ipAddress ?? undefined, userAgent: e.userAgent ?? undefined, sessionId: e.sessionId ?? undefined,
      signatureMeaning: e.signatureMeaning ?? undefined,
    };
    if (e.signatureAuditId) baseFields.signatureAuditId = e.signatureAuditId;
    const checksum = computeChainedChecksumV3(baseFields, prev, key);
    // In-memory proof with the APP's verifier, on the values as the DB will return them.
    const ok = verifyAuditChecksum({
      timestamp: timestamp.toISOString(), userId: e.userId ?? null, userName: e.userName ?? null, userRole: e.userRole ?? null,
      action: e.action, targetType: e.targetType ?? null, targetId: e.targetId ?? null,
      beforeValue: beforeValueClean, afterValue: afterValueClean, reason: e.reason ?? null,
      ipAddress: e.ipAddress ?? null, userAgent: e.userAgent ?? null, sessionId: e.sessionId ?? null,
      signatureMeaning: e.signatureMeaning ?? null, signatureAuditId: e.signatureAuditId ?? null,
      checksum, previousChecksum: prev, checksumVersion: 3,
    });
    if (!ok) throw new Error(`self-verify failed for ${e.action} — refusing to write`);
    rows.push({
      id: e.id ?? randomUUID(), timestamp: timestamp.toISOString(),
      user_id: e.userId ?? null, user_name: e.userName ?? null, user_role: e.userRole ?? null, action: e.action,
      target_type: e.targetType ?? null, target_id: e.targetId ?? null,
      before_value: beforeValueClean ?? null, after_value: afterValueClean ?? null,
      reason: e.reason ?? null, ip_address: e.ipAddress ?? null, user_agent: e.userAgent ?? null, session_id: e.sessionId ?? null,
      checksum, previous_checksum: prev, signature_meaning: e.signatureMeaning ?? null, checksum_version: 3,
      signature_audit_id: e.signatureAuditId ?? null, chain_position: 0,
    });
    prev = checksum;
  }
  // Explicit positions taken from the table's own sequence, in our order.
  const seqRows = await tx.$queryRawUnsafe(
    `SELECT nextval(pg_get_serial_sequence('audit_trail','chain_position'))::text AS p FROM generate_series(1, ${rows.length})`) as Array<{ p: string }>;
  const positions = seqRows.map(r => BigInt(r.p)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const maxRow = await tx.$queryRawUnsafe(`SELECT max(chain_position)::text AS m FROM audit_trail`) as Array<{ m: string | null }>;
  if (maxRow[0]?.m != null && positions[0] <= BigInt(maxRow[0].m)) throw new Error('sequence behind table max — refusing');
  rows.forEach((r, i) => { r.chain_position = positions[i].toString(); });
  if (firstPositionThisRun == null) firstPositionThisRun = Number(positions[0]);
  await insertRows(tx, 'audit_trail', rows, 3000);
  auditRowsWritten += rows.length;
}

// ─────────────────────────────── main ───────────────────────────────
const tRun = Date.now();
try {
  const connected = await assertConnectedToPerf(prisma);
  if (!getAuditChainKey()) throw new Error('AUDIT_CHAIN_KEY is not set (apps/api/.env) — rows would be written unkeyed and flagged KEYED_ERA_DOWNGRADE.');
  log(`connected to ${connected} (scale=${SCALE}, users=${N_USERS}, cycles/day=${CYCLES_PER_DAY})`);

  // ── reference data ──
  const superadmin = await prisma.user.findUnique({ where: { username: 'superadmin' } });
  if (!superadmin) throw new Error('superadmin user not found in the clone');
  const roles = (await prisma.role.findMany({ where: { isActive: true } })).map(r => r.name);
  const templates = await prisma.assetTemplate.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
  const tmplOf = (kind: string) => { const t = templates.find(x => x.templateKind === kind); if (!t) throw new Error(`no active ${kind} template`); return t; };
  const T_BLOCK = tmplOf('BLOCK'), T_AREA = tmplOf('AREA'), T_AHU = tmplOf('AHU'); tmplOf('FILTER');
  const cfg = async (k: string) => (await prisma.systemConfig.findUnique({ where: { configKey: k } }))?.configValue as any;
  const interlockCfg = (await cfg('stage-interlock')) ?? {};
  const interlockStages = new Map<string, { role: string; rejectTo: string }>();
  if (interlockCfg.enabled) {
    if (interlockCfg.washOutApproverRole) interlockStages.set('WASH_OUT', { role: interlockCfg.washOutApproverRole, rejectTo: 'WASH_IN' });
    if (interlockCfg.dryOutApproverRole) interlockStages.set('DRY_OUT', { role: interlockCfg.dryOutApproverRole, rejectTo: 'DRY_IN' });
  }
  const reasonsCfg = (await cfg('filter-cleaning-reasons')) ?? {};
  const reasons: any[] = Array.isArray(reasonsCfg) ? reasonsCfg : (reasonsCfg.value ?? []);
  const pmReason = reasons.find(r => r.isActive !== false && (String(r.key).toUpperCase() === 'PM' || String(r.name).toUpperCase() === 'PM'));
  const routineReason = reasons.find(r => r.isActive !== false && !r.requiresJustification && r !== pmReason);
  if (!pmReason || !routineReason) throw new Error('need an active PM cleaning reason and one routine reason without justification');
  const policy = (await cfg('password-policy')) ?? {};
  const expiryDays = Number(policy.passwordExpiryDays ?? 360);

  // Cleaning profiles: ACTIVE ones whose linear pipeline does not START with
  // DRY_IN (a Dry-In-first profile needs a dryer duration at start, guard #28).
  const activeProfiles = await prisma.filterCleaningProfile.findMany({ where: { status: 'ACTIVE' }, include: { stages: true, connections: true }, orderBy: { createdAt: 'asc' } });
  type Step = { kind: 'STAGE'; key: string } | { kind: 'CHECKLIST'; nodeId: string; profileId: string } | { kind: 'END' };
  const checklistMeta = new Map<string, { id: string; name: string; version: number; isActive: boolean; questions: any[] }>();
  for (const cp of await prisma.checklistProfile.findMany({ include: { questions: { orderBy: { sortOrder: 'asc' } } } })) {
    checklistMeta.set(cp.id, { id: cp.id, name: cp.name, version: cp.version, isActive: cp.isActive, questions: cp.questions });
  }
  function linearPipeline(p: typeof activeProfiles[number]): Step[] {
    const byId = new Map(p.stages.map(s => [s.id, s]));
    let cur = p.stages.find(s => s.nodeType === 'START');
    const steps: Step[] = []; const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const outs = p.connections.filter(c => c.fromStageId === cur!.id).map(c => byId.get(c.toStageId)!).filter(Boolean)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      cur = outs[0];
      if (!cur) break;
      if (cur.nodeType === 'STAGE') steps.push({ kind: 'STAGE', key: cur.stateKey! });
      else if (cur.nodeType === 'CHECKLIST') {
        const cpId = (cur.configuration as any)?.checklistProfileId;
        if (cpId && checklistMeta.get(cpId)?.isActive) steps.push({ kind: 'CHECKLIST', nodeId: cur.id, profileId: cpId });
      } else if (cur.nodeType === 'END') { steps.push({ kind: 'END' }); break; }
      else throw new Error(`profile ${p.name}: unsupported node ${cur.nodeType}`);
    }
    if (steps[steps.length - 1]?.kind !== 'END') throw new Error(`profile ${p.name}: pipeline does not reach END`);
    return steps;
  }
  const usable = activeProfiles.map(p => ({ p, steps: linearPipeline(p) }))
    .filter(x => x.steps[0]?.kind === 'STAGE' && (x.steps[0] as any).key !== 'DRY_IN');
  if (!usable.length) throw new Error('no usable ACTIVE cleaning profile');
  // Primary = the profile with the most stages (full wash/dry/storage); a second, shorter one for variety.
  usable.sort((a, b) => b.steps.length - a.steps.length);
  const PROFILE_MAIN = usable[0];
  const PROFILE_ALT = usable[1] ?? usable[0];
  log(`profiles: main="${PROFILE_MAIN.p.name}" [${PROFILE_MAIN.steps.map(s => s.kind === 'STAGE' ? s.key : s.kind).join('>')}], alt="${PROFILE_ALT.p.name}"`);

  // ── timeline anchor ──
  const existingBlock = await prisma.assetInstance.findFirst({ where: { name: `${PREFIX}-B1`, isActive: true } });
  let START: Date;
  if (existingBlock) {
    const c = existingBlock.createdAt; START = new Date(c.getFullYear(), c.getMonth(), c.getDate() + 20);
  } else if (START_DATE_ARG) {
    const [y, m, d] = START_DATE_ARG.split('-').map(Number); START = new Date(y, m - 1, d);
  } else {
    const n = new Date(); START = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 365);
  }
  const dayStart = (d: number) => new Date(START.getFullYear(), START.getMonth(), START.getDate() + d);
  const today = (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); })();
  const TOTAL_DAYS = Math.round(SCALE * 365);
  const maxDaysByToday = Math.round((today.getTime() - START.getTime()) / DAY_MS);
  const HORIZON_DAYS = Math.min(TOTAL_DAYS, maxDaysByToday);
  if (HORIZON_DAYS < TOTAL_DAYS) log(`WARNING: scale ${SCALE} would run past today; capped at ${HORIZON_DAYS} days`);
  const SETUP_AT = dayStart(-20);
  log(`timeline: start ${ymdLocal(START)}, horizon ${HORIZON_DAYS} days (to ${ymdLocal(dayStart(HORIZON_DAYS))} exclusive)`);

  // ═════════════════════════════ USERS ═════════════════════════════
  const mix: Array<[string, number]> = [['OPERATOR', 0.73], ['SHIFTOFFICER', 0.10], ['SUPERVISOR', 0.07], ['QA', 0.05], ['MANAGER', 0.033], ['ADMIN', 0.017]];
  const roleMix = mix.filter(([r]) => roles.includes(r));
  if (!roleMix.some(([r]) => r === 'OPERATOR')) throw new Error('no OPERATOR role in the clone');
  const totalW = roleMix.reduce((s, [, w]) => s + w, 0);
  const counts = roleMix.map(([r, w]) => [r, Math.max(1, Math.floor(N_USERS * w / totalW))] as [string, number]);
  counts[0][1] += N_USERS - counts.reduce((s, [, c]) => s + c, 0);
  const plannedUsers: Array<{ username: string; role: string; blockIdx: number }> = [];
  let ui = 1;
  for (const [role, c] of counts) for (let k = 0; k < c; k++) plannedUsers.push({ username: `perf_user_${pad(ui++, 3)}`, role, blockIdx: k % N_BLOCKS });

  {
    const existing = new Set((await prisma.user.findMany({ where: { username: { startsWith: 'perf_user_' } }, select: { username: true } })).map(u => u.username));
    const toCreate = plannedUsers.filter(u => !existing.has(u.username));
    if (toCreate.length) {
      const t0 = Date.now();
      const hash = await hashPassword(PASSWORD);           // app's bcrypt helper; one hash reused
      const now = new Date();
      await prisma.$transaction(async (tx: any) => {
        const rows = toCreate.map((u, i) => ({
          id: randomUUID(), username: u.username, full_name: `Perf User ${u.username.slice(10)} (${u.role})`, email: null,
          password_hash: hash, department: `${PREFIX}-B${u.blockIdx + 1}`, photo_url: null, role: u.role, status: 'ENABLED',
          failed_login_attempts: 0, locked_at: null, lockout_until: null,
          password_changed_at: now.toISOString(), password_expires_at: expiryDays > 0 ? addMs(now, expiryDays * DAY_MS).toISOString() : null,
          force_password_change: false, is_temporary_password: false, auth_source: 'local', ldap_dn: null, last_login: null,
          created_at: addMs(SETUP_AT, -5 * DAY_MS + i * 1000).toISOString(), updated_at: now.toISOString(), created_by: 'superadmin', updated_by: null,
        }));
        await insertRows(tx, 'users', rows);
        await insertRows(tx, 'password_history', rows.map(r => ({ id: randomUUID(), user_id: r.id, password_hash: hash, created_at: now.toISOString() })));
        // USER_CREATED through the REAL lib/audit.ts auditLog (same chain, same lock).
        for (const r of rows) {
          await auditLog({
            userId: 'superadmin', userRole: 'SUPER_ADMIN', action: 'USER_CREATED', targetType: 'user', targetId: r.id as string,
            afterValue: { role: r.role, email: '', status: 'ENABLED', fullName: r.full_name, username: r.username },
            signatureMeaning: 'New user account created by administrator',
            ipAddress: '192.168.1.200', userAgent: WEB_UA, timestamp: r.created_at as string,
          }, tx);
        }
      }, { timeout: 600_000, maxWait: 60_000 });
      log(`users: created ${toCreate.length} (USER_CREATED via app auditLog) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } else log('users: all present');
  }
  const users = await prisma.user.findMany({ where: { username: { startsWith: 'perf_user_' } }, orderBy: { username: 'asc' } });
  const U = users.map(u => ({ id: u.id, username: u.username, role: u.role, block: Number((u.department ?? 'PF-B1').split('-B')[1] ?? '1') - 1 }));
  const byRole = (role: string, block?: number) => U.filter(u => u.role === role && (block == null || u.block === block));
  const anyOf = (role: string) => { const xs = byRole(role); if (!xs.length) throw new Error(`no perf user with role ${role}`); return xs[0]; };
  const SUP = byRole('SUPERVISOR')[0] ?? anyOf('OPERATOR');
  const MGR = byRole('MANAGER')[0] ?? SUP;
  const QAU = byRole('QA')[0] ?? SUP;
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, 'perf-users.json'), JSON.stringify({
    database: dbName, password: PASSWORD, note: 'Synthetic perf accounts. forcePasswordChange=false, not expired. digilog_perf only.',
    users: U.map(u => ({ username: u.username, password: PASSWORD, role: u.role, block: `${PREFIX}-B${u.block + 1}` })),
  }, null, 2));

  // ═══════════════════════════ HIERARCHY ═══════════════════════════
  const ahusPerBlock = Math.max(1, Math.round(N_AHUS / N_BLOCKS));
  const filtersPerAhu = Math.max(1, Math.round(N_FILTERS / (ahusPerBlock * N_BLOCKS)));
  const blocksWithAreas = Math.ceil(N_BLOCKS * 0.6);
  type Node = { id: string; name: string; kind: string; parentId: string | null; parentName: string | null; parentKind: string | null; blockIdx: number; ahuIdx?: number; areaName?: string | null };
  const plan: { blocks: Node[]; areas: Node[]; ahus: Node[] } = { blocks: [], areas: [], ahus: [] };
  {
    const existing = new Map((await prisma.assetInstance.findMany({ where: { name: { startsWith: `${PREFIX}-` }, isActive: true }, select: { id: true, name: true } })).map(a => [a.name, a.id]));
    const created: { blocks: Node[]; areas: Node[]; ahus: Node[] } = { blocks: [], areas: [], ahus: [] };
    let ahuGlobal = 0;
    for (let b = 0; b < N_BLOCKS; b++) {
      const bn = `${PREFIX}-B${b + 1}`;
      const block: Node = { id: existing.get(bn) ?? randomUUID(), name: bn, kind: 'BLOCK', parentId: null, parentName: null, parentKind: null, blockIdx: b };
      plan.blocks.push(block); if (!existing.has(bn)) created.blocks.push(block);
      const areas: Node[] = [];
      if (b < blocksWithAreas) for (let a = 0; a < 2; a++) {
        const an = `${bn}/AR-${a + 1}`;
        const area: Node = { id: existing.get(an) ?? randomUUID(), name: an, kind: 'AREA', parentId: block.id, parentName: bn, parentKind: 'BLOCK', blockIdx: b };
        areas.push(area); plan.areas.push(area); if (!existing.has(an)) created.areas.push(area);
      }
      for (let h = 0; h < ahusPerBlock; h++) {
        const parent = areas.length ? areas[h % areas.length] : block;
        const hn = `${bn}/AHU-${pad(h + 1, 2)}`;
        const ahu: Node = { id: existing.get(hn) ?? randomUUID(), name: hn, kind: 'AHU', parentId: parent.id, parentName: parent.name, parentKind: parent.kind, blockIdx: b, ahuIdx: ahuGlobal++, areaName: areas.length ? parent.name : null };
        plan.ahus.push(ahu); if (!existing.has(hn)) created.ahus.push(ahu);
      }
    }
    const nCreated = created.blocks.length + created.areas.length + created.ahus.length;
    if (nCreated) {
      await prisma.$transaction(async (tx: any) => {
        const audits: AEntry[] = [];
        let ts = SETUP_AT;
        for (const level of [created.blocks, created.areas, created.ahus]) {
          if (!level.length) continue;
          const tmpl = level[0].kind === 'BLOCK' ? T_BLOCK : level[0].kind === 'AREA' ? T_AREA : T_AHU;
          const rows = level.map(n => {
            ts = addMs(ts, 2000);
            return { id: n.id, name: n.name, description: null, template_id: tmpl.id, template_version: tmpl.version, status: 'Active',
              attributes: {}, telemetry_config: {}, custom_attributes: {}, parent_id: n.parentId, is_active: true,
              created_at: ts.toISOString(), updated_at: ts.toISOString(), created_by: SUP.username, updated_by: null };
          });
          await insertRows(tx, 'asset_instances', rows);          // mirror trigger fills blocks/areas/ahus
          // Both directions in ONE statement: trg_asset_relationship_pair (AFTER ROW) checks the inverse exists.
          const rels = level.flatMap((n, i) => n.parentId ? [
            { id: randomUUID(), source_asset_id: n.parentId, target_asset_id: n.id, relationship_type: 'CONTAINS', custom_label: null, notes: null, created_at: rows[i].created_at, updated_at: rows[i].created_at, created_by: SUP.username, updated_by: null },
            { id: randomUUID(), source_asset_id: n.id, target_asset_id: n.parentId, relationship_type: 'CONTAINED_IN', custom_label: null, notes: null, created_at: rows[i].created_at, updated_at: rows[i].created_at, created_by: SUP.username, updated_by: null },
          ] : []);
          await insertRows(tx, 'asset_relationships', rels);
          level.forEach((n, i) => {
            const r = rows[i];
            audits.push({ timestamp: addMs(new Date(r.created_at), 15), userId: SUP.username, userRole: 'SUPERVISOR', action: 'ASSET_CREATED',
              targetType: 'asset_instance', targetId: n.id,
              afterValue: { id: n.id, name: n.name, status: 'Active', isActive: true, parentId: n.parentId, createdAt: r.created_at, createdBy: SUP.username,
                updatedAt: r.created_at, attributes: {}, templateId: tmpl.id, templateKind: n.kind, templateVersion: tmpl.version, approvalStatus: 'APPROVED',
                ...(n.parentName ? { parentName: n.parentName, parentKind: n.parentKind } : {}) },
              reason: n.parentName ? `${n.kind} created under "${n.parentName}"` : `${n.kind} created`,
              signatureMeaning: n.parentName ? `${n.kind} "${n.name}" created under "${n.parentName}"` : `${n.kind} "${n.name}" created`,
              ipAddress: '192.168.1.210', userAgent: WEB_UA, sessionId: randomUUID() });
          });
        }
        await writeAuditBatch(tx, audits);
      }, { timeout: 600_000, maxWait: 60_000 });
      log(`hierarchy: created ${created.blocks.length} blocks, ${created.areas.length} areas, ${created.ahus.length} AHUs`);
    } else log('hierarchy: all present');
  }

  // ═════════════════════════ EQUIPMENT GROUPS ═════════════════════════
  const eqByBlock = new Map<number, { id: string; version: number; instruments: any[] }>();
  {
    const tmplInstr = [
      { description: 'Compressed Air Pressure', stage_key: 'WASH_IN', uom: 'bar', instrument_min: 0, instrument_max: 16, operating_min: 0, operating_max: 10, least_count: 0.1, code: 'CAP' },
      { description: 'RO Water Pressure', stage_key: 'WASH_IN', uom: 'bar', instrument_min: 0, instrument_max: 16, operating_min: 0, operating_max: 10, least_count: 0.1, code: 'ROP' },
      { description: 'Dryer Temperature', stage_key: 'DRY_IN', uom: '°C', instrument_min: 0, instrument_max: 150, operating_min: 90, operating_max: 100, least_count: 0.5, code: 'DRT' },
    ];
    for (const block of plan.blocks) {
      const name = `${block.name} Equipment`;
      let g = await prisma.equipmentGroup.findFirst({ where: { name, blockId: block.id }, include: { instruments: { orderBy: { sortOrder: 'asc' } } } });
      if (!g) {
        const gid = randomUUID(); const at = addMs(SETUP_AT, DAY_MS + block.blockIdx * 60_000);
        await prisma.$transaction(async (tx: any) => {
          await insertRows(tx, 'equipment_groups', [{ id: gid, name, block_id: block.id, is_active: true, reading_url: null, version: 1, created_by: SUP.id, created_at: at.toISOString(), updated_at: at.toISOString() }]);
          await insertRows(tx, 'equipment_group_instruments', tmplInstr.map((t, i) => ({
            id: randomUUID(), group_id: gid, description: t.description, stage_key: t.stage_key, serial_number: `SN-${block.name}-${t.code}`,
            instrument_id: `${t.code}-${pad(block.blockIdx + 1, 2)}${i + 1}`, uom: t.uom, instrument_min: t.instrument_min, instrument_max: t.instrument_max,
            operating_min: t.operating_min, operating_max: t.operating_max, least_count: t.least_count, response_key: null, auto_fetch_enabled: false,
            sort_order: i, created_at: at.toISOString(), updated_at: at.toISOString() })));
          await writeAuditBatch(tx, [{ timestamp: addMs(at, 20), userId: SUP.username, userRole: 'SUPERVISOR', action: 'EQUIPMENT_GROUP_CREATED',
            targetType: 'equipment_group', targetId: gid, afterValue: { name, blockId: block.id }, ipAddress: '192.168.1.210', userAgent: WEB_UA }]);
        }, { timeout: 120_000 });
        g = await prisma.equipmentGroup.findFirst({ where: { id: gid }, include: { instruments: { orderBy: { sortOrder: 'asc' } } } });
      }
      eqByBlock.set(block.blockIdx, { id: g!.id, version: g!.version, instruments: g!.instruments });
    }
  }

  // ═════════════════════════════ FILTERS ═════════════════════════════
  type FNode = { id: string; name: string; ahu: Node; idx: number; filterSet: 'SET_A' | 'SET_B'; attrs: Record<string, string> };
  const FILTERS: FNode[] = [];
  {
    const existing = new Map((await prisma.filter.findMany({ where: { name: { startsWith: `${PREFIX}-` }, isActive: true }, select: { id: true, name: true } })).map(f => [f.name, f.id]));
    const toCreate: FNode[] = [];
    let idx = 0;
    for (const ahu of plan.ahus) for (let k = 0; k < filtersPerAhu; k++) {
      const name = `${ahu.name}/${pad(k + 1, 2)}-00`;
      const hepa = k % 3 === 2;
      const f: FNode = { id: existing.get(name) ?? randomUUID(), name, ahu, idx: idx++, filterSet: k % 2 === 0 ? 'SET_A' : 'SET_B',
        attrs: { ahuType: ahu.ahuIdx! % 4 === 3 ? 'Non Process' : 'Process', filterSize: '610x610x150', filterType: hepa ? 'HEPA' : 'PRE', micronSize: hepa ? '1' : pick(mulberry32(idx), ['5', '10', '15']), lastCleaningDate: 'NA' } };
      FILTERS.push(f); if (!existing.has(name)) toCreate.push(f);
    }
    if (toCreate.length) {
      const t0 = Date.now();
      await prisma.$transaction(async (tx: any) => {
        const audits: AEntry[] = [];
        const rows = toCreate.map((f, i) => {
          const at = addMs(SETUP_AT, 2 * DAY_MS + i * 1500);
          return { id: f.id, ahu_id: f.ahu.id, name: f.name, description: null, status: 'Active', attributes: f.attrs, custom_attributes: {},
            is_active: true, created_at: at.toISOString(), updated_at: at.toISOString(), created_by: SUP.username, updated_by: null };
        });
        await insertRows(tx, 'filters', rows);                  // reverse mirror creates asset_instances (parent = AHU)
        await insertRows(tx, 'filter_details', toCreate.map((f, i) => ({ id: randomUUID(), asset_instance_id: f.id, filter_profile_id: null,
          current_lifecycle_state: null, current_cycle_id: null, filter_set: f.filterSet, created_at: rows[i].created_at, updated_at: rows[i].created_at })));
        // Filter create → review → approve (filter-approval workflow is enabled in the clone).
        const appr = toCreate.map((f, i) => {
          const c = new Date(rows[i].created_at);
          return { id: f.id, sub: c, rev: addMs(c, 3 * 3600_000), app: addMs(c, 26 * 3600_000) };
        });
        await tx.$executeRawUnsafe(`UPDATE asset_instances a SET approval_status='APPROVED', submitted_by=$2::uuid, submitted_by_name=$3,
            submitted_at=v.sub, reviewed_by=$4::uuid, reviewed_by_name=$5, reviewed_at=v.rev, approved_by=$6::uuid, approved_by_name=$7, approved_at=v.app
          FROM json_to_recordset($1::json) AS v(id uuid, sub timestamptz, rev timestamptz, app timestamptz) WHERE a.id = v.id`,
          JSON.stringify(appr), SUP.id, SUP.username, MGR.id, MGR.username, QAU.id, QAU.username);
        const idRows = toCreate.map((f, i) => ({ id: randomUUID(), asset_id: f.id, identifier_type: 'RFID',
          identifier_value: `E28068940000${(0x5000000 + f.idx).toString(16).toUpperCase().padStart(12, '0')}`, label: null, is_primary: true,
          created_at: addMs(appr[i].app, 3600_000).toISOString(), updated_at: addMs(appr[i].app, 3600_000).toISOString(), created_by: SUP.username, updated_by: null }));
        await insertRows(tx, 'asset_identifiers', idRows);
        toCreate.forEach((f, i) => {
          audits.push({ timestamp: addMs(new Date(rows[i].created_at), 10), userId: SUP.username, userRole: 'SUPERVISOR', action: 'ASSET_CREATED',
            targetType: 'asset_instance', targetId: f.id, afterValue: { name: f.name, ahuId: f.ahu.id, filterSet: f.filterSet, kind: 'FILTER' },
            ipAddress: '192.168.1.210', userAgent: WEB_UA, sessionId: randomUUID() });
          audits.push({ timestamp: appr[i].rev, userId: MGR.username, userRole: 'MANAGER', action: 'FILTER_REVIEWED', targetType: 'asset_instance', targetId: f.id,
            afterValue: { filterName: f.name, reviewRemarks: null }, ipAddress: '192.168.1.211', userAgent: WEB_UA, sessionId: randomUUID() });
          audits.push({ timestamp: appr[i].app, userId: QAU.username, userRole: 'QA', action: 'FILTER_APPROVED', targetType: 'asset_instance', targetId: f.id,
            afterValue: { filterName: f.name, approvalRemarks: null }, ipAddress: '192.168.1.212', userAgent: WEB_UA, sessionId: randomUUID() });
          audits.push({ timestamp: new Date(idRows[i].created_at), userId: SUP.username, userRole: 'SUPERVISOR', action: 'ASSET_IDENTIFIER_CREATED',
            targetType: 'asset_identifier', targetId: idRows[i].id, afterValue: { id: idRows[i].id, label: null, assetId: f.id, createdAt: idRows[i].created_at,
              createdBy: SUP.username, isPrimary: true, updatedAt: idRows[i].created_at, updatedBy: null, filterName: f.name, identifierType: 'RFID', identifierValue: idRows[i].identifier_value },
            ipAddress: '192.168.1.150', userAgent: TABLET_UA, sessionId: randomUUID() });
        });
        audits.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        await writeAuditBatch(tx, audits);
      }, { timeout: 900_000, maxWait: 60_000 });
      log(`filters: created ${toCreate.length} (+ details, RFID, review/approve) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } else log('filters: all present');
  }
  const profileOfAhu = (ahu: Node) => (ahu.ahuIdx! % 5 === 4 ? PROFILE_ALT : PROFILE_MAIN);

  // ═══════════════ cleaning-profile-assignment rules (BY_AHU) ═══════════════
  {
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'cleaning-profile-assignment' } });
    const before = (row?.configValue as any) ?? { mode: 'BY_AHU', rules: [] };
    if (before.mode === 'BY_AHU') {
      const have = new Set((before.rules ?? []).map((r: any) => r.matchValue));
      const add = plan.ahus.filter(a => !have.has(a.id)).map(a => ({ profileId: profileOfAhu(a).p.id, matchValue: a.id }));
      if (add.length) {
        const after = { ...before, rules: [...(before.rules ?? []), ...add] };
        await prisma.$transaction(async (tx: any) => {
          await tx.$executeRawUnsafe(`UPDATE system_config SET config_value = $1::jsonb, updated_at = now(), updated_by = 'superadmin' WHERE config_key = 'cleaning-profile-assignment'`, JSON.stringify(after));
          await writeAuditBatch(tx, [{ timestamp: addMs(SETUP_AT, 3 * DAY_MS), userId: 'superadmin', userRole: 'SUPER_ADMIN', action: 'CONFIG_CHANGED',
            targetType: 'system_config', targetId: 'cleaning-profile-assignment', beforeValue: before, afterValue: after, ipAddress: '192.168.1.200', userAgent: WEB_UA, sessionId: randomUUID() }]);
        }, { timeout: 120_000 });
        log(`profile assignment: +${add.length} BY_AHU rules`);
      }
    } else {
      log(`WARNING: cleaning-profile-assignment mode is ${before.mode}, not BY_AHU — rules not added; the app will resolve profiles by its own rule/default`);
    }
  }

  // ═══════════════════════════ PM SCHEDULES ═══════════════════════════
  // Deterministic irregular visits per AHU (gaps 26-34 days, ±3 tolerance → windows never overlap).
  type Visit = { ahu: Node; planned: number; doneDay: number; missed: boolean; openDay: number; lastDay: number; entryId?: string };
  const visitsByDay = new Map<number, Visit[]>();     // doneDay → visits performed that day
  const opensByDay = new Map<number, Visit[]>();      // openDay → deviations opened that day
  const ALL_VISITS: Visit[] = [];
  for (const ahu of plan.ahus) {
    const r = mulberry32(9000 + ahu.ahuIdx!);
    let planned = 2 + (ahu.ahuIdx! % 28);
    while (planned < 365 + 60) {
      const missed = planned + PM_TOLERANCE_DAYS + 7 < 365 && r() < PM_MISS_RATE;
      let doneDay: number;
      if (missed) doneDay = planned + PM_TOLERANCE_DAYS + randInt(r, 2, 5);
      else { const u = r(); doneDay = Math.max(0, u < 0.7 ? planned : planned + randInt(r, -PM_TOLERANCE_DAYS, PM_TOLERANCE_DAYS - 1)); }
      const v: Visit = { ahu, planned, doneDay, missed, openDay: planned + PM_TOLERANCE_DAYS + 1, lastDay: doneDay };
      ALL_VISITS.push(v);
      planned += randInt(r, 26, 34);
    }
  }
  const todayIdx = maxDaysByToday;
  // Insert an entry only if its history is fully generated (lastDay < horizon), or it
  // is still current/future (window not yet closed at real "today"). A past entry
  // whose cleanings have not been generated yet would be a false overdue task.
  const includeVisit = (v: Visit) => v.lastDay < HORIZON_DAYS || v.planned + PM_TOLERANCE_DAYS > todayIdx;
  {
    const schedules = await prisma.pmSchedule.findMany({ where: { entityId: { in: plan.ahus.map(a => a.id) } }, include: { entries: true } });
    const schedKey = (ahuId: string, year: number) => `${ahuId}:${year}`;
    const schedMap = new Map(schedules.map(s => [schedKey(s.entityId, s.year), s]));
    const entryMap = new Map<string, string>();
    for (const s of schedules) for (const e of s.entries) entryMap.set(`${s.entityId}:${e.plannedDate.toISOString().slice(0, 10)}`, e.id);
    const newSchedules: any[] = []; const newEntries: any[] = []; const audits: AEntry[] = [];
    const importAt = addMs(SETUP_AT, 10 * DAY_MS);
    const ahuNames = new Set<string>();
    for (const v of ALL_VISITS) {
      if (!includeVisit(v)) continue;
      const pd = dayStart(v.planned); const plannedYmd = ymdLocal(pd);
      const k = `${v.ahu.id}:${plannedYmd}`;
      if (entryMap.has(k)) { v.entryId = entryMap.get(k); continue; }
      const year = pd.getFullYear();
      let s = schedMap.get(schedKey(v.ahu.id, year));
      if (!s) {
        s = { id: randomUUID(), entityId: v.ahu.id, year } as any;
        schedMap.set(schedKey(v.ahu.id, year), s!);
        newSchedules.push({ id: s!.id, entity_id: v.ahu.id, year, version: 1, status: 'ACTIVE', created_by: SUP.id, created_at: importAt.toISOString(), updated_at: importAt.toISOString(),
          frequency_days: null, anchor_date: null, series_id: null });
      }
      const ws = ymdLocal(dayStart(v.planned - PM_TOLERANCE_DAYS)), we = ymdLocal(dayStart(v.planned + PM_TOLERANCE_DAYS));
      const id = randomUUID(); v.entryId = id; entryMap.set(k, id); ahuNames.add(v.ahu.name);
      const rev = addMs(importAt, DAY_MS), app = addMs(importAt, 2 * DAY_MS);
      newEntries.push({ id, schedule_id: s!.id, month: pd.getMonth() + 1, planned_date: plannedYmd, tolerance_days: PM_TOLERANCE_DAYS, window_start: ws, window_end: we,
        notes: null, approval_status: 'APPROVED', approval_remarks: null, approved_by: QAU.id, approved_by_name: QAU.username, approved_at: app.toISOString(),
        submitted_by: SUP.id, submitted_by_name: SUP.username, reviewed_by: MGR.id, reviewed_by_name: MGR.username, reviewed_at: rev.toISOString(), review_remarks: null,
        rejected_by: null, rejected_by_name: null, rejected_at: null, rejection_stage: null, manual_entry: false });
      audits.push({ timestamp: addMs(rev, newEntries.length * 50), userId: MGR.username, userRole: 'MANAGER', action: 'PM_SCHEDULE_REVIEWED', targetType: 'pm_schedule_entry', targetId: id,
        afterValue: { ahuName: v.ahu.name }, ipAddress: '192.168.1.211', userAgent: WEB_UA });
      audits.push({ timestamp: addMs(app, newEntries.length * 50), userId: QAU.username, userRole: 'QA', action: 'PM_SCHEDULE_APPROVED', targetType: 'pm_schedule_entry', targetId: id,
        afterValue: { ahuName: v.ahu.name, hasPendingEdit: false }, ipAddress: '192.168.1.212', userAgent: WEB_UA });
    }
    if (newEntries.length) {
      audits.unshift({ timestamp: importAt, userId: SUP.username, userRole: 'SUPERVISOR', action: 'PM_SCHEDULE_IMPORTED', targetType: 'pm_schedule', targetId: 'bulk',
        afterValue: { skipped: 0, ahuNames: [...ahuNames], imported: newEntries.length }, ipAddress: '192.168.1.210', userAgent: WEB_UA });
      audits.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      await prisma.$transaction(async (tx: any) => {
        await insertRows(tx, 'pm_schedules', newSchedules);
        await insertRows(tx, 'pm_schedule_entries', newEntries);
        await writeAuditBatch(tx, audits);
      }, { timeout: 600_000, maxWait: 60_000 });
      log(`pm: +${newSchedules.length} schedules, +${newEntries.length} approved entries`);
    } else log('pm: all present');
  }

  // ═════════════════════════════ DAYS ═════════════════════════════
  const filterIds = FILTERS.map(f => f.id);
  const seqByFilter = new Map<string, number>();
  for (const r of await prisma.$queryRawUnsafe(`SELECT filter_id::text AS f, count(*)::int AS n FROM cleaning_cycles WHERE filter_id = ANY(SELECT jsonb_array_elements_text($1::jsonb)::uuid) GROUP BY 1`, JSON.stringify(filterIds)) as any[]) seqByFilter.set(r.f, r.n);
  // A live cycle (load test) on a synthetic filter would be overwritten by the
  // day-end filter_details update — refuse instead.
  const live = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM cleaning_cycles WHERE status = 'IN_PROGRESS' AND filter_id = ANY(SELECT jsonb_array_elements_text($1::jsonb)::uuid)`, JSON.stringify(filterIds)) as any[];
  if (live[0].n > 0) throw new Error(`${live[0].n} synthetic filter(s) have an IN_PROGRESS cycle (live test data). Generate history before load-testing, or terminate those cycles first.`);
  // Resume point: last synthetic day committed. Cycles started today or later are
  // live test traffic, not generated history, so they are ignored here.
  const lastRow = await prisma.$queryRawUnsafe(`SELECT max(started_at) AS m FROM cleaning_cycles WHERE started_at < $2::timestamptz AND filter_id = ANY(SELECT jsonb_array_elements_text($1::jsonb)::uuid)`, JSON.stringify(filterIds), today.toISOString()) as any[];
  let firstDay = 0;
  if (lastRow[0]?.m) { const m = new Date(lastRow[0].m); firstDay = Math.round((new Date(m.getFullYear(), m.getMonth(), m.getDate()).getTime() - START.getTime()) / DAY_MS) + 1; }
  const lastDayExcl = Math.min(HORIZON_DAYS, firstDay + MAX_DAYS_THIS_RUN);

  // Repair: a synthetic PM entry whose window is already behind the resume point
  // but that no PM cleaning satisfied (and was not written off) would be a false
  // overdue task — the perf API's 03:00 sweep would open a deviation for it and
  // every PM start on that AHU would 409 PM_PREVIOUS_TASK_PENDING. Treat it as a
  // genuinely missed PM: the sweep opens the deviation on the next generated day
  // and that day's PM cleaning writes it off (applyPmSkips path).
  if (firstDay < lastDayExcl) {
    const orphans = new Set((await prisma.$queryRawUnsafe(`
      SELECT e.id::text AS id FROM pm_schedule_entries e JOIN pm_schedules s ON s.id = e.schedule_id JOIN ahus h ON h.id = s.entity_id
      WHERE h.name LIKE '${PREFIX}-%' AND e.skipped_at IS NULL AND e.approval_status = 'APPROVED' AND e.window_end < $1::date
        AND NOT EXISTS (SELECT 1 FROM cleaning_cycles c JOIN asset_instances a ON a.id = c.filter_id
                        WHERE a.parent_id = s.entity_id AND c.status = 'COMPLETED' AND c.cleaning_reason_key = $2
                          AND c.completed_at >= (e.window_start::timestamp AT TIME ZONE 'UTC'))`, ymdLocal(dayStart(firstDay)), pmReason.key) as any[]).map(x => x.id));
    for (const v of ALL_VISITS) if (v.entryId && orphans.has(v.entryId)) {
      v.missed = true; v.openDay = firstDay; v.doneDay = firstDay; v.lastDay = firstDay;
      log(`repair: PM entry ${ymdLocal(dayStart(v.planned))} for ${v.ahu.name} had no PM cleaning — handled as a missed PM on day ${firstDay}`);
    }
  }
  for (const v of ALL_VISITS) {
    if (!v.entryId) continue;
    if (!visitsByDay.has(v.doneDay)) visitsByDay.set(v.doneDay, []);
    visitsByDay.get(v.doneDay)!.push(v);
    if (v.missed) { if (!opensByDay.has(v.openDay)) opensByDay.set(v.openDay, []); opensByDay.get(v.openDay)!.push(v); }
  }
  log(`days: generating ${firstDay}..${lastDayExcl - 1} of ${HORIZON_DAYS} (resume point from DB)`);

  const filtersByAhu = new Map<string, FNode[]>();
  for (const f of FILTERS) { if (!filtersByAhu.has(f.ahu.id)) filtersByAhu.set(f.ahu.id, []); filtersByAhu.get(f.ahu.id)!.push(f); }
  const ops = (b: number) => { const x = byRole('OPERATOR', b); return x.length ? x : byRole('OPERATOR'); };
  const approversFor = (role: string, b: number) => { const x = byRole(role, b); return x.length ? x : byRole(role).length ? byRole(role) : byRole('SUPERVISOR'); };
  const blockNode = (b: number) => plan.blocks[b];
  const totals = { cycles: 0, events: 0, approvals: 0, deviations: 0, audit: 0 };

  for (let d = firstDay; d < lastDayExcl; d++) {
    const t0 = Date.now();
    const r = mulberry32(1_000_003 * (d + 1));
    const day0 = dayStart(d);
    const cycles: any[] = []; const events: any[] = []; const approvals: any[] = []; const audits: AEntry[] = [];
    const sessions = new Map<string, { sid: string; first: number; last: number; user: typeof U[number]; ua: string; ip: string }>();
    const touch = (u: typeof U[number], at: Date, ua: string, ip: string) => {
      let s = sessions.get(u.id);
      if (!s) { s = { sid: randomUUID(), first: at.getTime(), last: at.getTime(), user: u, ua, ip }; sessions.set(u.id, s); }
      s.first = Math.min(s.first, at.getTime()); s.last = Math.max(s.last, at.getTime());
      return s.sid;
    };
    const filterLast: Array<{ id: string; date: string }> = [];

    // Which filters are cleaned today: a rotating slice for routine cleaning,
    // plus every filter of an AHU whose PM visit is performed today (PM reason).
    const pmToday = visitsByDay.get(d) ?? [];
    const pmFilter = new Map<string, Visit>();
    for (const v of pmToday) for (const f of filtersByAhu.get(v.ahu.id) ?? []) pmFilter.set(f.id, v);
    const todays: FNode[] = [];
    const off = (d * CYCLES_PER_DAY) % FILTERS.length;
    for (let i = 0; i < Math.min(CYCLES_PER_DAY, FILTERS.length); i++) todays.push(FILTERS[(off + i) % FILTERS.length]);
    const inToday = new Set(todays.map(f => f.id));
    for (const id of pmFilter.keys()) if (!inToday.has(id)) todays.push(FILTERS.find(f => f.id === id)!);

    // Deviations auto-opened by the 03:00 overdue sweep (system actor).
    const deviationRows: any[] = []; const devVisits: Visit[] = [];
    for (const v of opensByDay.get(d) ?? []) {
      const at = addMs(day0, 3 * 3600_000 + randInt(r, 0, 120_000));
      const fl = (filtersByAhu.get(v.ahu.id) ?? []).map(f => f.id);
      const plannedUtc = new Date(`${ymdLocal(dayStart(v.planned))}T00:00:00Z`);
      deviationRows.push({ id: randomUUID(), pm_schedule_entry_id: v.entryId, ahu_id: v.ahu.id, ahu_name: v.ahu.name, filter_ids: fl, filter_count: fl.length,
        scheduled_date: ymdLocal(dayStart(v.planned)), window_start: ymdLocal(dayStart(v.planned - PM_TOLERANCE_DAYS)), window_end: ymdLocal(dayStart(v.planned + PM_TOLERANCE_DAYS)),
        overdue_days_at_open: Math.max(0, Math.floor((at.getTime() - plannedUtc.getTime()) / DAY_MS)), assigned_user_id: null, status: 'OPEN',
        password_verified: false, notified_at: addMs(at, 200).toISOString(), created_at: at.toISOString(), updated_at: at.toISOString() });
      devVisits.push(v);
    }
    // Missed visits performed late today: the first PM start writes the visit off
    // (app: applyPmSkips inside the start-cycle transaction) and closes its deviation.
    const skipsToday = pmToday.filter(v => v.missed);
    const skipDone = new Set<string>();
    const skipUpdates: any[] = [];

    for (const f of todays) {
      const b = f.ahu.blockIdx; const blk = blockNode(b); const eq = eqByBlock.get(b)!;
      const pmV = pmFilter.get(f.id);
      const prof = profileOfAhu(f.ahu);
      const op = pick(r, ops(b));
      const tabletIp = `192.168.1.${100 + (U.indexOf(op) % 90)}`;
      const reason = pmV ? pmReason : routineReason;
      const seq = (seqByFilter.get(f.id) ?? 0) + 1; seqByFilter.set(f.id, seq);
      const cycleId = randomUUID();
      let t = addMs(day0, (6 * 60 + randInt(r, 0, 14 * 60 + 30)) * MIN + randInt(r, 0, 59_999));
      const startedAt = t;
      const cycleCode = `CC-${f.name.replace(/\s+/g, '')}-${pad(seq, 3)}-${startedAt.toISOString().slice(0, 10).replace(/-/g, '')}`;
      const sidOp = touch(op, t, TABLET_UA, tabletIp);
      const aud = (o: Omit<AEntry, 'ipAddress' | 'userAgent' | 'userId' | 'userRole'>) => audits.push({ ...o, userId: op.username, userRole: 'OPERATOR', ipAddress: tabletIp, userAgent: TABLET_UA });
      const ev = (o: Record<string, unknown>, checksum: string) => {
        const row = { id: randomUUID(), filter_id: f.id, cycle_id: cycleId, event_type: o.eventType, from_state: o.fromState ?? null, to_state: o.toState ?? null,
          performed_by: o.performedBy, performed_at: (o.performedAt as Date).toISOString(), cleaning_area_id: o.cleaningAreaId ?? null, equipment_id: null, block_id: null,
          attributes: o.attributes ?? {}, telemetry_snapshot: {}, remarks: o.remarks ?? null, deviation_details: null, manual_entry: false, checksum,
          ip_address: o.ip ?? tabletIp, created_at: (o.performedAt as Date).toISOString() };
        events.push(row);
      };
      void sidOp;

      // Missed-PM write-off on the first PM start for that AHU today.
      if (pmV && skipsToday.length) {
        for (const sv of skipsToday.filter(x => x.ahu.id === f.ahu.id && !skipDone.has(x.entryId!))) {
          skipDone.add(sv.entryId!);
          const why = 'AHU was under breakdown maintenance during the PM window; PM performed at the next opportunity';
          const plannedUtc = new Date(`${ymdLocal(dayStart(sv.planned))}T00:00:00Z`);
          const windowEndUtc = new Date(`${ymdLocal(dayStart(sv.planned + PM_TOLERANCE_DAYS))}T00:00:00Z`);
          const overdueDays = Math.max(0, Math.floor((t.getTime() - windowEndUtc.getTime()) / DAY_MS));
          skipUpdates.push({ id: sv.entryId, at: t.toISOString(), by: op.id, byName: op.username, reason: why });
          aud({ timestamp: addMs(t, 3), action: 'PM_TASK_SKIPPED', targetType: 'pm_schedule_entry', targetId: sv.entryId,
            afterValue: { ahuName: sv.ahu.name, plannedDate: plannedUtc, overdueDays, skipReason: why }, reason: why,
            signatureMeaning: `Scheduled PM for "${sv.ahu.name}" on ${await formatConfiguredDate(plannedUtc)} was NOT performed; written off with a reason at cleaning start` });
        }
      }

      // CYCLE_STARTED
      const startAttrs = { cleaningReasonKey: reason.key, cleaningReasonLabel: reason.name, clientOpId: `${randomUUID()}:start` };
      ev({ eventType: 'CYCLE_STARTED', performedBy: op.id, performedAt: addMs(t, 11), cleaningAreaId: blk.id, attributes: startAttrs, remarks: null },
        eventChecksum({ filterId: f.id, cycleId, eventType: 'CYCLE_STARTED', performedBy: op.id }));
      aud({ timestamp: addMs(t, 23), action: 'CYCLE_STARTED', targetType: 'cleaning_cycle', targetId: cycleId,
        afterValue: { cycleCode, cleaningReasonKey: reason.key, cleaningReasonLabel: reason.name, filterId: f.id, filterName: f.name } });
      t = addMs(t, randInt(r, 200, 900));

      let fromState: string | null = null;
      let dryerStartedAt: Date | null = null; let dryerMinutes: number | null = null;
      let completedAt: Date | null = null;
      const steps = prof.steps;
      for (let si = 0; si < steps.length; si++) {
        const st = steps[si];
        if (st.kind === 'STAGE') {
          const key = st.key;
          const next = steps[si + 1];
          const completes = next?.kind === 'END';
          let attributes: Record<string, unknown> = {};
          let remarks = `${prettyStage(key)} - ${f.name}`;
          let areaId: string | null = null;
          if (key === 'WASH_IN') {
            areaId = blk.id;
            const ins = eq.instruments.filter((x: any) => x.stageKey === 'WASH_IN');
            attributes = { clientOpId: `${randomUUID()}:advance`, instrumentReadings: ins.map((x: any) => ({ uom: x.uom, value: roundTo(1 + r() * 4, x.leastCount), leastCount: x.leastCount,
              description: x.description, instrumentId: x.id, instrumentCode: x.instrumentId })) };
            remarks = `WASH IN - ${f.name}`;
          }
          if (key === 'DRY_IN') {
            areaId = blk.id; dryerMinutes = pick(r, [5, 10, 15, 30]); dryerStartedAt = addMs(t, -18);
            attributes = { action: 'DRYER_STARTED', dryerStartedAt: dryerStartedAt.toISOString(), dryerDurationMinutes: dryerMinutes };
            remarks = `Dryer started (${dryerMinutes} min) - ${f.name}`;
          }
          const eventData = { filterId: f.id, cycleId, eventType: 'STATE_TRANSITION' as const, fromState, toState: key, performedBy: op.id,
            cleaningAreaId: areaId, equipmentId: null, attributes, remarks };
          ev({ ...eventData, performedAt: t }, eventChecksum(eventData));
          if (completes) {
            completedAt = addMs(t, 19);
            const ce = { filterId: f.id, cycleId, eventType: 'CYCLE_COMPLETED' as const, performedBy: op.id, attributes: { sequenceNumber: seq } };
            ev({ ...ce, performedAt: addMs(t, 36) }, eventChecksum(ce));
            aud({ timestamp: addMs(t, 33), action: 'CYCLE_COMPLETED', targetType: 'filter', targetId: f.id, afterValue: { cycleId, completedAt, finalStage: key } });
          }
          aud({ timestamp: addMs(t, completes ? 40 : 4), action: 'STATE_TRANSITION', targetType: 'filter', targetId: f.id, beforeValue: { state: fromState }, afterValue: { state: key } });
          if (completes) break;

          // Dryer: readings submitted in place (fromState null on the event), then wait the duration.
          if (key === 'DRY_IN') {
            t = addMs(t, randInt(r, 90, 240) * 1000);
            const ins = eq.instruments.filter((x: any) => x.stageKey === 'DRY_IN');
            const readings = ins.map((x: any) => ({ uom: x.uom, value: roundTo(91 + r() * 8, x.leastCount), source: 'MANUAL', leastCount: x.leastCount,
              description: x.description, instrumentId: x.id, instrumentCode: x.instrumentId }));
            const ed = { filterId: f.id, cycleId, eventType: 'STATE_TRANSITION' as const, fromState: null, toState: 'DRY_IN', performedBy: op.id,
              cleaningAreaId: null, equipmentId: null, attributes: { action: 'DRYER_READINGS_SUBMITTED', clientOpId: randomUUID(), instrumentReadings: readings },
              remarks: `Dryer temperature ${readings[0]?.value}°C - ${f.name}` };
            ev({ ...ed, performedAt: t }, eventChecksum(ed));
            aud({ timestamp: addMs(t, -3), action: 'STATE_TRANSITION', targetType: 'filter', targetId: f.id, beforeValue: { state: 'DRY_IN' }, afterValue: { state: 'DRY_IN' } });
            t = new Date(Math.max(t.getTime(), dryerStartedAt!.getTime() + dryerMinutes! * MIN) + randInt(r, 20, 180) * 1000);
          } else if (next?.kind !== 'CHECKLIST') {
            // dwell in the stage; a checklist that follows is answered right away (dialog-first on the tablet)
            t = addMs(t, (key === 'WASH_IN' ? randInt(r, 8, 18) * 60 : randInt(r, 1, 8) * 60) * 1000 + randInt(r, 0, 59_999));
          }

          // Stage interlock: approval requested on entry, decided by a different person (re-auth signed).
          const il = interlockStages.get(key);
          if (il) {
            const approver = pick(r, approversFor(il.role, b));
            const reqAt = new Date(events[events.length - (key === 'DRY_IN' ? 2 : 1)].performed_at);
            const decAt = addMs(t, randInt(r, 30, 300) * 1000);
            const apId = randomUUID(); const reauthId = randomUUID();
            const webIp = `192.168.1.${30 + (U.indexOf(approver) % 60)}`;
            const sidA = touch(approver, decAt, WEB_UA, webIp);
            approvals.push({ id: apId, cycle_id: cycleId, filter_id: f.id, stage_key: key, status: 'APPROVED', approver_role: il.role, reject_to_state_key: il.rejectTo, attempt_seq: 1,
              details_snapshot: { ahu: f.ahu.name, area: f.ahu.areaName ?? null, block: blk.name, ahuType: f.attrs.ahuType, filterSet: f.filterSet, filterName: f.name,
                filterType: f.attrs.filterType, micronSize: f.attrs.micronSize, filterDimensions: f.attrs.filterSize },
              requested_by: op.id, requested_by_name: op.username, requested_at: reqAt.toISOString(), decided_by: approver.id, decided_by_name: approver.username,
              decided_at: addMs(decAt, 30).toISOString(), decision_remarks: null, created_at: reqAt.toISOString(), updated_at: addMs(decAt, 33).toISOString() });
            ev({ eventType: 'APPROVAL_GRANTED', performedBy: approver.id, performedAt: addMs(decAt, 39), attributes: { kind: 'STAGE_INTERLOCK_APPROVED', stageKey: key, attemptSeq: 1, approvalId: apId }, remarks: null, ip: webIp },
              eventChecksum({ filterId: f.id, cycleId, eventType: 'APPROVAL_GRANTED', performedBy: approver.id, stageKey: key, attemptSeq: 1 }));
            audits.push({ id: reauthId, timestamp: decAt, userId: approver.username, userRole: approver.role, action: 'REAUTH_SUCCESS', targetType: 'user', targetId: approver.id,
              afterValue: { username: approver.username, reauthAction: 'APPROVE_CLEANING_STAGE' }, signatureMeaning: 'Electronic signature applied for APPROVE_CLEANING_STAGE',
              ipAddress: webIp, userAgent: WEB_UA, sessionId: sidA });
            audits.push({ timestamp: addMs(decAt, 28), userId: approver.username, userRole: approver.role, action: 'STAGE_APPROVAL_APPROVED', targetType: 'cleaning_stage_approval', targetId: apId,
              afterValue: { stageKey: key, filterName: f.name, remarks: null }, signatureMeaning: `${prettyStage(key)} approved for filter "${f.name}"`,
              ipAddress: webIp, userAgent: WEB_UA, sessionId: sidA, signatureAuditId: reauthId });
            t = addMs(decAt, randInt(r, 20, 120) * 1000);
          }
          fromState = key;
        } else if (st.kind === 'CHECKLIST') {
          const cm = checklistMeta.get(st.profileId)!;
          const answers: Record<string, string> = {};
          for (const q of cm.questions) answers[q.id] = q.questionType === 'TEXT' ? 'Completed' : q.questionType === 'PASS_FAIL' ? 'Pass'
            : q.questionType === 'NUMERIC' ? '1' : (q.questionType === 'DROPDOWN' && Array.isArray(q.options) && q.options.length) ? String(q.options[0]) : 'Yes';
          const snapshot = [{ answers, pipelineNodeId: st.nodeId, profileVersion: cm.version, checklistProfileId: cm.id, checklistProfileName: cm.name,
            questionsSnapshot: cm.questions.map((q: any) => ({ id: q.id, options: q.options, question: q.question, required: q.required, questionType: q.questionType })) }];
          const terminal = steps[si + 1]?.kind === 'END';
          const ed = { filterId: f.id, cycleId, eventType: 'CHECKLIST_COMPLETED' as const, performedBy: op.id,
            attributes: { afterStage: fromState, answers, checklists: snapshot }, remarks: `Checklist completed after ${fromState}` };
          t = addMs(t, terminal ? 17 : randInt(r, 20, 90) * 1000);
          ev({ ...ed, performedAt: t }, eventChecksum(ed));
          if (terminal) {
            completedAt = addMs(t, 2);
            const ce = { filterId: f.id, cycleId, eventType: 'CYCLE_COMPLETED' as const, performedBy: op.id, attributes: { sequenceNumber: seq } };
            ev({ ...ce, performedAt: addMs(t, 19) }, eventChecksum(ce));
            aud({ timestamp: addMs(t, 16), action: 'CYCLE_COMPLETED', targetType: 'filter', targetId: f.id, afterValue: { cycleId, completedAt, finalStage: fromState } });
          }
          aud({ timestamp: addMs(t, 20), action: 'CHECKLIST_COMPLETED', targetType: 'filter', targetId: f.id,
            afterValue: { stage: fromState, answerCount: Object.keys(answers).length, profileCount: 1 } });
          if (terminal) break;
        }
      }
      if (!completedAt) throw new Error(`cycle for ${f.name} did not complete — pipeline walk bug`);
      touch(op, completedAt, TABLET_UA, tabletIp);
      const cpPins: Record<string, number> = {};
      for (const s of steps) if (s.kind === 'CHECKLIST') cpPins[s.profileId] = checklistMeta.get(s.profileId)!.version;
      cycles.push({ id: cycleId, cycle_code: cycleCode, filter_id: f.id, profile_id: prof.p.id, profile_version: prof.p.version, sequence_number: seq, status: 'COMPLETED',
        started_at: startedAt.toISOString(), completed_at: completedAt.toISOString(), terminated_at: null, termination_reason: null, cleaning_area_id: blk.id,
        pm_execution_id: null, pm_schedule_entry_id: null, cleaning_reason_key: reason.key, cleaning_reason_label: reason.name, cleaning_justification: null,
        created_at: startedAt.toISOString(), updated_at: completedAt.toISOString(), equipment_group_id: eq.id, equipment_group_version_pin: eq.version,
        dryer_duration_minutes: dryerMinutes, dryer_started_at: dryerStartedAt?.toISOString() ?? null, dryer_readings_submitted: dryerStartedAt != null,
        manual_entry: false, checklist_version_pins: cpPins });
      filterLast.push({ id: f.id, date: ymdLocal(completedAt) });
    }

    // LOGIN / LOGOUT bracketing each person's work that day.
    for (const s of sessions.values()) {
      const loginAt = new Date(s.first - randInt(r, 60, 900) * 1000);
      const logoutAt = new Date(s.last + randInt(r, 120, 1800) * 1000);
      audits.push({ timestamp: loginAt, userId: s.user.username, userRole: s.user.role, action: 'LOGIN_SUCCESS', targetType: 'user', targetId: s.user.id,
        afterValue: { fullName: `Perf User ${s.user.username.slice(10)} (${s.user.role})`, username: s.user.username }, signatureMeaning: 'User authenticated with username and password',
        ipAddress: s.ip, userAgent: s.ua, sessionId: s.sid });
      audits.push({ timestamp: logoutAt, userId: s.user.username, userRole: s.user.role, action: 'LOGOUT', targetType: 'session', targetId: s.sid,
        afterValue: { reason: 'manual', username: s.user.username }, signatureMeaning: `User "${s.user.username}" logged out`, ipAddress: s.ip, userAgent: s.ua, sessionId: s.sid });
    }

    await prisma.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(`SET LOCAL synchronous_commit = off`);
      await insertRows(tx, 'cleaning_cycles', cycles, 3000);
      await insertRows(tx, 'filter_events', events, 4000);
      await insertRows(tx, 'cleaning_stage_approvals', approvals, 4000);
      if (deviationRows.length) {
        const ret = await insertRows(tx, 'deviations', deviationRows, 1000, 'id, deviation_number');
        const num = new Map(ret.map((x: any) => [x.id, x.deviation_number]));
        deviationRows.forEach((dr, i) => {
          const n = num.get(dr.id);
          audits.push({ timestamp: addMs(new Date(dr.created_at), 300), userRole: 'SYSTEM', action: 'DEVIATION_OPENED', targetType: 'deviation', targetId: dr.id,
            afterValue: { deviationNumber: n, ahuName: dr.ahu_name, overdueDays: dr.overdue_days_at_open, filterCount: dr.filter_count },
            reason: `PM task for ${dr.ahu_name} overdue by ${dr.overdue_days_at_open} day(s) — deviation ${n} opened`,
            signatureMeaning: `Deviation ${n} auto-opened for overdue AHU "${devVisits[i].ahu.name}" cleaning`, ipAddress: '127.0.0.1' });
        });
      }
      if (skipUpdates.length) {
        await tx.$executeRawUnsafe(`UPDATE pm_schedule_entries e SET skipped_at = v.at, skipped_by = v.by, skipped_by_name = v."byName", skip_reason = v.reason
          FROM json_to_recordset($1::json) AS v(id uuid, at timestamptz, by uuid, "byName" text, reason text) WHERE e.id = v.id`, JSON.stringify(skipUpdates));
        await tx.$executeRawUnsafe(`UPDATE deviations d SET status = 'CLOSED', closed_at = v.at, closure_kind = 'SKIPPED', closure_reason = v.reason, updated_at = v.at
          FROM json_to_recordset($1::json) AS v(id uuid, at timestamptz, reason text) WHERE d.pm_schedule_entry_id = v.id AND d.status <> 'CLOSED'`, JSON.stringify(skipUpdates));
      }
      // Filter state after the day: every synthetic cycle is complete.
      await tx.$executeRawUnsafe(`UPDATE filter_details SET current_lifecycle_state = 'CLEANING_CYCLE_COMPLETED', current_cycle_id = NULL, updated_at = now()
        WHERE asset_instance_id = ANY(SELECT jsonb_array_elements_text($1::jsonb)::uuid)`, JSON.stringify(filterLast.map(x => x.id)));
      await tx.$executeRawUnsafe(`UPDATE filters f SET attributes = jsonb_set(COALESCE(f.attributes, '{}'::jsonb), '{lastCleaningDate}', to_jsonb(v.d), true)
        FROM json_to_recordset($1::json) AS v(id uuid, d text) WHERE f.id = v.id`, JSON.stringify(filterLast.map(x => ({ id: x.id, d: x.date }))));
      audits.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      await writeAuditBatch(tx, audits);
    }, { timeout: 900_000, maxWait: 120_000 });

    totals.cycles += cycles.length; totals.events += events.length; totals.approvals += approvals.length; totals.deviations += deviationRows.length; totals.audit += audits.length;
    log(`day ${d + 1}/${HORIZON_DAYS} ${ymdLocal(day0)}: ${cycles.length} cycles, ${events.length} events, ${approvals.length} approvals, ${deviationRows.length} dev, ${audits.length} audit — ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  const secs = (Date.now() - tRun) / 1000;
  log(`DONE in ${secs.toFixed(0)}s — this run: ${JSON.stringify(totals)}, audit rows written ${auditRowsWritten}, first chain_position ${firstPositionThisRun ?? '-'}`);

  if (DO_VERIFY && firstPositionThisRun != null) {
    const { verifyWindowed } = await import('./verify-perf-chain.js');
    const prevPos = await prisma.$queryRawUnsafe(`SELECT max(chain_position)::text AS p FROM audit_trail WHERE chain_position < ${firstPositionThisRun}`) as any[];
    const res = await verifyWindowed(200_000, prevPos[0]?.p ? Number(prevPos[0].p) : firstPositionThisRun);
    log('verify (this run + one predecessor row):', JSON.stringify(res));
  }
} finally {
  await prisma.$disconnect();
}
