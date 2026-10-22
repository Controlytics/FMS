/**
 * Coverage of configService paths reached through the action-reauth,
 * audit-templates and user-id routes (2026-10-21): policy validation
 * refusals, the per-role re-auth reads, and the next-User-ID computation.
 *
 * `action-reauth` is NEVER saved with a different value here: the refusal tests
 * write nothing, and the per-role reads use addReauth/removeReauth merges on
 * this file's own role. `user-id` IS changed (autoGenerate / prefix /
 * startNumber only — none of which the User ID validator reads for the stored
 * LETTERS_NUMBERS format) and restored in a finally per test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { userIdConfigSchema } from '@digilog/shared';
import { buildApp, authGet, authPost, authPut, internalErrors } from '../../../e2e/test-helper.js';
import { prisma } from '../../../lib/prisma.js';
import {
  cleanupAll, runSuffix, createRole, createUser, login, deleteUsers, deleteRoles,
  addReauth, removeReauth, type ReauthGrant,
} from '../../../e2e/support/owned-fixtures.js';
import { stored, restoreKey, snapshotRows, restoreRows } from './support/config-rows.js';

const SFX = runSuffix();
const PW = 'CvcSvc@2026';
const SA_USER = `cvcssa${SFX}`.toLowerCase();
const ADM_USER = `cvcsadm${SFX}`.toLowerCase();
const RO_USER = `cvcsro${SFX}`.toLowerCase();
const ADM_ROLE = `CVC_SADM_${SFX}`;
const RO_ROLE = `CVC_SRO_${SFX}`;
// Upper-case prefix + digits: only this file's users can match `CVQ%` (LIKE is case-sensitive).
const PREFIX = 'CVQ';

let app: FastifyInstance;
let saToken = '';
let admToken = '';
let roToken = '';
const userIds: string[] = [];
let reauthAdded: ReauthGrant = [];

/** Save user-id settings through the API (merged over the stored value), run `fn`, restore. */
async function withUserIdConfig(patch: Record<string, unknown>, fn: () => Promise<void>) {
  const snapshot = await stored('user-id');
  try {
    const res = await authPut(app, '/api/config/user-id', saToken, patch, PW);
    expect(res.statusCode).toBe(200);
    await fn();
  } finally {
    await restoreKey('user-id', snapshot);
  }
}

/** Every shared config row this file writes; put back exactly (value + metadata) in afterAll. */
const TOUCHED_KEYS = ['user-id'];
let originalRows: Awaited<ReturnType<typeof snapshotRows>> = new Map();

beforeAll(async () => {
  originalRows = await snapshotRows(TOUCHED_KEYS);
  await createRole(ADM_ROLE, ['CONFIG_READ', 'CONFIG_UPDATE', 'ROLE_MANAGE', 'USER_CREATE']);
  await createRole(RO_ROLE, []);
  userIds.push(await createUser(SA_USER, 'SUPER_ADMIN', PW));
  userIds.push(await createUser(ADM_USER, ADM_ROLE, PW));
  userIds.push(await createUser(RO_USER, RO_ROLE, PW));
  app = await buildApp();
  saToken = await login(app, SA_USER, PW);
  admToken = await login(app, ADM_USER, PW);
  roToken = await login(app, RO_USER, PW);
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['config row metadata', () => restoreRows(originalRows)],
    ['re-auth grants', () => removeReauth(reauthAdded)],
    ['app', async () => app?.close()],
    ['users', async () => {
      const extra = await prisma.user.findMany({ where: { createdBy: 'coverage-test', username: { startsWith: PREFIX } }, select: { id: true } });
      await deleteUsers([...userIds, ...extra.map((u) => u.id)]);
    }],
    ['roles', () => deleteRoles([ADM_ROLE, RO_ROLE])],
  ]);
}, 60_000);

beforeEach(() => { internalErrors.length = 0; });

describe('PUT /api/config/action-reauth refusals (nothing written)', () => {
  it('needs ROLE_MANAGE', async () => {
    const res = await authPut(app, '/api/config/action-reauth', roToken, {}, PW);
    expect(res.statusCode).toBe(403);
  });

  it('refuses a policy whose roles are not a list (schema VALIDATION_ERROR)', async () => {
    const before = await stored('action-reauth');
    const res = await authPut(app, '/api/config/action-reauth', saToken, { DELETE_USER: 'ADMIN' }, PW);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'VALIDATION_ERROR', message: 'VALIDATION_ERROR' });
    expect(res.json().details.fieldErrors).toHaveProperty('DELETE_USER');
    expect(await stored('action-reauth')).toEqual(before);
    expect(internalErrors).toEqual([]);
  });

  it('refuses unknown actions and unknown roles, naming each', async () => {
    const before = await stored('action-reauth');
    const badAction = `NOT_AN_ACTION_${SFX}`;
    const badRole = `NO_SUCH_ROLE_${SFX}`;
    const res = await authPut(app, '/api/config/action-reauth', saToken,
      { [badAction]: ['ADMIN'], DELETE_USER: [badRole, ADM_ROLE] }, PW);
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.message).toBe(`The re-authentication policy names unknown action(s): ${badAction}; unknown role(s): ${badRole}.`);
    expect(body.details).toEqual({ unknownActions: [badAction], unknownRoles: [badRole] });
    expect(await stored('action-reauth')).toEqual(before);
  });

  it('refuses an unknown action on its own, with only the action clause in the message', async () => {
    const badAction = `NOT_AN_ACTION_${SFX}`;
    const res = await authPut(app, '/api/config/action-reauth', saToken, { [badAction]: [ADM_ROLE] }, PW);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe(`The re-authentication policy names unknown action(s): ${badAction}.`);
    expect(res.json().details).toEqual({ unknownActions: [badAction], unknownRoles: [] });
  });

  it('refuses an unknown role on its own, with only the role clause in the message', async () => {
    const badRole = `NO_SUCH_ROLE_${SFX}`;
    const res = await authPut(app, '/api/config/action-reauth', saToken, { DELETE_USER: [badRole] }, PW);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe(`The re-authentication policy names unknown role(s): ${badRole}.`);
    expect(res.json().details).toEqual({ unknownActions: [], unknownRoles: [badRole] });
  });
});

describe('per-role re-auth reads', () => {
  const ACTION = 'UPDATE_CONFIG_PAGE';

  it('check / my-actions report nothing for a role the policy does not name', async () => {
    const check = await authGet(app, `/api/config/action-reauth/check?action=${ACTION}`, roToken);
    expect(check.statusCode).toBe(200);
    expect(check.json()).toEqual({ action: ACTION, required: false });
    const mine = await authGet(app, '/api/config/action-reauth/my-actions', roToken);
    expect(mine.json()).toEqual({ actions: [] });
  });

  it('check needs the action query parameter', async () => {
    const res = await authGet(app, '/api/config/action-reauth/check', roToken);
    expect(res.statusCode).toBe(400);
    expect(internalErrors).toEqual([]);
  });

  it('once the policy names the role, check says required and my-actions lists it', async () => {
    reauthAdded = await addReauth([[ACTION, RO_ROLE], ['DELETE_USER', RO_ROLE]]);
    try {
      expect((await authGet(app, `/api/config/action-reauth/check?action=${ACTION}`, roToken)).json())
        .toEqual({ action: ACTION, required: true });
      const mine = (await authGet(app, '/api/config/action-reauth/my-actions', roToken)).json();
      expect(new Set(mine.actions)).toEqual(new Set([ACTION, 'DELETE_USER']));
      // Another role is unaffected.
      expect((await authGet(app, `/api/config/action-reauth/check?action=${ACTION}`, admToken)).json().required).toBe(false);
    } finally {
      await removeReauth(reauthAdded);
      reauthAdded = [];
    }
  });
});

describe('PUT /api/config/audit-templates validation', () => {
  it('refuses a non-string template after the signature, and stores nothing', async () => {
    const before = await stored('audit-templates');
    const res = await authPut(app, '/api/config/audit-templates', saToken, { USER_CREATED: 42 }, PW);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    expect(await stored('audit-templates')).toEqual(before);
    expect(internalErrors).toEqual([]);
  });
});

describe('User ID routes', () => {
  it('both need USER_CREATE', async () => {
    expect((await authGet(app, '/api/config/user-id/next', roToken)).statusCode).toBe(403);
    expect((await authPost(app, '/api/config/user-id/validate', roToken, { userId: 'ABC123' })).statusCode).toBe(403);
  });

  it('validate: an empty id is 400 with a stable body', async () => {
    const res = await authPost(app, '/api/config/user-id/validate', admToken, { userId: '' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ valid: false, error: 'User ID is required' });
  });

  it('validate: a too-short id is invalid with the length rule; a conforming id is valid', async () => {
    const cfg = userIdConfigSchema.parse((await stored('user-id')) ?? {});
    const short = await authPost(app, '/api/config/user-id/validate', admToken, { userId: 'A1' });
    expect(short.statusCode).toBe(200);
    expect(short.json().valid).toBe(false);
    expect(short.json().errors).toContain(`User ID must be exactly ${cfg.length} characters`);
    if (cfg.format === 'LETTERS_NUMBERS' && cfg.letterCase === 'UPPERCASE') {
      const okId = 'AB' + '1'.repeat(cfg.length - 2);
      const ok = await authPost(app, '/api/config/user-id/validate', admToken, { userId: okId });
      expect(ok.json()).toEqual({ valid: true });
    }
  });

  it('next: with auto-generation off there is no next id', async () => {
    await withUserIdConfig({ autoGenerate: false }, async () => {
      const res = await authGet(app, '/api/config/user-id/next', admToken);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ autoGenerate: false, nextId: null });
    });
  });

  it('next: with a prefix, the next number follows the highest existing id under that prefix, zero-padded', async () => {
    userIds.push(await createUser(`${PREFIX}041`, RO_ROLE, PW));
    await withUserIdConfig({ autoGenerate: true, prefix: PREFIX, prefixSeparator: '', startNumber: 1, length: 6 }, async () => {
      const res = await authGet(app, '/api/config/user-id/next', admToken);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ autoGenerate: true, nextId: `${PREFIX}042` });
    });
  });

  it('next: a start number above every existing id wins', async () => {
    await withUserIdConfig({ autoGenerate: true, prefix: PREFIX, prefixSeparator: '-', startNumber: 500, length: 8 }, async () => {
      const res = await authGet(app, '/api/config/user-id/next', admToken);
      expect(res.json()).toEqual({ autoGenerate: true, nextId: `${PREFIX}-0500` });
    });
  });

  it('next: without a prefix the highest trailing number across all users is used', async () => {
    // 2_000_000_000 still fits in a Postgres INTEGER and exceeds any realistic id.
    userIds.push(await createUser(`${PREFIX}n2000000000`, RO_ROLE, PW));
    await withUserIdConfig({ autoGenerate: true, prefix: '', prefixSeparator: '', startNumber: 1, length: 6 }, async () => {
      const res = await authGet(app, '/api/config/user-id/next', admToken);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ autoGenerate: true, nextId: '2000000001' });
    });
  });
});
