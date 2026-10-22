import { describe, it, expect } from 'vitest';
import { join, relative } from 'node:path';
import { listFiles, readSource, WEB_SRC } from '@/__tests__/support/source-files';

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
const SRC = WEB_SRC;
const ALLOWED = new Set(['routes/config/password-policy.tsx']);

describe('password policy is read from /current', () => {
  it('no page but the policy editor reads the CONFIG_READ-gated endpoint', () => {
    const offenders = listFiles(SRC, (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
      .map((f) => relative(SRC, f).replace(/\\/g, '/'))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => {
        const text = readSource(join(SRC, rel));
        // The check below needs the endpoint spelled out: a file without it
        // cannot match, and is not stripped of comments.
        if (!text.includes('/api/config/password-policy')) return false;
        // Code only: comments may name the bare endpoint to explain why not.
        const code = text
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
        return /['"`]\/api\/config\/password-policy['"`]/.test(code);
      });
    expect(offenders).toEqual([]);
  });
});
