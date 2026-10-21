/**
 * Item 9 (2026-10-21) — a dismissed password prompt is the operator's choice,
 * not a failure.
 *
 * `useReauth().cancel` calls the pending `onCancel`; when a call site passed
 * none it falls back to `onError` with "Cancelled — password confirmation was
 * not completed." Config pages rendered that as a failure: a "Save failed" /
 * "Update Failed" modal (access-matrix, branding, cleaning-profile-assignment),
 * a red banner (equipment-groups, datetime, password-policy, …) or inside the
 * green "Saved" notice (dashboard-cards). So every `<hook>.execute(` call on a
 * `useReauth()` hook under routes/config must pass `onCancel`.
 *
 * `executeWithResult` callers are not covered here: they reject with
 * REAUTH_CANCELLED and handle it in their own catch (`isReauthCancelled`).
 *
 * Source-level, like signed-writes-guard.test.ts: the per-page behaviour is
 * asserted by each page's "(item 9)" cancel tests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(__dirname, '..');

/** Every non-test .tsx under routes/config. */
function configFiles(dir = ROOT): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__') out.push(...configFiles(p)); }
    else if (p.endsWith('.tsx') && !p.endsWith('.test.tsx')) out.push(p);
  }
  return out;
}

/**
 * Replace comments with spaces (newlines kept, so offsets and line numbers
 * survive). A comment such as "the operator's choice" would otherwise open a
 * string for the call scanner below. Strings and template literals — including
 * nested `${…}` — are kept as written.
 */
function stripComments(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  // Stack of contexts: 'code' (with its open-brace depth) or 'template'.
  const stack: { kind: 'code' | 'template'; braces: number }[] = [{ kind: 'code', braces: 0 }];
  let i = 0;
  while (i < src.length) {
    const top = stack[stack.length - 1];
    const c = src[i];
    if (top.kind === 'template') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); i++; continue; }
      if (c === '$' && src[i + 1] === '{') { stack.push({ kind: 'code', braces: 0 }); i += 2; continue; }
      i++; continue;
    }
    if (c === '/' && src[i + 1] === '/') { const end = src.indexOf('\n', i); const stop = end === -1 ? src.length : end; blank(i, stop); i = stop; continue; }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); const stop = end === -1 ? src.length : end + 2; blank(i, stop); i = stop; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      i = j + 1; continue;
    }
    if (c === '`') { stack.push({ kind: 'template', braces: 0 }); i++; continue; }
    if (c === '{') top.braces++;
    if (c === '}') {
      if (top.braces === 0 && stack.length > 1) { stack.pop(); i++; continue; } // end of `${…}`
      top.braces--;
    }
    i++;
  }
  return out.join('');
}

/** The argument text of the call whose '(' is at `open`, skipping string and template contents. */
function callArgs(src: string, open: number): string {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      i = j + 1; continue;
    }
    if (c === '`') {
      // Skip a template literal, including nested `${ … }` expressions.
      let j = i + 1; let nest = 0;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (nest === 0 && src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') { nest++; j += 2; continue; }
        if (nest > 0 && src[j] === '}') nest--;
        j++;
      }
      i = j + 1; continue;
    }
    if (c === '(') depth++;
    if (c === ')') { depth--; if (depth === 0) return src.slice(open + 1, i); }
    i++;
  }
  throw new Error(`unbalanced call starting at offset ${open}`);
}

/** Every reauth `.execute(` call in a file, as `file:line`, and whether it passes onCancel. */
function executeCalls(file: string): { site: string; hasOnCancel: boolean }[] {
  const src = stripComments(readFileSync(file, 'utf8'));
  // A file may hold several components, each with its own `const reauth = useReauth()`.
  const hooks = new Set([...src.matchAll(/\bconst\s+(\w+)\s*=\s*useReauth\(\)/g)].map((m) => m[1]));
  const found: { site: string; hasOnCancel: boolean }[] = [];
  for (const hook of hooks) {
    for (const m of src.matchAll(new RegExp(`\\b${hook}\\.execute\\(`, 'g'))) {
      const open = m.index! + m[0].length - 1;
      const args = callArgs(src, open);
      const line = src.slice(0, m.index).split('\n').length;
      found.push({ site: `${relative(ROOT, file).split('\\').join('/')}:${line}`, hasOnCancel: /\bonCancel\b/.test(args) });
    }
  }
  return found;
}

describe('a cancelled password prompt is not reported as a failure (item 9)', () => {
  const sites = configFiles().flatMap(executeCalls);

  it('the scan finds the reauth.execute call sites (guards against a scanner that matches nothing)', () => {
    // backup (2), branding, equipment-groups (2), … — well over a dozen today.
    expect(sites.length).toBeGreaterThan(15);
  });

  it('every reauth .execute( call under routes/config passes onCancel', () => {
    expect(sites.filter((s) => !s.hasOnCancel).map((s) => s.site)).toEqual([]);
  });

  it('the scanner ignores comments and strings, and reads options past nested calls', () => {
    const probe = stripComments([
      "const reauth = useReauth();",
      "// reauth.execute('X', f) in a comment does not count, nor the operator's apostrophe",
      "reauth.execute('A', async (pw) => { await put(`/x/${id(1)}`, { a: ')' }); }, {",
      "  onError: (e) => fail(e), // the operator's choice",
      "  onCancel: () => done(),",
      "});",
    ].join('\n'));
    const open = probe.indexOf('reauth.execute(') + 'reauth.execute'.length;
    expect(probe.indexOf("reauth.execute('X'")).toBe(-1);
    expect(callArgs(probe, open)).toMatch(/onCancel: \(\) => done\(\)/);
  });
});
