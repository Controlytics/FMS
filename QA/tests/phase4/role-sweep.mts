// QA Phase 4 — live role x endpoint permission sweep against the QA clone (:3104, digilog_qa_perf).
//
// For every operation in docs/production-readiness/03_API_ENDPOINT_INVENTORY.md (429) and every
// non-SUPER_ADMIN role (6), send ONE request and classify the answer:
//   GATE_DENY     403 {error:FORBIDDEN, message:"Insufficient permissions"}  (rbac.ts / config/routes.ts:95)
//   PASS          any other answer that can only come from code AFTER the gate:
//                 404 / 409 / business 400 / 200 / 401 REAUTH_REQUIRED / an in-handler 403 with another code
//   INCONCLUSIVE  400 VALIDATION_ERROR from Fastify schema validation, which runs BEFORE the rbac
//                 preHandler (proved: OPERATOR POST /api/users {} -> 400, GET /api/users -> 403)
//   SKIPPED       not sent (session-ending auth routes, public routes, dangerous ops for an allowed role)
//
// Expected (backend) = inventory gate evaluated over the role's LIVE roles.permissions with the
// backend's own hasEffectivePermission() (packages/shared, imported from source, fallbacks included).
//
// Mutation policy: a schema-valid ("full") body is sent only when it cannot mutate:
//   - the role is EXPECTED to be denied (if the gate holds -> 403; if it leaks, the leak is the finding),
//     except DANGER ops which always get an empty body;
//   - or the path carries a random-UUID id (handler 404s);
//   - or the role must re-authenticate for that action (401 REAUTH_REQUIRED before any work; no
//     password is sent, so no failed attempt is recorded);
//   - or the op is in SAFE_FULL (its body only names random ids).
// Otherwise an empty body is sent (usually INCONCLUSIVE for an allowed role).
//
//   cd <repo> && MSYS_NO_PATHCONV=1 npx tsx QA/tests/phase4/role-sweep.mts
import fs from 'node:fs';
import path from 'node:path';
import { hasEffectivePermission } from '../../../packages/shared/src/types/permissions.ts';
import { call, sql, QA_RESULTS, TARGET } from '../lib/qa.mjs';
import { loadInventory, parseGate } from './inventory.mjs';
import { buildRequest } from './bodygen.mjs';
import { phase4Tokens, ROLES } from './accounts.mjs';

const spec = JSON.parse(fs.readFileSync('QA/results/phase4/openapi.json', 'utf8'));
const ops = loadInventory();
const livePerms: Record<string, string[]> = JSON.parse(sql(`select json_object_agg(name, permissions) from roles`));
const reauthCfg: Record<string, string[]> = JSON.parse(sql(`select config_value::text from system_config where config_key='action-reauth'`));

const SKIP_ALWAYS = [/^\/api\/auth\/(logout|refresh|beacon-logout|verify|change-password|offline-grant|login|forgot-password)/, /^\/api\/uploads\/photo/, /^\/api\/admin-requests\/$/, /^\/api\/notifications\/mark-all-read/];
const DANGER = [/^\/api\/backup\/restore/, /^\/api\/notification-settings\/(send|email\/test|sms\/test)/, /^\/api\/ldap\/test-connection/,
  /^\/api\/equipment-groups\/(test-url|fetch-readings)/, /password-expiry-sweep/, /deviations\/sweep/, /^\/api\/audit\/bulk-/, /^\/api\/users\/bulk-delete/,
  /^\/api\/super-admin\/api-lock/, /^\/api\/config\//, /^\/api\/ldap\/config/, /^\/api\/notification-settings\//];
const SAFE_FULL = [/\/validate$/, /ahu-completion-status\/batch$/, /ahu-set-availability$/, /\/entries\/(approve|reject|review)$/, /\/instances\/(approve|reject|review)$/,
  /\/bulk-operate$/, /\/bulk-decide$/, /\/bulk-(read|unread)$/];

function reauthDefinite(op: any, role: string): boolean | 'unknown' {
  const r: string = op.reauth;
  if (!r || r === '—') return false;
  if (/computed/.test(r)) return 'unknown';
  if (/always/.test(r)) return true;
  const actions = r.replace(/\(.*?\)/g, '').replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  return actions.some((a) => (reauthCfg[a] ?? []).includes(role));
}

function expectBackend(gate: any, role: string): 'ALLOW' | 'DENY' | 'ANY' | 'PUBLIC' | '?' {
  switch (gate.kind) {
    case 'public': return 'PUBLIC';
    case 'sa': return 'DENY';
    case 'role': return gate.roles.includes(role) ? 'ALLOW' : 'DENY';
    case 'any': return 'ANY';
    case 'perm': return gate.perms.some((p: string) => hasEffectivePermission(livePerms[role] ?? [], p)) ? 'ALLOW' : 'DENY';
    default: return '?';
  }
}

function classify(res: any) {
  const j = res.json ?? {};
  if (res.status === 403 && j.error === 'FORBIDDEN' && /Insufficient permissions|Permission denied|Super Admin access required/.test(j.message ?? '')) return 'GATE_DENY';
  // Some routes declare a 403/400 response schema with only `error`, so Fastify strips message/details.
  if (res.status === 403 && j.error === 'FORBIDDEN' && !j.message) return 'GATE_DENY';
  if (res.status === 400 && j.error === 'VALIDATION_ERROR' && !j.details && !j.message) return 'INCONCLUSIVE';
  if (res.status === 400 && j.error === 'VALIDATION_ERROR' && Array.isArray(j.details) && j.details.some((d: any) => 'instancePath' in d || 'keyword' in d)) return 'INCONCLUSIVE';
  if (res.status === 401 && !/^REAUTH/.test(j.error ?? '')) return 'AUTH_FAIL';
  if (res.status === 0) return 'NET_ERROR';
  return 'PASS';
}

const tokens = await phase4Tokens();
const rows: any[] = [];
for (const op of ops) {
  // admin-requests/:id/process: body-aware preHandler (admin-requests/routes.ts:209); generated body has action='approve'.
  const gate = op.path === '/api/admin-requests/{id}/process' ? { kind: 'perm', perms: ['ADMIN_REQUEST_APPROVE'] } : parseGate(op.gate);
  for (const role of ROLES) {
    const exp = expectBackend(gate, role);
    const base = { module: op.module, method: op.method, path: op.path, gate: op.gate, reauth: op.reauth, line: op.line, role, expected: exp };
    if (exp === 'PUBLIC' || SKIP_ALWAYS.some((r) => r.test(op.path))) { rows.push({ ...base, observed: 'SKIPPED', why: exp === 'PUBLIC' ? 'public' : 'session/auth/self-service route' }); continue; }
    const write = !['GET', 'DELETE'].includes(op.method);
    const danger = DANGER.some((r) => r.test(op.path));
    const uuidPath = /\{(id|[a-zA-Z]*Id)\}/.test(op.path) && !/\{fieldId\}/.test(op.path);
    const ra = reauthDefinite(op, role);
    let full = false;
    if (write) {
      if (exp === 'DENY') full = !danger || (ra === true && /^\/api\/config\//.test(op.path)) || /\/validate$/.test(op.path);
      else if (SAFE_FULL.some((r) => r.test(op.path))) full = true;
      else if (uuidPath && !danger) full = true;
      // 401 REAUTH_REQUIRED fires before the handler does any work (config PUT handlers checked by hand);
      // never relied on for restore / outbound / sweep / bulk-delete ops.
      else if (ra === true && (!danger || /^\/api\/config\//.test(op.path))) full = true;
    }
    if (write && exp !== 'DENY' && !full) {
      // An allowed role with no safe way to stop the handler before it writes: not sent.
      rows.push({ ...base, observed: 'SKIPPED', why: danger ? 'dangerous op (config write / outbound call / sweep / restore) for a role expected to pass the gate'
        : 'id-less create/update for a role expected to pass the gate — a valid body would mutate the clone' });
      continue;
    }
    const rq = buildRequest(spec, op.method, op.path, { full });
    const res: any = await call(op.method, rq.url, { token: tokens[role].token, body: rq.body });
    const observed = classify(res);
    rows.push({ ...base, url: rq.url, bodySent: full ? 'schema-valid' : (write ? 'empty' : 'none'), multipart: rq.multipart, inSpec: rq.inSpec,
      status: res.status, error: res.json?.error, message: String(res.json?.message ?? '').slice(0, 200), observed });
  }
}

const verdict = (r: any) => {
  if (['SKIPPED', 'INCONCLUSIVE', 'AUTH_FAIL', 'NET_ERROR'].includes(r.observed)) return r.observed;
  if (r.expected === 'ANY') return r.observed === 'GATE_DENY' ? 'UNEXPECTED_DENY' : 'OK';
  if (r.expected === 'ALLOW') return r.observed === 'PASS' ? 'OK' : 'REFUSED_BUT_GRANTED';
  if (r.expected === 'DENY') return r.observed === 'GATE_DENY' ? 'OK' : 'LEAK';
  return 'UNKNOWN_GATE';
};
for (const r of rows) r.verdict = verdict(r);
const dir = path.join(QA_RESULTS, 'phase4');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `role-sweep-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const tally = rows.reduce((m: any, r) => ((m[r.verdict] = (m[r.verdict] ?? 0) + 1), m), {});
fs.writeFileSync(file, JSON.stringify({ target: TARGET, roles: ROLES, accounts: Object.fromEntries(Object.entries(tokens).map(([k, v]: any) => [k, v.username])), operations: ops.length, tally, rows }, null, 1));
fs.copyFileSync(file, path.join(dir, 'role-sweep-latest.json'));
console.log('tally', tally);
for (const r of rows.filter((x) => ['LEAK', 'REFUSED_BUT_GRANTED', 'UNEXPECTED_DENY', 'UNKNOWN_GATE', 'AUTH_FAIL', 'NET_ERROR'].includes(x.verdict)))
  console.log(r.verdict.padEnd(20), r.role.padEnd(12), r.method.padEnd(6), r.path.padEnd(58), r.gate.slice(0, 40).padEnd(40), r.status, r.error ?? '', r.message.slice(0, 80));
console.log('results:', file);
