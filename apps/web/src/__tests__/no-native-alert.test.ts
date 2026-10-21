/**
 * The browser's own alert() blocks the whole page until dismissed, cannot be
 * styled, and stalls browser automation (CLAUDE.md: never trigger it). The app
 * shows messages through its toasts / MessageDialog. The last three calls (the
 * notification-rule test-fire and template save, 2026-10-21) are gone; this
 * keeps it that way. `window.confirm` (a yes/no question) is not covered here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
  });
}

describe('no native alert()', () => {
  it('no source file calls alert() / window.alert()', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, ''); // ignore line comments
        if (/(^|[^.\w])alert\(|window\.alert\(/.test(code)) {
          offenders.push(`${relative(SRC, file).replace(/\\/g, '/')}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
