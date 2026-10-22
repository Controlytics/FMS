/**
 * A dismissed password prompt is a choice, not a failure (2026-10-22).
 *
 * `useReauth().cancel()` calls the caller's `onCancel`; without one it falls back
 * to `onError` with "Cancelled — password confirmation was not completed." (so a
 * caller that forgot can never hang). That fallback is why ~40 call sites showed
 * an error dialog — or a red banner — when the operator simply closed the prompt
 * (D-OPS-8 and the admin-pages round). The fix at each site is the same: pass
 * `onCancel` that resets the busy state and says nothing.
 *
 * This source guard keeps it that way:
 *   - every `reauth.execute(action, cb, opts)` passes an options object WITH
 *     `onCancel` (no options at all also swallows real failures: refused);
 *   - every `reauth.executeWithResult(...)` (which REJECTS on cancel) sits in a
 *     catch that recognises a cancel (isReauthCancelled / isReauthAbort /
 *     signOnce / 'REAUTH_CANCELLED', directly or through a local helper), or is
 *     returned from a wrapper whose file holds that recognition (stage-reauth's
 *     preauthorize -> signOnce, filter-data-management's gated -> isReauthAbort);
 *   - a helper that FORWARDS its caller's callbacks into execute
 *     (`onCancel: opts.onCancel`) moves the duty to its callers, so their
 *     callbacks object must carry `onCancel` too. Such helpers are listed in
 *     FORWARDERS, and an unlisted forwarder fails the guard by itself.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const SRC = join(__dirname, '..');
const CANCEL_CHECK = /\bisReauthCancelled\b|\bisReauthAbort\b|\bsignOnce\b|['"]REAUTH_CANCELLED['"]/;

interface Forwarder {
  /** File (relative to src) that defines the helper. */
  file: string;
  /** How call sites spell the helper (`name(...)` or `x.name(...)`). */
  name: string;
  /** Index of the callbacks argument. */
  optsIndex: number;
}
const FORWARDERS: Forwarder[] = [
  { file: 'lib/filter-lifecycle-actions.ts', name: 'retireOrReplaceFilter', optsIndex: 4 },
  // useBlockChangeApproval().process — its only page destructures it as processBlockChange.
  { file: 'hooks/use-block-change-approval.ts', name: 'processBlockChange', optsIndex: 3 },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [p] : [];
  });
}

/**
 * Offending re-auth calls in one source file, as "line: what is wrong".
 * `forwarders` are helpers whose callers must pass `onCancel` themselves;
 * `forwarding` collects every execute in this file that forwards a caller's
 * `onCancel` (the definitions FORWARDERS must list); `forwarderCalls` counts the
 * calls matched per forwarder (a stale pattern would otherwise check nothing).
 */
export function findUnhandledCancels(
  fileName: string,
  source: string,
  forwarders: Pick<Forwarder, 'name' | 'optsIndex'>[] = [],
  forwarding: number[] = [],
  forwarderCalls: number[] = [],
): string[] {
  // Cheap pre-filter (the full scan of src is otherwise slow): nothing to check
  // in a file that names neither execute* nor a forwarder.
  if (!source.includes('execute') && !forwarders.some((f) => source.includes(f.name))) return [];
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const usesReauth = /useReauth|ReturnType<typeof useReauth>/.test(source);
  const fileHasCancelCheck = CANCEL_CHECK.test(source);

  // Local helpers whose body recognises a cancel, e.g. `const failed = (e) => { if (!isReauthCancelled(e)) ... }`.
  const cancelHelpers = new Set<string>();
  const collect = (node: ts.Node) => {
    if (!fileHasCancelCheck) return;
    if (ts.isFunctionDeclaration(node) && node.name && CANCEL_CHECK.test(node.getText(sf))) cancelHelpers.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      && CANCEL_CHECK.test(node.initializer.getText(sf))) cancelHelpers.add(node.name.text);
    ts.forEachChild(node, collect);
  };
  collect(sf);
  const recognises = (text: string) => CANCEL_CHECK.test(text)
    || [...cancelHelpers].some((h) => new RegExp(`\\b${h}\\s*\\(`).test(text));

  const out: string[] = [];
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const hasOnCancel = (o: ts.ObjectLiteralExpression) => o.properties.some((p) => p.name && p.name.getText(sf) === 'onCancel');

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      const fi = forwarders.findIndex((f) => callee === f.name || callee.endsWith(`.${f.name}`));
      const fwd = forwarders[fi];
      if (fwd) {
        forwarderCalls[fi] = (forwarderCalls[fi] ?? 0) + 1;
        const opts = node.arguments[fwd.optsIndex];
        if (!opts || !ts.isObjectLiteralExpression(opts) || !hasOnCancel(opts)) {
          out.push(`${line(node)}: ${callee}(…) callbacks without onCancel — the helper forwards them to execute, so a cancel is reported as an error`);
        }
      }
    }
    if (ts.isCallExpression(node) && node.arguments.length >= 2) {
      const callee = node.expression.getText(sf);
      const m = callee.match(/(?:^|\.)(execute|executeWithResult)$/);
      if (m && (/reauth/i.test(callee) || usesReauth)) {
        const action = node.arguments[0].getText(sf).replace(/\s+/g, ' ').slice(0, 50);
        if (m[1] === 'execute') {
          const opts = node.arguments[2];
          if (!opts) out.push(`${line(node)}: execute(${action}) has no options — a failure is swallowed and a cancel is not handled`);
          else if (!ts.isObjectLiteralExpression(opts)) out.push(`${line(node)}: execute(${action}) options are not an object literal (check onCancel by hand)`);
          else if (!hasOnCancel(opts)) out.push(`${line(node)}: execute(${action}) passes options without onCancel — a cancel is reported as an error`);
          else {
            const prop = opts.properties.find((p) => p.name && p.name.getText(sf) === 'onCancel');
            if (prop && ts.isPropertyAssignment(prop) && ts.isPropertyAccessExpression(prop.initializer)
              && prop.initializer.name.text === 'onCancel') forwarding.push(line(node));
          }
        } else {
          let p: ts.Node | undefined = node.parent;
          let ok = false;
          let child: ts.Node = node;
          while (p && !ok) {
            if (ts.isTryStatement(p) && p.tryBlock === child && p.catchClause) { ok = recognises(p.catchClause.getText(sf)); break; }
            if (ts.isCallExpression(p) && /\.catch$/.test(p.expression.getText(sf))) { ok = recognises(p.arguments.map((a) => a.getText(sf)).join(' ')); break; }
            if (ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === child)) { ok = fileHasCancelCheck; break; }
            if (ts.isFunctionLike(p)) break;
            child = p;
            p = p.parent;
          }
          if (!ok) out.push(`${line(node)}: executeWithResult(${action}) has no cancel-aware catch — a cancel rejects unhandled or shows as an error`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe('re-auth cancel handling — guard self-test', () => {
  const file = (body: string) => `import { useReauth } from '@/hooks/use-reauth';\n${body}`;

  it('flags an execute without onCancel, without options, and an executeWithResult in a plain catch', () => {
    expect(findUnhandledCancels('a.tsx', file(`
      reauth.execute('A', async () => {}, { onError: () => {} });
      reauth.execute('B', async () => {});
      async function f() { try { await reauth.executeWithResult('C', async () => 1); } catch (e) { show(e); } }
    `))).toEqual([
      expect.stringContaining("execute('A') passes options without onCancel"),
      expect.stringContaining("execute('B') has no options"),
      expect.stringContaining("executeWithResult('C') has no cancel-aware catch"),
    ]);
  });

  it('accepts onCancel, a cancel-aware catch (direct or via a local helper) and a wrapper in a file that recognises cancels', () => {
    expect(findUnhandledCancels('b.tsx', file(`
      reauth.execute('A', async () => {}, { onError: () => {}, onCancel: () => {} });
      const failed = (err) => { if (!isReauthCancelled(err)) setError(err); };
      async function f() { try { await reauth.executeWithResult('C', async () => 1); } catch (e) { failed(e); } }
      async function g() { try { await reauth.executeWithResult('D', async () => 1); } catch (e) { if (!isReauthCancelled(e)) show(e); } }
      const gated = (a, fn) => reauth.executeWithResult(a, fn);
    `))).toEqual([]);
  });

  it('a forwarding helper is reported, and its callers must pass onCancel', () => {
    const forwarding: number[] = [];
    expect(findUnhandledCancels('h.ts', file(`
      export function help(reauth, cb) { reauth.execute('A', async () => {}, { onError: cb.onError, onCancel: cb.onCancel }); }
    `), [], forwarding)).toEqual([]);
    expect(forwarding).toEqual([3]);

    const fwd = [{ name: 'help', optsIndex: 1 }];
    expect(findUnhandledCancels('p.tsx', file(`
      help(reauth, { onError: () => {} });
      help(reauth, { onError: () => {}, onCancel: () => {} });
      help(reauth);
    `), fwd)).toEqual([
      expect.stringMatching(/^3: help\(…\) callbacks without onCancel/),
      expect.stringMatching(/^5: help\(…\) callbacks without onCancel/),
    ]);
  });
});

describe('re-auth cancel handling — every call site in apps/web/src', () => {
  // One parse per file, shared by both checks (scanning all of src twice was slow).
  const offenders: string[] = [];
  const forwardingFiles: string[] = [];
  const forwarderCalls: number[] = [];
  beforeAll(() => {
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f).split('\\').join('/');
      if (rel === 'hooks/use-reauth.ts') continue; // the hook itself
      const forwarding: number[] = [];
      offenders.push(...findUnhandledCancels(rel, readFileSync(f, 'utf-8'), FORWARDERS, forwarding, forwarderCalls).map((o) => `${rel}:${o}`));
      if (forwarding.length > 0) forwardingFiles.push(rel);
    }
    forwardingFiles.sort();
  }, 120_000);

  it('passes onCancel (execute, or a helper that forwards to it) or recognises a cancel (executeWithResult)', () => {
    expect(offenders).toEqual([]);
  });

  it('every helper that forwards its caller\'s onCancel is listed in FORWARDERS, and each listed one has callers', () => {
    expect(forwardingFiles).toEqual(FORWARDERS.map((f) => f.file).sort());
    // A stale name would check nothing and pass silently.
    FORWARDERS.forEach((f, i) => expect(forwarderCalls[i] ?? 0, `no call site of ${f.name}`).toBeGreaterThan(0));
  });
});
