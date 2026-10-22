// Phase 5 helpers: a raw request that can send arbitrary headers / non-JSON bodies
// (the shared perf client cannot), plus the per-role token cache and leak detection.
// Target and DB guards come from ../lib/qa.mjs (localhost + *_perf only).
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tokenFor, loginAs, sql, QA_RESULTS, TARGET, DB, PASSWORD } from '../lib/qa.mjs';
import { REPO } from '../../../tests/performance/lib/http.mjs';

export { sql, TARGET, DB, PASSWORD };
// P5_OUT: results sub-folder (10-21 run = phase5; re-runs pass their own so the baseline survives).
export const OUT = path.join(QA_RESULTS, process.env.P5_OUT ?? 'phase5');
fs.mkdirSync(OUT, { recursive: true });

export const ROLES = ['OPERATOR', 'SHIFTOFFICER', 'SUPERVISOR', 'QA', 'MANAGER', 'ADMIN'];

// P5_USER_IDX: which perf user of each role acts (unset = the first, via tokenFor, as on 10-21).
// Set it when another agent drives the first users on the same database: a login here is
// force:true and would end their session. users(role)[i] lists that role's perf usernames.
const PERF = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/performance/results/perf-users.json'), 'utf8')).users;
export const users = (role) => PERF.filter((u) => u.role === role).map((u) => u.username);
export const USER_IDX = process.env.P5_USER_IDX === undefined ? null : Number(process.env.P5_USER_IDX);
/** The username that tok(role) acts as, and the "second user" of the role for wrong-password probes. */
export const actor = (role) => users(role)[USER_IDX ?? 0];
export const second = (role) => users(role)[(USER_IDX ?? 0) + 1];

/** raw(method, path, {token, body, rawBody, headers}) -> {status, json, text} */
export function raw(method, urlPath, { token, body, rawBody, headers = {}, timeoutMs = 30000 } = {}) {
  const u = new URL(urlPath, TARGET);
  let payload;
  const h = { accept: 'application/json', ...headers };
  if (rawBody !== undefined) payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  else if (body !== undefined) { payload = Buffer.from(JSON.stringify(body)); h['content-type'] ??= 'application/json'; }
  if (payload) h['content-length'] = payload.length;
  if (token) h.authorization = `Bearer ${token}`;
  return new Promise((resolve) => {
    const req = https.request(u, { method, headers: h, agent: ctx.agent, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json; try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, json, text: text.slice(0, 2000), headers: res.headers });
      });
    });
    req.on('timeout', () => req.destroy(new Error('client timeout')));
    req.on('error', (e) => resolve({ status: 0, text: String(e) }));
    if (payload) req.write(payload);
    req.end();
  });
}

const LEAK = [/node_modules/i, /\bat [A-Za-z_.$<>]+ \(/, /[A-Z]:\\\\/, /[A-Z]:\//, /\.ts:\d+/, /\.js:\d+:\d+/,
  /prisma\.[a-z]+\.[a-z]+\(/i, /Invalid `prisma/i, /PrismaClient/i, /\bP20\d\d\b/, /violates .*constraint/i, /relation "[a-z_]+"/i, /syntax error at/i];
export const leaks = (r) => LEAK.filter((re) => re.test(r.text ?? '')).map(String);

const tokCache = {};
export async function tok(role) {
  if (!tokCache[role]) tokCache[role] = USER_IDX === null ? await tokenFor(role) : await loginAs(actor(role));
  return tokCache[role];
}

export function save(name, data) {
  const f = path.join(OUT, `${name}.json`);
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
  return f;
}

/** Minimal body that satisfies a JSON schema's required fields (so the request reaches the preHandler gates). */
export function sample(schema, depth = 0, uuid = () => '00000000-0000-4000-8000-00000000qa00'.replace('qa00', 'beef')) {
  if (!schema || depth > 6) return undefined;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.oneOf || schema.anyOf) return sample((schema.oneOf ?? schema.anyOf).find((s) => s.type !== 'null') ?? (schema.oneOf ?? schema.anyOf)[0], depth + 1, uuid);
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s) => sample(s, depth + 1, uuid) ?? {}));
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  switch (type) {
    case 'object': case undefined: {
      if (type === undefined && !schema.properties) return undefined;
      const o = {};
      for (const k of schema.required ?? []) o[k] = sample(schema.properties?.[k] ?? { type: 'string' }, depth + 1, uuid);
      return o;
    }
    case 'array': {
      const n = schema.minItems ?? 0;
      return Array.from({ length: n }, () => sample(schema.items ?? { type: 'string' }, depth + 1, uuid));
    }
    case 'string': {
      if (schema.format === 'uuid') return uuid();
      if (schema.format === 'date-time') return '2026-10-21T10:00:00.000Z';
      if (schema.format === 'date') return '2026-10-21';
      if (schema.format === 'email') return 'qa-probe@example.com';
      const min = schema.minLength ?? 0;
      let s = 'qa-p5-probe';
      while (s.length < min) s += 'x';
      if (schema.maxLength && s.length > schema.maxLength) s = s.slice(0, Math.max(schema.maxLength, min));
      if (schema.pattern) { try { if (!new RegExp(schema.pattern).test(s)) s = 'QAP5' + '0'.repeat(Math.max(0, min - 4)); } catch { /* ignore */ } }
      return s;
    }
    case 'integer': case 'number': return schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : 1);
    case 'boolean': return false;
    default: return null;
  }
}
