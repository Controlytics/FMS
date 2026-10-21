/**
 * A-15 (2026-10-21): every notification `type` the code inserts must be a
 * NotificationType enum value.
 *
 * QA-D005: three types (BLOCK_CHANGE_*) were not in the enum for five months —
 * every insert failed Postgres's enum check and the notification was silently
 * lost. The TypeScript types could not catch it: createNotification's `type` was
 * a hand-written union and the repository / dispatcher cast it `as any`.
 *
 * This walks the SYNTAX TREE of every non-test file under apps/api/src, finds
 * each notification insert call — createNotification(...),
 * notificationRepository.create(...), <client>.notification.create / createMany
 * — and resolves its `type`:
 *   - a string literal, or BOTH arms of a (nested) ternary;
 *   - `...spread` of an object literal declared in the same file;
 *   - a shorthand `type` / identifier resolved to a parameter whose type is a
 *     union of string literals (directly or through a type alias), or to a
 *     const initialised with a literal.
 * Every literal found must be in `enum NotificationType` read from
 * prisma/schema.prisma, and no site may cast the type through `any` / `unknown`
 * (that is what hid the drift). Sites whose type is a non-literal expression are
 * left to tsc: createNotification and the repository are typed with Prisma's
 * generated NotificationType.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // apps/api/src
const SCHEMA = join(SRC, '..', 'prisma', 'schema.prisma');

function readEnum(name: string): Set<string> {
  const schema = readFileSync(SCHEMA, 'utf-8');
  const block = new RegExp(`^enum ${name} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema);
  if (!block) throw new Error(`enum ${name} not found in ${SCHEMA}`);
  const values = block[1]
    .split('\n')
    .map(l => l.replace(/\/\/.*$/, '').trim())
    .filter(l => l && !l.startsWith('@@'))
    .map(l => l.split(/\s+/)[0]);
  return new Set(values);
}

interface Site {
  file: string;
  line: number;
  callee: string;
  literals: string[];
  /** true when the type expression could not be reduced to literals */
  nonLiteral: boolean;
  /** true when the type goes through `as any` / `as unknown` */
  cast: boolean;
}

const INSERT_CALLEE = /^(createNotification|(?:[\w$.]+\.)?notificationRepository\.create|(?:[\w$.]+\.)?notification\.(?:create|createMany))$/;

export function scanSource(file: string, text: string): Site[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sites: Site[] = [];

  const findVariable = (name: string): ts.VariableDeclaration | undefined => {
    let found: ts.VariableDeclaration | undefined;
    const walk = (n: ts.Node) => {
      if (found) return;
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) found = n;
      ts.forEachChild(n, walk);
    };
    walk(sf);
    return found;
  };
  const findTypeAlias = (name: string): ts.TypeAliasDeclaration | undefined =>
    sf.statements.find((s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === name);
  const findParameter = (from: ts.Node, name: string): ts.ParameterDeclaration | undefined => {
    for (let n: ts.Node | undefined = from; n; n = n.parent) {
      if (ts.isFunctionLike(n)) {
        const p = n.parameters.find(q => ts.isIdentifier(q.name) && q.name.text === name);
        if (p) return p;
      }
    }
    return undefined;
  };

  /** Literal values a type node can take; null when it is not a literal union. */
  const fromTypeNode = (t: ts.TypeNode | undefined, seen = new Set<string>()): string[] | null => {
    if (!t) return null;
    if (ts.isUnionTypeNode(t)) {
      const parts = t.types.map(x => fromTypeNode(x, seen));
      return parts.every(Boolean) ? parts.flat() as string[] : null;
    }
    if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) return [t.literal.text];
    if (ts.isParenthesizedTypeNode(t)) return fromTypeNode(t.type, seen);
    if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName) && !seen.has(t.typeName.text)) {
      seen.add(t.typeName.text);
      const alias = findTypeAlias(t.typeName.text);
      return alias ? fromTypeNode(alias.type, seen) : null;
    }
    return null;
  };

  /** Resolve a `type` initializer to literals; marks casts / non-literals on `acc`. */
  const collect = (e: ts.Expression, acc: { literals: string[]; nonLiteral: boolean; cast: boolean }, depth = 0): void => {
    if (depth > 8) { acc.nonLiteral = true; return; }
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) { acc.literals.push(e.text); return; }
    if (ts.isConditionalExpression(e)) { collect(e.whenTrue, acc, depth + 1); collect(e.whenFalse, acc, depth + 1); return; }
    if (ts.isParenthesizedExpression(e)) { collect(e.expression, acc, depth + 1); return; }
    if (ts.isAsExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e)) {
      const k = e.type.kind;
      if (k === ts.SyntaxKind.AnyKeyword || k === ts.SyntaxKind.UnknownKeyword) acc.cast = true;
      collect(e.expression, acc, depth + 1);
      return;
    }
    if (ts.isIdentifier(e)) {
      const param = findParameter(e, e.text);
      const fromParam = param ? fromTypeNode(param.type) : null;
      if (fromParam) { acc.literals.push(...fromParam); return; }
      const v = findVariable(e.text);
      if (v?.initializer && !param) { collect(v.initializer, acc, depth + 1); return; }
    }
    acc.nonLiteral = true;
  };

  /** The `type` of one record object (following `...spread` of same-file object literals). */
  const recordType = (obj: ts.ObjectLiteralExpression, acc: { literals: string[]; nonLiteral: boolean; cast: boolean; found: boolean }, depth = 0) => {
    for (const p of obj.properties) {
      if (ts.isPropertyAssignment(p) && p.name.getText(sf) === 'type') { acc.found = true; collect(p.initializer, acc); }
      else if (ts.isShorthandPropertyAssignment(p) && p.name.text === 'type') { acc.found = true; collect(p.name, acc); }
      else if (ts.isSpreadAssignment(p) && ts.isIdentifier(p.expression) && depth < 4) {
        const v = findVariable(p.expression.text);
        if (v?.initializer && ts.isObjectLiteralExpression(v.initializer)) recordType(v.initializer, acc, depth + 1);
      }
    }
  };

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      if (INSERT_CALLEE.test(callee) && n.arguments[0]) {
        const acc = { literals: [] as string[], nonLiteral: false, cast: false, found: false };
        const arg = n.arguments[0];
        if (ts.isObjectLiteralExpression(arg)) {
          const isPrisma = /notification\.(create|createMany)$/.test(callee) && !/Repository/.test(callee);
          if (isPrisma) {
            const data = arg.properties.find(p => p.name?.getText(sf) === 'data');
            const init = data && ts.isPropertyAssignment(data) ? data.initializer : undefined;
            const records = init && ts.isArrayLiteralExpression(init) ? init.elements : init ? [init] : [];
            for (const r of records) {
              if (ts.isObjectLiteralExpression(r)) recordType(r, acc);
              else acc.nonLiteral = true; // e.g. `{ data }` built and validated at runtime
            }
            if (!init) acc.nonLiteral = true;
          } else {
            recordType(arg, acc);
          }
        } else {
          acc.nonLiteral = true;
        }
        if (!acc.found && acc.literals.length === 0) acc.nonLiteral = true;
        sites.push({
          file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, callee,
          literals: [...new Set(acc.literals)], nonLiteral: acc.nonLiteral, cast: acc.cast,
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return sites;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      out.push(...sourceFiles(p));
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

const ENUM = readEnum('NotificationType');
const SITES = sourceFiles(SRC).flatMap(f => scanSource(relative(SRC, f).replace(/\\/g, '/'), readFileSync(f, 'utf-8')));
const siteIn = (file: string) => SITES.filter(s => s.file === file);
const literalsIn = (file: string) => siteIn(file).flatMap(s => s.literals);

describe('A-15: notification types at every insert site', () => {
  it('reads the enum from prisma/schema.prisma', () => {
    expect(ENUM.size).toBeGreaterThanOrEqual(30);
    for (const v of ['ACCOUNT_LOCKED', 'PM_OVERDUE', 'BLOCK_CHANGE_APPROVED', 'STAGE_APPROVAL_REQUESTED']) expect(ENUM).toContain(v);
  });

  it('control: the scan finds the known insert sites and their literals', () => {
    // both arms of the approve/reject ternary
    expect(literalsIn('modules/block-change-requests/block-change.service.ts')).toEqual(
      expect.arrayContaining(['BLOCK_CHANGE_APPROVED', 'BLOCK_CHANGE_REJECTED', 'BLOCK_CHANGE_REQUESTED']), // + the `...baseMsg` spread
    );
    // a shorthand `type` whose parameter is typed with a union alias
    expect(literalsIn('modules/report-reviews/service.ts')).toEqual(
      expect.arrayContaining(['REPORT_REVIEW_REQUESTED', 'REPORT_REVIEW_APPROVED', 'REPORT_REVIEW_REJECTED']),
    );
    expect(literalsIn('modules/pm-schedules/pm-deviations.ts')).toEqual(expect.arrayContaining(['PM_OVERDUE', 'PM_OVERDUE_COMPLETED']));
    // a direct prisma.notification.create({ data: { type } })
    expect(literalsIn('modules/admin-requests/admin-request.service.ts')).toContain('USER_CREATION_REQUEST_SUBMITTED');
    // the dispatcher's in-app insert and the repository's own insert are found
    expect(siteIn('modules/notification-delivery/notification-dispatcher.ts')).toHaveLength(1);
    expect(siteIn('modules/notifications/notification.repository.ts')).toHaveLength(1);
    expect(SITES.length).toBeGreaterThanOrEqual(30);
  });

  it('every literal notification type inserted anywhere is a NotificationType enum value', () => {
    const offenders = SITES.flatMap(s => s.literals.filter(v => !ENUM.has(v)).map(v => `${s.file}:${s.line} ${v}`));
    expect(offenders).toEqual([]);
  });

  it('no insert site casts its type through `any` / `unknown`', () => {
    const offenders = SITES.filter(s => s.cast).map(s => `${s.file}:${s.line} ${s.callee}`);
    expect(offenders).toEqual([]);
  });

  it('negative control: the checks really fail on a bad literal and on a cast', () => {
    const sites = scanSource('synthetic.ts', `
      type Kind = 'USER_CREATED' | 'NOT_IN_ENUM_EITHER';
      async function f(ok: boolean, kind: Kind) {
        await createNotification({ type: ok ? 'USER_CREATED' : (ok ? 'ACCOUNT_LOCKED' : 'NOT_A_TYPE'), title: 't', message: 'm' });
        await createNotification({ type: kind, title: 't', message: 'm' });
        await tx.notification.create({ data: { type: 'ALSO_BAD' as any, title: 't', message: 'm' } });
        await prisma.notification.createMany({ data: [{ type: 'PM_OVERDUE' }, { type: 'BAD_IN_ARRAY' }] });
      }
    `);
    const bad = sites.flatMap(s => s.literals.filter(v => !ENUM.has(v)));
    expect(bad.sort()).toEqual(['ALSO_BAD', 'BAD_IN_ARRAY', 'NOT_A_TYPE', 'NOT_IN_ENUM_EITHER']);
    expect(sites.filter(s => s.cast).map(s => s.callee)).toEqual(['tx.notification.create']);
  });
});
