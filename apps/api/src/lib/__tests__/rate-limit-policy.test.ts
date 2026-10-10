import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';

/**
 * Rate-limit policy (operator decision 2026-10-10): NO global limit and no
 * per-route limits, EXCEPT the three password endpoints — login, re-auth
 * verify, change-password. SUPER_ADMIN is exempt from account lockout, so those
 * three are the only brake on guessing its password.
 */
const SRC = join(__dirname, '..', '..');

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : routeFiles(p);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
  });
}

describe('rate-limit policy', () => {
  it('only the three password endpoints declare a route rate limit', () => {
    const hits: string[] = [];
    for (const f of routeFiles(join(SRC, 'modules'))) {
      const lines = readFileSync(f, 'utf8').split(/\r?\n/);
      lines.forEach((l, i) => {
        if (/rateLimit:\s*\{/.test(l)) hits.push(`${relative(SRC, f).replace(/\\/g, '/')}:${i + 1}`);
      });
    }
    expect(hits.every((h) => h.startsWith('modules/auth/routes.ts:'))).toBe(true);
    expect(hits).toHaveLength(3);

    const auth = readFileSync(join(SRC, 'modules', 'auth', 'routes.ts'), 'utf8');
    for (const url of ['/login', '/verify', '/change-password']) {
      const at = auth.indexOf(`app.post('${url}'`);
      expect(at, url).toBeGreaterThan(-1);
      expect(auth.slice(at, at + 600), url).toMatch(/rateLimit:\s*\{/);
    }
  });

  it('app.ts registers the plugin with global: false (no app-wide limit)', () => {
    const app = readFileSync(join(SRC, 'app.ts'), 'utf8');
    const reg = app.slice(app.indexOf('app.register(rateLimit'));
    expect(reg.slice(0, 200)).toMatch(/global:\s*false/);
    expect(reg.slice(0, 200)).not.toMatch(/\bmax:/);
  });

  it('global: false leaves unconfigured routes unlimited and still enforces a route limit', async () => {
    const app = Fastify();
    await app.register(rateLimit, { global: false });
    app.get('/open', async () => ({ ok: true }));
    app.post('/login', { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } }, async () => ({ ok: true }));
    await app.ready();

    for (let i = 0; i < 50; i++) {
      expect((await app.inject({ method: 'GET', url: '/open' })).statusCode).toBe(200);
    }
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await app.inject({ method: 'POST', url: '/login' })).statusCode);
    expect(codes).toEqual([200, 200, 429]);
    await app.close();
  });
});
