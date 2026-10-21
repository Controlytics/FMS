import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainTsx = readFileSync(resolve(__dirname, '../main.tsx'), 'utf8');

/**
 * Every route either renders inside <RequireRole> or is named here with the
 * reason it does not. A new route without a guard fails this test (A-15,
 * 2026-10-21: the previous "loose lock" only checked that main.tsx parsed).
 * The guard is a UX gate; the API enforces the real permission either way.
 */
const UNGUARDED: Record<string, string> = {
  // Signed-out screens: there is no user yet.
  '/login': 'sign-in',
  '/forgot-password': 'signed-out password reset request',
  '/change-password': 'forced change before a session is usable',
  '/contact-admin': 'signed-out help page',
  '/guest-request': 'signed-out access request',
  '/m/login': 'tablet sign-in',
  '/m/forgot-password': 'tablet password reset request',
  '/m/server-config': 'tablet server address, needed before sign-in',
  '/m': 'tablet shell; signs in and checks tablet access itself (lib/tablet-access.ts)',
  // Inside AppLayout (signed in), open to every role on purpose.
  '/': 'dashboard - every signed-in user',
  '/home': 'module guide - governed by the sidebar config, grants nothing',
  '/profile': 'own profile',
  // Gated inside the page; the API gates the data.
  '/quality-notifications': 'page asks GET /api/pm-schedules/qnn/visible; /qnn is server-gated by canSeeQnn',
  '*': 'redirect to /',
};

/** `<Route path="..." element={...} />` → path + the element source. */
function routes(src: string): { path: string; element: string }[] {
  const out: { path: string; element: string }[] = [];
  const re = /<Route\s+path="([^"]+)"\s+element=\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // Walk to the brace that closes `element={`.
    let depth = 1;
    let i = re.lastIndex;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    out.push({ path: m[1], element: src.slice(re.lastIndex, i - 1) });
  }
  return out;
}

describe('route-guard coverage', () => {
  const all = routes(mainTsx);

  it('parses main.tsx', () => {
    expect(all.length).toBeGreaterThan(70);
  });

  it('every route outside the allowlist renders inside <RequireRole>', () => {
    const unguarded = all
      .filter((r) => !(r.path in UNGUARDED))
      .filter((r) => !/^\s*<RequireRole[\s>]/.test(r.element))
      .map((r) => r.path);
    expect(unguarded, 'add a RequireRole, or list the route in UNGUARDED with its reason').toEqual([]);
  });

  it('every allowlist entry is still a route (no stale exceptions)', () => {
    const paths = new Set(all.map((r) => r.path));
    expect(Object.keys(UNGUARDED).filter((p) => !paths.has(p))).toEqual([]);
  });

  it('control: the parser does see a guard on a known guarded route', () => {
    const audit = all.find((r) => r.path === '/audit');
    expect(audit?.element).toMatch(/^\s*<RequireRole permissions=\{\[PERMISSIONS\.AUDIT_READ\]\}>/);
  });
});
