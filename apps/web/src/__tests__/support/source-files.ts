/**
 * Directory walks for the source-guard tests (tests that read apps/web/src as text
 * and fail on a forbidden pattern).
 *
 * The guards each called `statSync` on every entry they met (~400 per scan of
 * src), one walked and read routes/ twice, and each split every file into lines
 * before looking for its pattern. A guard costs ~0.3 s alone, but in a loaded
 * parallel run (96 files) that crossed the 5 s test timeout (2026-10-22).
 * `listFiles` lists each folder once, with its file types (no stat per entry),
 * and `readSource` reads a file once however many checks in a test file ask.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** apps/web/src */
export const WEB_SRC = join(__dirname, '..', '..');

/**
 * Every file under `dir` whose NAME passes `keep`. Folders named in `skipDirs`
 * are not entered at all.
 */
export function listFiles(dir: string, keep: (name: string) => boolean, skipDirs: readonly string[] = ['__tests__']): string[] {
  const out: string[] = [];
  const visit = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skipDirs.includes(entry.name)) visit(join(folder, entry.name));
      } else if (keep(entry.name)) {
        out.push(join(folder, entry.name));
      }
    }
  };
  visit(dir);
  return out;
}

const texts = new Map<string, string>();

/** A file's text, read from disk once per test file. */
export function readSource(path: string): string {
  let text = texts.get(path);
  if (text === undefined) {
    text = readFileSync(path, 'utf8');
    texts.set(path, text);
  }
  return text;
}
