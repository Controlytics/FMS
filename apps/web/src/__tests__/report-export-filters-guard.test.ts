/**
 * Every report export records the filters that produced it (2026-10-22).
 *
 * The REPORT_GENERATED audit row said `search: null` although the page had a
 * filter-name search applied, and no export recorded its block / area / AHU /
 * filter / status at all: an inspector could see THAT a report was exported and
 * how many rows, never WHICH rows. Each page now passes `filters` (label → the
 * value the operator chose) to the shared export-log call; the page tests check
 * the values, this guard keeps a new export from forgetting them.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..');
const CALL = /\b(requireExportReauth|logReportExportOrWarn|logReportExport)\(/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

/** The first `{ ... }` argument of the call starting at `from`, braces balanced. */
function objectArg(src: string, from: number): string | null {
  const open = src.indexOf('{', from);
  const close = src.indexOf(')', from);
  if (open < 0 || (close >= 0 && close < open && !src.slice(from, close).includes(','))) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

describe('report exports record their filters', () => {
  it('every export-log call in a page passes `filters`', () => {
    const offenders: string[] = [];
    let calls = 0;
    for (const file of [...walk(join(SRC, 'routes')), ...walk(join(SRC, 'components'))]) {
      const src = readFileSync(file, 'utf-8');
      for (const m of src.matchAll(CALL)) {
        const arg = objectArg(src, m.index! + m[0].length);
        if (!arg || !/\breportType\s*:/.test(arg)) continue; // not an export-log input literal
        calls++;
        if (!/\bfilters\b/.test(arg)) {
          const line = src.slice(0, m.index).split('\n').length;
          offenders.push(`${relative(SRC, file).replace(/\\/g, '/')}:${line}`);
        }
      }
    }
    expect(calls).toBeGreaterThanOrEqual(20); // 12 reports, most with a PDF and an Excel export
    expect(offenders).toEqual([]);
  });
});
