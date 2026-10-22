/**
 * Help articles — /api/help behaviour coverage (2026-10-21).
 *
 * Real routes on the production error handler. Articles use a category and
 * key prefix this file owns (`cvo-…`), so list filters return exactly what the
 * file created; everything is hard-deleted in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp, internalErrors, authGet, authPost, authPut, authDelete } from '../../../e2e/test-helper.js';
import helpRoutes from '../routes.js';
import { prisma } from '../../../lib/prisma.js';
import { cleanupAll, createRole, createUser, deleteRoles, deleteUsers, login, runSuffix, addReauth, removeReauth } from '../../../e2e/support/owned-fixtures.js';

const S = runSuffix();
const PW = 'CvoHelp@2026!x';
const CAT = `cvo-cat-${S}`;
const ROLE_READ = `cvoHR${S}`;
const ROLE_NONE = `cvoHN${S}`;
const U = { sa: `cvohsa${S}`.toLowerCase(), admin: `cvohad${S}`.toLowerCase(), reader: `cvohrd${S}`.toLowerCase(), none: `cvohnn${S}`.toLowerCase() };
const ids: Record<string, string> = {};
const tok: Record<string, string> = {};
let app: FastifyInstance;
const key = (k: string) => `cvo-${S}-${k}`;

async function auditWithLink(action: string, targetId: string) {
  const row = await prisma.auditTrail.findFirst({ where: { action, targetId }, orderBy: { chainPosition: 'desc' } });
  expect(row, `${action} for ${targetId}`).toBeTruthy();
  const prev = await prisma.auditTrail.findFirst({ where: { chainPosition: { lt: row!.chainPosition! } }, orderBy: { chainPosition: 'desc' } });
  expect(row!.previousChecksum).toBe(prev!.checksum);
  return row!;
}

async function create(k: string, extra: Record<string, unknown> = {}) {
  const res = await authPost(app, '/api/help', tok.sa, { key: key(k), title: `T ${k}`, content: `Body of ${k}`, category: CAT, ...extra }, PW);
  expect(res.statusCode).toBe(201);
  return res.json();
}

beforeAll(async () => {
  await createRole(ROLE_READ, ['CONFIG_READ']);
  await createRole(ROLE_NONE, []);
  ids.sa = await createUser(U.sa, 'SUPER_ADMIN', PW);
  ids.admin = await createUser(U.admin, 'ADMIN', PW);
  ids.reader = await createUser(U.reader, ROLE_READ, PW);
  ids.none = await createUser(U.none, ROLE_NONE, PW);
  app = await buildApp([{ plugin: helpRoutes, prefix: '/api/help' }]);
  for (const k of Object.keys(U) as Array<keyof typeof U>) tok[k] = await login(app, U[k], PW);
}, 60_000);

afterAll(async () => {
  const mine = await prisma.helpArticle.findMany({ where: { key: { startsWith: `cvo-${S}-` } }, select: { id: true } });
  await cleanupAll([
    ['help versions', () => prisma.helpArticleVersion.deleteMany({ where: { helpArticleId: { in: mine.map((m) => m.id) } } })],
    ['help articles', () => prisma.helpArticle.deleteMany({ where: { id: { in: mine.map((m) => m.id) } } })],
    ['users', () => deleteUsers(Object.values(ids))],
    ['roles', () => deleteRoles([ROLE_READ, ROLE_NONE])],
    ['app', () => app?.close()],
  ]);
}, 60_000);

beforeEach(() => { internalErrors.length = 0; });

describe('create', () => {
  it('creates the article + its version-1 snapshot and audits it', async () => {
    const a = await create('intro');
    expect(a).toMatchObject({ key: key('intro'), title: 'T intro', category: CAT, sortOrder: 0, currentVersion: 1, isActive: true });
    const versions = await prisma.helpArticleVersion.findMany({ where: { helpArticleId: a.id } });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, content: 'Body of intro', changedBy: U.sa, changeNotes: 'Initial version' });
    const row = await auditWithLink('HELP_ARTICLE_CREATED', a.id);
    expect(row.userId).toBe(U.sa);
    expect(row.afterValue).toEqual({ key: key('intro'), title: 'T intro', category: CAT });
  });

  it('honours an explicit sortOrder', async () => {
    const a = await create('sorted', { sortOrder: 7 });
    expect(a.sortOrder).toBe(7);
  });

  it('refuses a duplicate key with 409 and writes no second row', async () => {
    await create('dup');
    const res = await authPost(app, '/api/help', tok.sa, { key: key('dup'), title: 'x', content: 'y', category: CAT }, PW);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe(`Help article with key "${key('dup')}" already exists`);
    expect(await prisma.helpArticle.count({ where: { key: key('dup') } })).toBe(1);
  });

  it('is SUPER_ADMIN-only (ADMIN gets 403) and validates the body', async () => {
    const denied = await authPost(app, '/api/help', tok.admin, { key: key('nope'), title: 'x', content: 'y', category: CAT }, PW);
    expect(denied.statusCode).toBe(403);
    expect(await prisma.helpArticle.count({ where: { key: key('nope') } })).toBe(0);
    const bad = await authPost(app, '/api/help', tok.sa, { key: key('bad'), title: 'x' }, PW);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('VALIDATION_ERROR');
    expect(internalErrors).toEqual([]);
  });
});

describe('read', () => {
  beforeAll(async () => {
    await create('alpha', { title: 'Cleaning pipeline basics', content: 'How WASH_IN works', sortOrder: 2 });
    await create('beta', { title: 'RFID', content: 'Scanning tags', sortOrder: 1 });
  }, 60_000);

  it('lists by category in sortOrder, with summary fields only', async () => {
    const res = await authGet(app, `/api/help?category=${CAT}`, tok.reader);
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list.every((a: any) => a.category === CAT)).toBe(true);
    const orders = list.map((a: any) => a.sortOrder);
    expect(orders).toEqual([...orders].sort((x: number, y: number) => x - y));
    expect(list[0]).not.toHaveProperty('content');
    expect(list.map((a: any) => a.key)).toEqual(expect.arrayContaining([key('alpha'), key('beta')]));
  });

  it('search matches title or content, case-insensitively', async () => {
    const byContent = (await authGet(app, `/api/help?category=${CAT}&search=wash_in`, tok.reader)).json();
    expect(byContent.map((a: any) => a.key)).toEqual([key('alpha')]);
    const byTitle = (await authGet(app, `/api/help?category=${CAT}&search=rfid`, tok.reader)).json();
    expect(byTitle.map((a: any) => a.key)).toEqual([key('beta')]);
  });

  it('an unfiltered list includes this file\'s articles', async () => {
    const res = await authGet(app, '/api/help', tok.sa);
    expect(res.json().map((a: any) => a.key)).toEqual(expect.arrayContaining([key('alpha'), key('beta')]));
  });

  it('GET /:key returns the full article; an unknown key is 404', async () => {
    const res = await authGet(app, `/api/help/${key('alpha')}`, tok.reader);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ key: key('alpha'), content: 'How WASH_IN works', currentVersion: 1 });
    const missing = await authGet(app, `/api/help/${key('never')}`, tok.reader);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'Help article not found' });
  });

  it('reading needs CONFIG_READ', async () => {
    expect((await authGet(app, '/api/help', tok.none)).statusCode).toBe(403);
    expect((await authGet(app, `/api/help/${key('alpha')}`, tok.none)).statusCode).toBe(403);
  });
});

describe('update / versions / delete', () => {
  it('PUT applies every field, snapshots a new version and audits before/after', async () => {
    const a = await create('upd');
    const res = await authPut(app, `/api/help/${a.id}`, tok.sa, {
      title: 'T upd v2', content: 'Body v2', category: CAT, sortOrder: 4, isActive: true, changeNotes: 'rewrote it',
    }, PW);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: 'T upd v2', content: 'Body v2', sortOrder: 4, currentVersion: 2 });
    const v2 = await prisma.helpArticleVersion.findFirst({ where: { helpArticleId: a.id, version: 2 } });
    expect(v2).toMatchObject({ content: 'Body v2', changeNotes: 'rewrote it', changedBy: U.sa });
    const row = await auditWithLink('HELP_ARTICLE_UPDATED', a.id);
    expect(row.beforeValue).toEqual({ title: 'T upd', category: CAT });
    expect(row.afterValue).toEqual({ title: 'T upd v2', category: CAT, version: 2 });
  });

  it('PUT without content snapshots the existing content and leaves untouched fields alone', async () => {
    const a = await create('partial', { sortOrder: 3 });
    const res = await authPut(app, `/api/help/${a.id}`, tok.sa, { title: 'renamed' }, PW);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: 'renamed', content: 'Body of partial', sortOrder: 3, currentVersion: 2 });
    const v2 = await prisma.helpArticleVersion.findFirst({ where: { helpArticleId: a.id, version: 2 } });
    expect(v2).toMatchObject({ content: 'Body of partial', changeNotes: null });
  });

  it('PUT on an unknown id is 404 and writes no version', async () => {
    const id = randomUUID();
    const res = await authPut(app, `/api/help/${id}`, tok.sa, { title: 'x' }, PW);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Help article not found' });
    expect(await prisma.helpArticleVersion.count({ where: { helpArticleId: id } })).toBe(0);
  });

  it('GET /:id/versions lists newest first for SUPER_ADMIN and ADMIN, not for others', async () => {
    const a = await create('hist');
    await authPut(app, `/api/help/${a.id}`, tok.sa, { content: 'second' }, PW);
    await authPut(app, `/api/help/${a.id}`, tok.sa, { content: 'third' }, PW);
    for (const t of [tok.sa, tok.admin]) {
      const res = await authGet(app, `/api/help/${a.id}/versions`, t);
      expect(res.statusCode).toBe(200);
      expect(res.json().map((v: any) => [v.version, v.content])).toEqual([[3, 'third'], [2, 'second'], [1, 'Body of hist']]);
    }
    expect((await authGet(app, `/api/help/${a.id}/versions`, tok.reader)).statusCode).toBe(403);
  });

  it('DELETE soft-deletes, audits, and the key stops resolving', async () => {
    const a = await create('gone');
    const res = await authDelete(app, `/api/help/${a.id}`, tok.sa, PW);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: true });
    expect((await prisma.helpArticle.findUnique({ where: { id: a.id } }))!.isActive).toBe(false);
    const row = await auditWithLink('HELP_ARTICLE_DELETED', a.id);
    expect(row.beforeValue).toEqual({ key: key('gone'), title: 'T gone' });
    expect((await authGet(app, `/api/help/${key('gone')}`, tok.sa)).statusCode).toBe(404);
    const listed = (await authGet(app, `/api/help?category=${CAT}`, tok.sa)).json().map((x: any) => x.key);
    expect(listed).not.toContain(key('gone'));
  });

  it('DELETE on an unknown id is 404; non-SUPER_ADMIN is 403', async () => {
    const res = await authDelete(app, `/api/help/${randomUUID()}`, tok.sa, PW);
    expect(res.statusCode).toBe(404);
    const a = await create('keep');
    expect((await authDelete(app, `/api/help/${a.id}`, tok.admin, PW)).statusCode).toBe(403);
    expect((await prisma.helpArticle.findUnique({ where: { id: a.id } }))!.isActive).toBe(true);
  });
});

describe('e-signature', () => {
  it('when the policy requires it, create / update / delete refuse a SUPER_ADMIN without the password and write nothing', async () => {
    const a = await create('signed');
    // Window kept to this one test; only pairs this file added are removed.
    const grants = await addReauth([['CREATE_HELP_ARTICLE', 'SUPER_ADMIN'], ['UPDATE_HELP_ARTICLE', 'SUPER_ADMIN'], ['DELETE_HELP_ARTICLE', 'SUPER_ADMIN']]);
    try {
      const c = await authPost(app, '/api/help', tok.sa, { key: key('unsigned'), title: 'x', content: 'y', category: CAT });
      const u = await authPut(app, `/api/help/${a.id}`, tok.sa, { title: 'unsigned edit' });
      const d = await authDelete(app, `/api/help/${a.id}`, tok.sa);
      expect([c.statusCode, u.statusCode, d.statusCode]).toEqual([401, 401, 401]);
      expect([c.json().action, u.json().action, d.json().action]).toEqual(['CREATE_HELP_ARTICLE', 'UPDATE_HELP_ARTICLE', 'DELETE_HELP_ARTICLE']);
    } finally {
      await removeReauth(grants);
    }
    expect(await prisma.helpArticle.count({ where: { key: key('unsigned') } })).toBe(0);
    expect(await prisma.helpArticle.findUnique({ where: { id: a.id } })).toMatchObject({ title: 'T signed', isActive: true, currentVersion: 1 });
  });
});
