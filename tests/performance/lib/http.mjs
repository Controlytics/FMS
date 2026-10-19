// Minimal dependency-free HTTP client + metrics for the performance suite.
// Uses Node's own https module with a keep-alive agent (like a browser tab does)
// and trusts the repo's mkcert root CA instead of disabling TLS verification.
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import tls from 'node:tls';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '../../..');
export const RESULTS = path.join(REPO, 'tests/performance/results');

let caCache;
function ca() {
  if (caCache === undefined) {
    // The dev API's server.crt is issued by the mkcert CA in the Windows store,
    // the LAN cert by certs/rootCA.pem — trust both, verification stays on.
    const p = path.join(REPO, 'certs/rootCA.pem');
    caCache = [...tls.getCACertificates('default'), ...tls.getCACertificates('system')];
    if (fs.existsSync(p)) caCache.push(fs.readFileSync(p, 'utf8'));
  }
  return caCache;
}

/**
 * One agent per virtual user = one connection pool per "browser". maxSockets 6
 * matches what a browser opens per origin.
 */
export function makeAgent(target) {
  const u = new URL(target);
  const opts = { keepAlive: true, maxSockets: 6 };
  if (u.protocol === 'https:') return new https.Agent({ ...opts, ca: ca() ?? undefined });
  return new http.Agent(opts);
}

/**
 * Sends one request and records it. Never throws for HTTP errors — a 4xx/5xx is
 * a measurement, not a crash. Network errors are recorded with status 0.
 */
// Bodies above this are counted, not kept or parsed, unless the caller passes
// `parse: true`. The load runner only needs status + size, and 100 virtual users
// each holding an 11 MB batch-states body made the RUNNER use 2.3 GB and a core
// of CPU on the same PC as the server (2026-10-17) — work a real tablet does on
// its own hardware, so it must not be charged to the server under test.
const PARSE_LIMIT = 256 * 1024;

export function request(ctx, method, urlPath, { body, label, token, timeoutMs = 30_000, parse } = {}) {
  const u = new URL(urlPath, ctx.target);
  const lib = u.protocol === 'https:' ? https : http;
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const headers = { accept: 'application/json' };
  if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
  const tok = token ?? ctx.token;
  if (tok) headers.authorization = `Bearer ${tok}`;
  const started = process.hrtime.bigint();
  return new Promise((resolve) => {
    const req = lib.request(u, { method, headers, agent: ctx.agent, timeout: timeoutMs }, (res) => {
      const declared = Number(res.headers['content-length'] ?? 0);
      let keep = parse === true || declared <= PARSE_LIMIT;
      const chunks = [];
      let bytes = 0;
      res.on('data', (c) => {
        bytes += c.length;
        if (keep && (parse === true || bytes <= PARSE_LIMIT)) chunks.push(c);
        else { keep = false; chunks.length = 0; }
      });
      res.on('end', () => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        let json;
        if (keep && chunks.length) {
          try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { json = undefined; }
        }
        ctx.metrics?.record(label ?? `${method} ${u.pathname}`, res.statusCode, ms, bytes, json);
        resolve({ status: res.statusCode, ms, bytes, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('client timeout')));
    req.on('error', (err) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      ctx.metrics?.record(label ?? `${method} ${u.pathname}`, 0, ms, 0, { error: err.message });
      resolve({ status: 0, ms, bytes: 0, error: err.message });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return +sorted[Math.max(0, i)].toFixed(1);
}

/**
 * Metrics are kept per label (endpoint) and in 10-second windows so the abort
 * guard and the soak report can see degradation over time, not only totals.
 */
// "error" = transport failure, 5xx, 429, or a server fault the app reports as a 400:
// any 400 on a GET (a read has no business rule to refuse) and DATA_CONSTRAINT, which
// is how the error handler surfaces an unmapped Prisma failure (2026-10-17: a
// 512 MB result and a timed-out audit transaction both arrived as 400). Other 4xx
// business refusals are tracked by status only.
export function isError(label, status, json) {
  if (status === 0 || status >= 500 || status === 429) return true;
  if (status === 400 && (label.startsWith('GET ') || json?.error === 'DATA_CONSTRAINT')) return true;
  return false;
}

export class Metrics {
  constructor() {
    this.byLabel = new Map();
    this.windows = [];           // [{ t, n, err, lat: [] }]
    this.t0 = Date.now();
    this.errorSamples = [];      // first few error bodies per label+status, for diagnosis
  }
  record(label, status, ms, bytes, json) {
    let m = this.byLabel.get(label);
    if (!m) { m = { n: 0, lat: [], status: {}, bytes: 0, err: 0 }; this.byLabel.set(label, m); }
    m.n++; m.lat.push(ms); m.bytes += bytes;
    m.status[status] = (m.status[status] ?? 0) + 1;
    const w = Math.floor((Date.now() - this.t0) / 10_000);
    let win = this.windows[w];
    if (!win) { win = this.windows[w] = { t: w * 10, n: 0, err: 0, lat: [] }; }
    win.n++; win.lat.push(ms);
    if (isError(label, status, json)) {
      m.err++; win.err++;
      const key = `${label} ${status}`;
      if (this.errorSamples.filter((e) => e.key === key).length < 3) {
        this.errorSamples.push({ key, body: json && JSON.stringify(json).slice(0, 300) });
      }
    }
  }
  lastWindows(k) { return this.windows.filter(Boolean).slice(-k); }
  summary() {
    const rows = [];
    let total = 0, errs = 0; const all = [];
    for (const [label, m] of this.byLabel) {
      const s = [...m.lat].sort((a, b) => a - b);
      const e = m.err;
      total += m.n; errs += e; all.push(...m.lat);
      rows.push({ label, n: m.n, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: +s[s.length - 1].toFixed(1),
        avgKB: +(m.bytes / m.n / 1024).toFixed(1), errors: e, status: m.status });
    }
    all.sort((a, b) => a - b);
    const secs = (Date.now() - this.t0) / 1000;
    rows.sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0));
    return {
      durationSec: +secs.toFixed(1), requests: total, rps: +(total / secs).toFixed(1),
      errorRatePct: total ? +((errs / total) * 100).toFixed(3) : 0,
      p50: pct(all, 50), p95: pct(all, 95), p99: pct(all, 99),
      endpoints: rows,
      timeline: this.windows.filter(Boolean).map((w) => {
        const s = [...w.lat].sort((a, b) => a - b);
        return { t: w.t, rps: +(w.n / 10).toFixed(1), errPct: +((w.err / w.n) * 100).toFixed(2), p95: pct(s, 95) };
      }),
      errorSamples: this.errorSamples,
    };
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const jitter = (ms, frac = 0.2) => ms * (1 - frac + Math.random() * 2 * frac);
