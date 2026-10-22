/**
 * Secret resolution and lifetimes for the two token kinds (lib/jwt.ts and
 * lib/offline-replay-token.ts). Both modules read their secrets once at import,
 * so each case imports a FRESH copy with the environment it needs and restores
 * every variable immediately afterwards. Asserted: whether a token from one
 * process (module instance) verifies in another, the lifetime actually stamped,
 * the hard failure in production, the warning an operator sees, and every
 * refusal code a tablet can receive.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach, type MockInstance } from 'vitest';
import * as jose from 'jose';

const KEYS = ['JWT_SECRET', 'VERIFICATION_TOKEN_SECRET', 'NODE_ENV', 'JWT_EXPIRY_HOURS', 'OFFLINE_REPLAY_SECRET'] as const;
type Env = Partial<Record<(typeof KEYS)[number], string | undefined>>;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];
const restore = () => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };

async function fresh<T>(spec: string, env: Env): Promise<T> {
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  vi.resetModules();
  try { return (await import(spec)) as T; } finally { restore(); }
}
type Jwt = typeof import('../jwt.js');
type Offline = typeof import('../offline-replay-token.js');

const LONG_A = 'cvl-secret-A-0123456789-0123456789-0123456789';
const LONG_B = 'cvl-secret-B-0123456789-0123456789-0123456789';
const payload = { sub: 'u-cvl', username: 'cvl', role: 'OPERATOR', sessionId: 's-1' };

let stdout: MockInstance<typeof process.stdout.write>;
const printed = () => stdout.mock.calls.map((c) => String(c[0])).join('');
beforeAll(() => { stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true); });
afterEach(() => { stdout.mockClear(); vi.useRealTimers(); });
afterAll(() => { stdout.mockRestore(); restore(); });

describe('jwt secrets and lifetime', () => {
  it('a configured secret is shared across processes: a token from one verifies in the next', async () => {
    const a = await fresh<Jwt>('../jwt.js', { JWT_SECRET: LONG_A, VERIFICATION_TOKEN_SECRET: LONG_B });
    const b = await fresh<Jwt>('../jwt.js', { JWT_SECRET: LONG_A, VERIFICATION_TOKEN_SECRET: LONG_B });
    expect(await b.verifyToken(await a.signToken(payload))).toMatchObject(payload);
    expect(await b.verifyVerificationToken(await a.signVerificationToken('u-cvl'))).toEqual({ sub: 'u-cvl' });
  });

  it('a missing or short secret outside production falls back to a random one and says so', async () => {
    const a = await fresh<Jwt>('../jwt.js', { JWT_SECRET: 'short', VERIFICATION_TOKEN_SECRET: undefined, NODE_ENV: 'development' });
    const out = printed();
    expect(out).toContain('JWT_SECRET not set or too short - using a RANDOM secret');
    expect(out).toContain('VERIFICATION_TOKEN_SECRET not set or too short');
    // Its own tokens verify...
    const token = await a.signToken(payload);
    expect(await a.verifyToken(token)).toMatchObject(payload);
    // ...but a restart (another instance) cannot verify them.
    const b = await fresh<Jwt>('../jwt.js', { JWT_SECRET: 'short', NODE_ENV: 'development' });
    await expect(b.verifyToken(token)).rejects.toThrow();
  });

  it.each(['production', 'Staging'])('refuses to start in %s without a real secret', async (env) => {
    await expect(fresh<Jwt>('../jwt.js', { JWT_SECRET: 'short', NODE_ENV: env }))
      .rejects.toThrow('FATAL: JWT_SECRET must be set to a string of at least 32 characters in production/staging.');
  });

  it('clamps every token to JWT_EXPIRY_HOURS (default 1 h)', async () => {
    const dflt = await fresh<Jwt>('../jwt.js', { JWT_SECRET: LONG_A, VERIFICATION_TOKEN_SECRET: LONG_B, JWT_EXPIRY_HOURS: undefined });
    expect(dflt.JWT_MAX_EXPIRY_HOURS).toBe(1);
    const life = (t: string) => { const c = jose.decodeJwt(t); return (c.exp! - c.iat!) / 3600; };
    expect(life(await dflt.signToken(payload, 8))).toBe(1);

    const three = await fresh<Jwt>('../jwt.js', { JWT_SECRET: LONG_A, VERIFICATION_TOKEN_SECRET: LONG_B, JWT_EXPIRY_HOURS: '3' });
    expect(three.JWT_MAX_EXPIRY_HOURS).toBe(3);
    expect(life(await three.signToken(payload))).toBe(3);
    expect(life(await three.signToken(payload, 24))).toBe(3);
    expect(life(await three.signToken(payload, 2))).toBe(2);
  });

  it('pins HS256: a token signed with another algorithm is refused', async () => {
    const m = await fresh<Jwt>('../jwt.js', { JWT_SECRET: LONG_A, VERIFICATION_TOKEN_SECRET: LONG_B });
    const hs512 = await new jose.SignJWT({ ...payload }).setProtectedHeader({ alg: 'HS512' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(LONG_A));
    await expect(m.verifyToken(hs512)).rejects.toThrow();
  });
});

describe('offline-replay grant tokens', () => {
  it('an explicit OFFLINE_REPLAY_SECRET survives a restart', async () => {
    const a = await fresh<Offline>('../offline-replay-token.js', { OFFLINE_REPLAY_SECRET: LONG_A });
    const b = await fresh<Offline>('../offline-replay-token.js', { OFFLINE_REPLAY_SECRET: LONG_A });
    const { token, expiresAt } = await a.signOfflineReplayToken('u1', 's1', 2);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(2 * 3600_000 - 5000);
    expect(await b.verifyOfflineReplayToken(token, 'u1', 's1')).toMatchObject({ sub: 'u1', sid: 's1', typ: 'offline-replay' });
  });

  it('derived from JWT_SECRET it is per-process: a restart invalidates outstanding grants', async () => {
    const a = await fresh<Offline>('../offline-replay-token.js', { OFFLINE_REPLAY_SECRET: undefined, JWT_SECRET: LONG_A, NODE_ENV: 'development' });
    expect(printed()).toContain('OFFLINE_REPLAY_SECRET not set - deriving it from JWT_SECRET');
    const b = await fresh<Offline>('../offline-replay-token.js', { OFFLINE_REPLAY_SECRET: undefined, JWT_SECRET: LONG_A, NODE_ENV: 'development' });
    const { token } = await a.signOfflineReplayToken('u1', 's1');
    await expect(b.verifyOfflineReplayToken(token, 'u1', 's1')).rejects.toMatchObject({ code: 'OFFLINE_REPLAY_TOKEN_INVALID' });
    // Never derived from the JWT secret itself (domain separation).
    const jwtSigned = await new jose.SignJWT({ sub: 'u1', sid: 's1', typ: 'offline-replay' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h')
      .sign(new TextEncoder().encode(LONG_A));
    await expect(a.verifyOfflineReplayToken(jwtSigned, 'u1', 's1')).rejects.toMatchObject({ code: 'OFFLINE_REPLAY_TOKEN_INVALID' });
  });

  it('with neither secret set it still works for the process, and warns', async () => {
    const m = await fresh<Offline>('../offline-replay-token.js', { OFFLINE_REPLAY_SECRET: 'too-short', JWT_SECRET: undefined, NODE_ENV: 'development' });
    expect(printed()).toContain('OFFLINE_REPLAY_SECRET and JWT_SECRET both unset');
    const { token } = await m.signOfflineReplayToken('u2', 's2');
    expect((await m.verifyOfflineReplayToken(token, 'u2', 's2')).sub).toBe('u2');
  });

  it.each(['production', 'staging'])('refuses to start in %s without OFFLINE_REPLAY_SECRET', async (env) => {
    await expect(fresh<Offline>('../offline-replay-token.js', { OFFLINE_REPLAY_SECRET: undefined, NODE_ENV: env }))
      .rejects.toThrow('FATAL: OFFLINE_REPLAY_SECRET must be set');
  });

  it('reports an expired grant as EXPIRED, not as a bad signature', async () => {
    const m = await fresh<Offline>('../offline-replay-token.js', { OFFLINE_REPLAY_SECRET: LONG_A });
    const { token } = await m.signOfflineReplayToken('u3', 's3', 1);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2 * 3600_000);
    await expect(m.verifyOfflineReplayToken(token, 'u3', 's3')).rejects.toMatchObject({
      name: 'OfflineReplayTokenError', code: 'OFFLINE_REPLAY_TOKEN_EXPIRED',
      message: 'Offline-replay grant has expired. Log in again to obtain a new grant.',
    });
  });

  it('refuses a correctly signed token that is not an offline-replay grant', async () => {
    const m = await fresh<Offline>('../offline-replay-token.js', { OFFLINE_REPLAY_SECRET: LONG_A });
    const session = await new jose.SignJWT({ sub: 'u4', sid: 's4', typ: 'session' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h')
      .sign(new TextEncoder().encode(LONG_A));
    await expect(m.verifyOfflineReplayToken(session, 'u4', 's4')).rejects.toMatchObject({ code: 'OFFLINE_REPLAY_TOKEN_WRONG_TYPE' });
    expect(m.OFFLINE_REPLAY_TOKEN_HEADER).toBe('x-offline-replay-token');
    expect(m.LEGACY_OFFLINE_REPLAY_HEADER).toBe('x-offline-replay');
  });
});
