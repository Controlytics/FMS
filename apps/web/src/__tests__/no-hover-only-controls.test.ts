/**
 * A control that is invisible until the mouse hovers it does not exist on a
 * tablet (no hover) and is hard to find by keyboard. CLAUDE.md recorded 17 such
 * clusters fixed on 2026-08-27; UI Phase 2 (2026-10-21) found five more (checklist
 * card delete, profile photo upload, three hierarchy-diagram edit/delete clusters,
 * the pipeline editor's node delete). Rule: anything hidden with `opacity-0` and
 * revealed by `group-hover:opacity-100` must also be shown on coarse pointers.
 * Decorative hover tints (e.g. `group-hover:opacity-5`) are not controls and are
 * not matched.
 */
import { describe, it, expect } from 'vitest';
import { relative } from 'node:path';
import { listFiles, readSource, WEB_SRC } from './support/source-files';

const SRC = WEB_SRC;

describe('no hover-only controls', () => {
  it('every opacity-0 + group-hover:opacity-100 element is also visible on touch screens', () => {
    const offenders: string[] = [];
    for (const file of listFiles(SRC, (name) => name.endsWith('.tsx'), ['__tests__', 'node_modules'])) {
      const text = readSource(file);
      // a matching line holds both of these, so a file without either has none
      if (!text.includes('opacity-0') || !text.includes('group-hover')) continue;
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/\bopacity-0\b/.test(line) && /group-hover(?:\/[\w-]+)?:opacity-100/.test(line)
          && !/\[@media\(pointer:coarse\)\]:opacity-100/.test(line)) {
          offenders.push(`${relative(SRC, file).replace(/\\/g, '/')}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
