// Logs the synthetic perf users in ONCE and caches their tokens, because the
// login route is rate-limited to 100/min per client (a deliberate brake on
// password guessing — see CLAUDE.md "Only THREE rate limits exist"). Tokens are
// reused across runs until /api/auth/me stops accepting them.
//
// Users come from tests/performance/results/perf-users.json, written by
// data-generation/seed-perf-db.ts. Format: [{ username, password, role }].
import fs from 'node:fs';
import path from 'node:path';
import { makeAgent, request, RESULTS, sleep } from './http.mjs';

const LOGIN_PACE_MS = 800; // ~75 logins/min, safely under the 100/min limit

// Orders users so the first N of them hold ~`share` OPERATORs (tablet personas)
// and the rest desktop roles, until one group runs out (80 non-operators exist).
function interleave(pool, share) {
  const ops = pool.filter((u) => u.role === 'OPERATOR');
  const others = pool.filter((u) => u.role !== 'OPERATOR');
  const out = [];
  while (ops.length || others.length) {
    const opsShare = out.filter((u) => u.role === 'OPERATOR').length / (out.length || 1);
    out.push((ops.length && (opsShare < share || !others.length)) ? ops.shift() : others.shift());
  }
  return out;
}

// Seconds until a JWT expires (0 when it cannot be decoded).
function secondsLeft(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : 0;
  } catch { return 0; }
}

// `minRemainingSec`: a cached token with less life than this is re-issued, so a
// session cannot expire in the middle of a run (sessions here last 1 h; the
// 14:14 run saw 401s for exactly that reason).
export async function getTokens(target, count, { roles, minRemainingSec = 0 } = {}) {
  const usersFile = path.join(RESULTS, 'perf-users.json');
  if (!fs.existsSync(usersFile)) throw new Error(`${usersFile} missing — run the data generator first`);
  const file = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
  // the generator writes { database, users: [...] }; a bare array is accepted too
  if (file.database && !/_perf\d*$/.test(file.database)) throw new Error(`${usersFile} is for ${file.database}, not a _perf database`);
  let pool = Array.isArray(file) ? file : file.users;
  if (roles?.length) pool = pool.filter((u) => roles.includes(u.role));
  else pool = interleave(pool, Number(process.env.PERF_TABLET_SHARE ?? 0.4));
  if (pool.length < count) throw new Error(`need ${count} users${roles ? ` with roles ${roles}` : ''}, only ${pool.length} available`);
  pool = pool.slice(0, count);

  const cacheFile = path.join(RESULTS, `tokens-${new URL(target).port}.json`);
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const agent = makeAgent(target);
  const out = [];
  let fresh = 0;
  for (const u of pool) {
    let token = cache[u.username];
    if (token && secondsLeft(token) < minRemainingSec) token = undefined;
    if (token) {
      const me = await request({ target, agent }, 'GET', '/api/auth/me', { token });
      if (me.status !== 200) token = undefined;
    }
    if (!token) {
      if (fresh > 0) await sleep(LOGIN_PACE_MS);
      // force: synthetic users only — ends any stale session for that same synthetic user.
      const r = await request({ target, agent }, 'POST', '/api/auth/login',
        { body: { username: u.username, password: u.password, force: true, client: 'web' } });
      if (r.status !== 200 || !r.json?.token) throw new Error(`login failed for ${u.username}: ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`);
      token = r.json.token; cache[u.username] = token; fresh++;
      if (fresh % 25 === 0) process.stdout.write(`  logged in ${fresh} users...\n`);
    }
    out.push({ ...u, token });
  }
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  if (fresh) console.log(`logged in ${fresh} users (${out.length - fresh} reused cached tokens)`);
  return out;
}
