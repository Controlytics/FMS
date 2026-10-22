/**
 * The browser's own alert() blocks the whole page until dismissed, cannot be
 * styled, and stalls browser automation (CLAUDE.md: never trigger it). The app
 * shows messages through its toasts / MessageDialog. The last three calls (the
 * notification-rule test-fire and template save, 2026-10-21) are gone; this
 * keeps it that way. `window.confirm` (a yes/no question) is not covered here.
 */
import { describe, it, expect } from 'vitest';
import { relative } from 'node:path';
import { listFiles, readSource, WEB_SRC } from './support/source-files';

const SRC = WEB_SRC;

describe('no native alert()', () => {
  it('no source file calls alert() / window.alert()', () => {
    const offenders: string[] = [];
    const files = listFiles(SRC, (name) => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name), ['__tests__', 'node_modules']);
    for (const file of files) {
      const text = readSource(file);
      if (!text.includes('alert(')) continue; // both patterns below contain it
      text.split(/\r?\n/).forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, ''); // ignore line comments
        if (/(^|[^.\w])alert\(|window\.alert\(/.test(code)) {
          offenders.push(`${relative(SRC, file).replace(/\\/g, '/')}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
