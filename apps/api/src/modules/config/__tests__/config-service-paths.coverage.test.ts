/**
 * Coverage of configService paths reached through the action-reauth,
 * audit-templates and user-id routes (2026-10-21): policy validation
 * refusals, the per-role re-auth reads, and the next-User-ID computation.
 *
 * `action-reauth` is NEVER saved with a different value here: the refusal tests
 * write nothing, and the per-role reads use addReauth/removeReauth merges on
 * this file's own role. `user-id` is NEVER written either (2026-10-22): the
 * next-ID tests hand getNextUserId its settings through the repository's one
 * config read (see withUserIdConfig), because a real save changes `length`, which
 * the User ID validator applies to every user created concurrently.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { userIdConfigSchema } from '@digilog/shared';
import { buildApp, authGet, authPost, authPut, internalErrors } from '../../../e2e/test-helper.js';
import { prisma } from '../../../lib/prisma.js';
import {
  cleanupAll, runSuffix, createRole, createUser, login, deleteUsers, deleteRoles,
  addReauth, removeReauth, type ReauthGrant,
} from '../../../e2e/support/owned-fixtures.js';
import { stored, snapshotRows, restoreRows } from './support/config-rows.js';
import { configRepository } from '../config.repository.js';

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

/**
 * Run `fn` with getNextUserId seeing `patch` merged over the stored user-id
 * settings (as a save would merge them), WITHOUT writing the shared row: only
 * the repository's read of the `user-id` key is answered; every other key and
 * the user-table queries stay real.
 */
async function withUserIdConfig(patch: Record<string, unknown>, fn: () => Promise<void>) {
  const current = ((await stored('user-id')) as Record<string, unknown> | null) ?? {};
  const real = configRepository.getSystemConfig.bind(configRepository);
  const spy = vi.spyOn(configRepository, 'getSystemConfig').mockImplementation(async (key: string) => {
    if (key !== 'user-id') return real(key);
    const row = await real(key);
    return { ...(row ?? { configKey: 'user-id', configType: 'user', requiresReauth: true }), configValue: { ...current, ...patch } } as any;
  });
  try { await fn(); } finally { spy.mockRestore(); }
}

/** Every shared config row this file writes; put back exactly (value + metadata) in afterAll. */
const TOUCHED_KEYS: string[] = [];
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

  // Without a prefix a generated id is all digits, exactly `length` long. Only
  // usernames of that shape count; any other username ending in digits
  // (`${PREFIX}n2000000000`, `admin2`, a timestamped tool user) used to set the
  // next number and produce an id longer than the configured length.
  it('next: without a prefix the highest all-digit id of the configured length is used', async () => {
    userIds.push(await createUser(`${PREFIX}n2000000000`, RO_ROLE, PW));
    const width = 9;
    const mine = `99${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    userIds.push(await createUser(mine, RO_ROLE, PW));
    await withUserIdConfig({ autoGenerate: true, prefix: '', prefixSeparator: '', startNumber: 1, length: width }, async () => {
      const res = await authGet(app, '/api/config/user-id/next', admToken);
      expect(res.statusCode).toBe(200);
      const rows = await prisma.$queryRawUnsafe<{ m: string | null }[]>(
        `SELECT MAX(username) AS m FROM users WHERE username ~ '^[0-9]{${width}}$'`);
      const expected = String(BigInt(rows[0].m!) + 1n).padStart(width, '0');
      expect(res.json()).toEqual({ autoGenerate: true, nextId: expected });
      expect(res.json().nextId).toHaveLength(width);
    });
  });

  // The separator only exists after a prefix. With no prefix, the default '-'
  // separator used to be subtracted from the width, generating an id one digit
  // short that the User ID validator then refused ("must be exactly N").
  it('next: without a prefix the default separator does not shorten the id', async () => {
    await withUserIdConfig({ autoGenerate: true, prefix: '', prefixSeparator: '-', startNumber: 1, length: 9 }, async () => {
      const res = await authGet(app, '/api/config/user-id/next', admToken);
      expect(res.statusCode).toBe(200);
      expect(res.json().nextId).toMatch(/^[0-9]{9}$/);
    });
  });

  // D-CFG-3: a trailing digit run longer than an INTEGER (11 digits) or a BIGINT
  // (20 digits) overflowed the MAX() cast and answered 400 DATA_CONSTRAINT to
  // every caller. Such usernames are not generated ids and are ignored.
  it('next: usernames with an 11- or 20-digit tail neither break the scan nor set the next number', async () => {
    userIds.push(await createUser(`${PREFIX}99999999999`, RO_ROLE, PW));
    userIds.push(await createUser(`${PREFIX}12345678901234567890`, RO_ROLE, PW));
    userIds.push(await createUser('12345678901234567890', RO_ROLE, PW));
    await withUserIdConfig({ autoGenerate: true, prefix: PREFIX, prefixSeparator: '', startNumber: 1, length: 6 }, async () => {
      const res = await authGet(app, '/api/config/user-id/next', admToken);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ autoGenerate: true, nextId: `${PREFIX}042` });
    });
    await withUserIdConfig({ autoGenerate: true, prefix: '', prefixSeparator: '', startNumber: 1, length: 20 }, async () => {
      const res = await authGet(app, '/api/config/user-id/next', admToken);
      expect(res.statusCode).toBe(200);
      // The 20-digit all-digit username IS the shape of a 20-long generated id.
      expect(res.json().nextId).toBe('12345678901234567891');
    });
    expect(internalErrors).toEqual([]);
  });
});
