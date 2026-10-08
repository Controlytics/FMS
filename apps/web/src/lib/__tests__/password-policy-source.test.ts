import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Every page that GENERATES or CHECKS a password reads the policy from
 * `/api/config/password-policy/current` (any signed-in user), never the bare
 * `/api/config/password-policy` (CONFIG_READ). Without CONFIG_READ the bare one
 * 403s and the page silently falls back to DEFAULT_PASSWORD_POLICY - a
 * temporary password at the default length, not the configured one
 * (2026-10-07; change-password had the same bug earlier).
 *
 * Only the Password Policy config page itself, which edits the setting and is
 * CONFIG_READ-gated, may read the bare endpoint.
 */
const SRC = join(__dirname, '..', '..');
const ALLOWED = new Set(['routes/config/password-policy.tsx']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p, out); }
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('password policy is read from /current', () => {
  it('no page but the policy editor reads the CONFIG_READ-gated endpoint', () => {
    const offenders = walk(SRC)
      .map((f) => relative(SRC, f).replace(/\\/g, '/'))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => {
        // Code only: comments may name the bare endpoint to explain why not.
        const code = readFileSync(join(SRC, rel), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
        return /['"`]\/api\/config\/password-policy['"`]/.test(code);
      });
    expect(offenders).toEqual([]);
  });
});
