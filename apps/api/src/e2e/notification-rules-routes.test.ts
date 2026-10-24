/**
 * /api/notification-rules — route → Prisma → digilog_test_db (coverage campaign
 * 2026-10-21). The module had no test at all.
 *
 * Isolation on the shared test DB:
 *   - own SUPER_ADMIN + two throwaway roles/users, deleted in afterAll;
 *   - every rule created here is INACTIVE (the toggle test's rule is active
 *     for a moment, with no recipients), so another agent's logins/user-creates
 *     can never reach anyone through one; rules are deleted in afterAll. They
 *     used DEVICE_* types for this until 2026-10-24, when the API began refusing
 *     the six types nothing sends (EVENT_TYPE_NOT_SENT);
 *   - recipients are only this file's users / a throwaway role / own group;
 *   - action-reauth gets MANAGE_NOTIFICATION_RULES for the throwaway role only.
 *
 * The test-fire endpoint dispatches for real; nodemailer is the only mock (the
 * SMTP boundary), and every rule here has email disabled anyway.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import notificationRulesRoutes from '../modules/notification-rules/routes.js';
import { prisma } from '../lib/prisma.js';
import {
  uniq, ensureRole, ensureUser, deleteUsersAndRoles, login, addReauthRole, removeReauthRole,
} from '../modules/notification-delivery/__tests__/cov-fixtures.js';

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn(async () => ({ messageId: 'never' })), verify: vi.fn() })) },
}));

// The real dispatcher, with a switch to make ONE call throw (a database outage
// mid-dispatch). Spying on a Prisma model delegate instead is unsafe: delegates
// are proxies, so the spy neither passes through nor restores.
const dispatchFault = vi.hoisted(() => ({ next: null as Error | null }));
vi.mock('../modules/notification-delivery/notification-dispatcher.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modules/notification-delivery/notification-dispatcher.js')>();
  return {
    ...actual,
    dispatchNotification: async (event: Parameters<typeof actual.dispatchNotification>[0]) => {
      const fault = dispatchFault.next;
      if (fault) { dispatchFault.next = null; throw fault; }
      return actual.dispatchNotification(event);
    },
  };
});

const TAG = uniq();
const SA = `covnr_sa_${TAG}`.slice(0, 40);
const CFG = `covnr_cfg_${TAG}`.slice(0, 40);
const RO = `covnr_ro_${TAG}`.slice(0, 40);
const PW = 'CovRules@Test2026';
const ROLE_CFG = `CNR_C_${TAG}`.slice(0, 20);
const ROLE_RO = `CNR_R_${TAG}`.slice(0, 20);
const ROLE_RCPT = `CNR_X_${TAG}`.slice(0, 20); // recipient role; only its users match
const RCPT1 = `covnr_r1_${TAG}`.slice(0, 40);
const RCPT2 = `covnr_r2_${TAG}`.slice(0, 40);
const RCPT_OFF = `covnr_rx_${TAG}`.slice(0, 40);
const GROUP_NAME = `covnr_group_${TAG}`;

let app: FastifyInstance;
let saToken = '';
let cfgToken = '';
let roToken = '';
let groupId = '';
const ids: Record<string, string> = {};
const createdRuleIds: string[] = [];

const H = (token: string, pw?: string) => ({
  authorization: `Bearer ${token}`,
  ...(pw ? { 'x-reauth-password': pw } : {}),
});

async function createRule(payload: Record<string, unknown>, token = saToken) {
  const res = await app.inject({ method: 'POST', url: '/api/notification-rules', headers: H(token, PW), payload });
  if (res.statusCode === 200) createdRuleIds.push(res.json().id);
  return res;
}

const latestAudit = (action: string, targetId: string) =>
  prisma.auditTrail.findFirst({ where: { action, targetId }, orderBy: { chainPosition: 'desc' } });

beforeAll(async () => {
  app = await buildApp([{ plugin: notificationRulesRoutes, prefix: '/api/notification-rules' }]);
  await ensureRole(ROLE_CFG, ['CONFIG_READ', 'CONFIG_UPDATE']);
  await ensureRole(ROLE_RO, ['CONFIG_READ']);
  await ensureRole(ROLE_RCPT, ['DASHBOARD_VIEW']);
  await ensureUser({ username: SA, password: PW, role: 'SUPER_ADMIN' });
  await ensureUser({ username: CFG, password: PW, role: ROLE_CFG });
  await ensureUser({ username: RO, password: PW, role: ROLE_RO });
  ids.r1 = (await ensureUser({ username: RCPT1, password: PW, role: ROLE_RCPT, fullName: 'Recipient One' })).id;
  ids.r2 = (await ensureUser({ username: RCPT2, password: PW, role: ROLE_RCPT, fullName: 'Recipient Two' })).id;
  ids.off = (await ensureUser({ username: RCPT_OFF, password: PW, role: ROLE_RCPT, status: 'DISABLED' })).id;
  groupId = (await prisma.userGroup.create({ data: { name: GROUP_NAME, createdBy: 'cov-test' } })).id;
  await prisma.userGroupMember.create({ data: { groupId, userId: ids.r2 } });
  saToken = await login(app, SA, PW);
  cfgToken = await login(app, CFG, PW);
  roToken = await login(app, RO, PW);
  await addReauthRole(['MANAGE_NOTIFICATION_RULES'], ROLE_CFG);
}, 60_000);

afterAll(async () => {
  await removeReauthRole(['MANAGE_NOTIFICATION_RULES'], ROLE_CFG);
  if (createdRuleIds.length) await prisma.notificationRule.deleteMany({ where: { id: { in: createdRuleIds } } });
  await prisma.notification.deleteMany({ where: { forUserId: { in: [RCPT1, RCPT2, RCPT_OFF] } } });
  await prisma.userGroup.deleteMany({ where: { id: groupId } });
  await deleteUsersAndRoles([SA, CFG, RO, RCPT1, RCPT2, RCPT_OFF], [ROLE_CFG, ROLE_RO, ROLE_RCPT]);
  await app?.close();
}, 60_000);

describe('GET /api/notification-rules/event-types', () => {
  it('lists only the event types the application sends, with label, module and the variables a template may use (2026-10-24)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notification-rules/event-types', headers: H(roToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ value: string; label: string; module: string; variables: string[] }>;
    // DEVICE_* (data-ingestion, removed 2026-06) and CHECKLIST_* are never dispatched.
    expect(body.map(e => e.value).sort()).toEqual(['SYSTEM_ERROR', 'USER_CREATED', 'USER_LOCKED', 'USER_LOGIN']);
    const locked = body.find(e => e.value === 'USER_LOCKED')!;
    expect(locked).toMatchObject({ label: 'User Locked', module: 'users' });
    expect(locked.variables).toContain('reason');
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notification-rules/event-types' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/notification-rules', () => {
  it('creates a rule with ROLE/GROUP/USER recipients, normalises eventType and audits the create', async () => {
    const res = await createRule({
      name: `cov rule create ${TAG}`,
      description: 'created by coverage test',
      eventTypes: ['USER_CREATED', 'SYSTEM_ERROR'],
      conditions: { site: 'A' },
      emailEnabled: false, smsEnabled: false, inAppEnabled: true,
      cooldownMinutes: 3, isActive: false,
      recipients: [
        // Only the field matching recipientType survives; the others are nulled.
        { recipientType: 'ROLE', roleValue: ROLE_RCPT, groupId, userId: ids.r1 },
        { recipientType: 'GROUP', groupId, roleValue: 'SHOULD_DROP' },
        { recipientType: 'USER', userId: ids.r1, groupId },
      ],
    });
    expect(res.statusCode).toBe(200);
    const rule = res.json();
    expect(rule.eventType).toBe('USER_CREATED'); // first of eventTypes
    expect(rule.eventTypes).toEqual(['USER_CREATED', 'SYSTEM_ERROR']);
    expect(rule.createdBy).toBe(SA);
    expect(rule.isActive).toBe(false);
    expect(rule.cooldownMinutes).toBe(3);

    const recips = await prisma.notificationRuleRecipient.findMany({ where: { ruleId: rule.id } });
    const byType = Object.fromEntries(recips.map(r => [r.recipientType, r]));
    expect(byType.ROLE).toMatchObject({ roleValue: ROLE_RCPT, groupId: null, userId: null });
    expect(byType.GROUP).toMatchObject({ roleValue: null, groupId, userId: null });
    expect(byType.USER).toMatchObject({ roleValue: null, groupId: null, userId: ids.r1 });

    const audit = await latestAudit('NOTIFICATION_RULE_CREATED', rule.id);
    expect(audit).toBeTruthy();
    expect(audit!.userId).toBe(SA);
    expect(audit!.afterValue).toMatchObject({ name: `cov rule create ${TAG}`, eventType: 'USER_CREATED' });
  });

  // D6 (2026-10-21): the create allow-list omitted `priority`, so a rule created
  // with a priority from the UI was stored at 0 (PUT kept it).
  it('stores the priority given on create', async () => {
    const res = await createRule({ name: `cov rule priority ${TAG}`, eventTypes: ['SYSTEM_ERROR'], isActive: false, priority: 5 });
    expect(res.statusCode).toBe(200);
    expect(res.json().priority).toBe(5);
    expect((await prisma.notificationRule.findUnique({ where: { id: res.json().id } }))!.priority).toBe(5);
  });

  it('defaults conditions to {} and ignores client-set id/createdAt (whitelist)', async () => {
    const forgedId = '00000000-0000-4000-8000-00000000c0de';
    const res = await createRule({
      name: `cov rule whitelist ${TAG}`, eventTypes: ['USER_LOCKED'], isActive: false,
      id: forgedId, createdAt: '2001-01-01T00:00:00.000Z', createdBy: 'forged',
    });
    expect(res.statusCode).toBe(200);
    const rule = res.json();
    expect(rule.id).not.toBe(forgedId);
    expect(rule.conditions).toEqual({});
    expect(rule.createdBy).toBe(SA);
    expect(new Date(rule.createdAt).getUTCFullYear()).toBeGreaterThan(2001);
    expect(rule.recipients).toEqual([]);
  });

  it.each([
    ['missing eventTypes', { name: 'x' }],
    ['empty eventTypes', { name: 'x', eventTypes: [] }],
    ['empty name', { name: '', eventTypes: ['SYSTEM_ERROR'] }],
    ['name over 200 chars', { name: 'n'.repeat(201), eventTypes: ['SYSTEM_ERROR'] }],
    ['unknown recipientType', { name: 'x', eventTypes: ['SYSTEM_ERROR'], recipients: [{ recipientType: 'TEAM' }] }],
    ['negative cooldown', { name: 'x', eventTypes: ['SYSTEM_ERROR'], cooldownMinutes: -1 }],
  ])('rejects %s with 400', async (_label, payload) => {
    const before = await prisma.notificationRule.count();
    const res = await app.inject({ method: 'POST', url: '/api/notification-rules', headers: H(saToken, PW), payload });
    expect(res.statusCode).toBe(400);
    expect(await prisma.notificationRule.count()).toBe(before);
  });

  it('rejects an event type that is not a NotificationEventType with a 400, not a 500', async () => {
    const res = await createRule({ name: `cov bad type ${TAG}`, eventTypes: ['NOT_AN_EVENT'], isActive: false });
    expect(res.statusCode).toBe(400);
  });

  it.each([
    ['a device type', ['DEVICE_ONLINE'], '"Device Online" is never sent by this application'],
    ['a checklist type next to a sent one', ['USER_LOGIN', 'CHECKLIST_SUBMITTED'], '"Checklist Submitted" is never sent by this application'],
  ])('refuses %s (EVENT_TYPE_NOT_SENT) before the password is asked, and stores nothing (2026-10-24)', async (_l, eventTypes, msg) => {
    const before = await prisma.notificationRule.count();
    const reauthRowsBefore = await prisma.auditTrail.count({ where: { userId: CFG, action: { in: ['REAUTH_SUCCESS', 'REAUTH_FAILED'] } } });
    // cfgToken's role is under MANAGE_NOTIFICATION_RULES re-auth: no password is sent, yet the answer is 400, not 401
    const res = await app.inject({ method: 'POST', url: '/api/notification-rules', headers: H(cfgToken), payload: { name: `cov unsent ${TAG}`, eventTypes, isActive: false } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('EVENT_TYPE_NOT_SENT');
    expect(res.json().message).toContain(msg);
    expect(res.json().message).toContain('Choose from: User Login, User Created, User Locked, System Error.');
    expect(await prisma.notificationRule.count()).toBe(before);
    expect(await prisma.auditTrail.count({ where: { userId: CFG, action: { in: ['REAUTH_SUCCESS', 'REAUTH_FAILED'] } } })).toBe(reauthRowsBefore);
  });

  it('403s a role holding only CONFIG_READ', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/notification-rules', headers: H(roToken, PW),
      payload: { name: 'ro', eventTypes: ['SYSTEM_ERROR'] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
  });

  it('enforces MANAGE_NOTIFICATION_RULES re-auth for a role it is configured for', async () => {
    const payload = { name: `cov reauth ${TAG}`, eventTypes: ['SYSTEM_ERROR'], isActive: false };
    const none = await app.inject({ method: 'POST', url: '/api/notification-rules', headers: H(cfgToken), payload });
    expect(none.statusCode).toBe(401);
    expect(none.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'MANAGE_NOTIFICATION_RULES' });

    const wrong = await app.inject({ method: 'POST', url: '/api/notification-rules', headers: H(cfgToken, 'Wrong@Pass1'), payload });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toBe('REAUTH_FAILED');
    const failedRow = await prisma.auditTrail.findFirst({ where: { action: 'REAUTH_FAILED', userId: CFG }, orderBy: { chainPosition: 'desc' } });
    expect((failedRow!.afterValue as any).reauthAction).toBe('MANAGE_NOTIFICATION_RULES');

    const ok = await createRule(payload, cfgToken);
    expect(ok.statusCode).toBe(200);
    expect(await prisma.notificationRule.count({ where: { name: payload.name } })).toBe(1);
    // reset the failed-attempt streak the wrong password added
    await prisma.user.update({ where: { username: CFG }, data: { failedLoginAttempts: 0 } });
  });
});

describe('GET /api/notification-rules (list) and /:id', () => {
  let ruleId = '';
  let legacyId = '';
  const ghostUser = '00000000-0000-4000-8000-0000000000aa';

  beforeAll(async () => {
    const res = await createRule({
      name: `cov rule list ${TAG}`, eventTypes: ['SYSTEM_ERROR'], isActive: false, priority: 7,
      recipients: [
        { recipientType: 'ROLE', roleValue: ROLE_RCPT },
        { recipientType: 'GROUP', groupId },
        { recipientType: 'USER', userId: ids.r1 },
        { recipientType: 'USER', userId: ghostUser }, // no FK on user_id: a deleted user's id
      ],
    });
    ruleId = res.json().id;
    // A pre-multi-event row: eventTypes empty, only the legacy scalar column.
    const legacy = await prisma.notificationRule.create({
      data: { name: `cov legacy ${TAG}`, eventType: 'DEVICE_INACTIVITY', eventTypes: [], isActive: false, createdBy: 'cov-test' },
    });
    legacyId = legacy.id;
    createdRuleIds.push(legacyId);
  });

  it('enriches recipients with a display name per type and exposes eventTypesMeta', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notification-rules', headers: H(roToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(body.data.length);
    const rule = body.data.find((r: any) => r.id === ruleId);
    expect(rule.eventTypesMeta).toEqual([expect.objectContaining({ value: 'SYSTEM_ERROR', label: 'System Error' })]);
    expect(rule.eventTypeMeta).toMatchObject({ label: 'System Error', module: 'system' });
    const names = Object.fromEntries(rule.recipients.map((r: any) => [`${r.recipientType}:${r.userId ?? r.groupId ?? r.roleValue}`, r.displayName]));
    expect(names[`ROLE:${ROLE_RCPT}`]).toBe(ROLE_RCPT);
    expect(names[`GROUP:${groupId}`]).toBe(GROUP_NAME);
    expect(names[`USER:${ids.r1}`]).toBe('Recipient One');
    expect(names[`USER:${ghostUser}`]).toBe(ghostUser); // falls back to the raw id
  });

  it('presents a legacy single-eventType rule as a one-element eventTypes list', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notification-rules', headers: H(roToken) });
    const legacy = res.json().data.find((r: any) => r.id === legacyId);
    expect(legacy.eventTypes).toEqual(['DEVICE_INACTIVITY']);
    expect(legacy.eventTypesMeta[0].value).toBe('DEVICE_INACTIVITY');
    // a stored type that is no longer sent still shows its label
    expect(legacy.eventTypesMeta[0].label).toBe('Device Inactivity');
  });

  it('GET /:id returns the rule with recipients', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/notification-rules/${ruleId}`, headers: H(roToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().recipients).toHaveLength(4);
  });

  it('GET /:id answers 404 for an unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notification-rules/00000000-0000-4000-8000-000000000404', headers: H(roToken) });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
  });

  it('GET /:id answers 400, not 500, for an id that is not a uuid', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notification-rules/not-a-uuid', headers: H(roToken) });
    expect(res.statusCode).toBe(400);
  });

  it('list and detail are refused without CONFIG_READ', async () => {
    const noRole = `CNR_N_${TAG}`.slice(0, 20);
    const noUser = `covnr_no_${TAG}`.slice(0, 40);
    await ensureRole(noRole, ['DASHBOARD_VIEW']);
    await ensureUser({ username: noUser, password: PW, role: noRole });
    try {
      const t = await login(app, noUser, PW);
      expect((await app.inject({ method: 'GET', url: '/api/notification-rules', headers: H(t) })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: `/api/notification-rules/${ruleId}`, headers: H(t) })).statusCode).toBe(403);
    } finally {
      await deleteUsersAndRoles([noUser], [noRole]);
    }
  });
});

describe('PUT /api/notification-rules/:id', () => {
  let ruleId = '';
  let tplEmail = '';

  beforeAll(async () => {
    const res = await createRule({
      name: `cov rule put ${TAG}`, eventTypes: ['SYSTEM_ERROR'], isActive: false,
      description: 'before', recipients: [{ recipientType: 'USER', userId: ids.r1 }],
    });
    ruleId = res.json().id;
    tplEmail = (await prisma.notificationTemplate.create({
      data: { name: `cov tpl put ${TAG}`, channel: 'EMAIL', subject: 's', bodyTemplate: 'b', createdBy: 'cov-test' },
    })).id;
  });

  afterAll(async () => {
    await prisma.notificationTemplate.deleteMany({ where: { id: tplEmail } });
  });

  it('updates fields, replaces recipients, strips computed fields and audits before/after', async () => {
    const res = await app.inject({
      method: 'PUT', url: `/api/notification-rules/${ruleId}`, headers: H(saToken, PW),
      payload: {
        // what the UI echoes back from the list endpoint
        id: ruleId, eventTypeMeta: { x: 1 }, eventTypesMeta: [], createdAt: '2001-01-01T00:00:00Z', updatedAt: 'x', createdBy: 'forged',
        name: `cov rule put renamed ${TAG}`,
        eventTypes: ['USER_LOCKED', 'USER_CREATED'],
        priority: 9,
        emailTemplateId: tplEmail,
        recipients: [{ recipientType: 'ROLE', roleValue: ROLE_RCPT }, { recipientType: 'GROUP', groupId }],
      },
    });
    expect(res.statusCode).toBe(200);
    const rule = res.json();
    expect(rule.name).toBe(`cov rule put renamed ${TAG}`);
    expect(rule.eventType).toBe('USER_LOCKED');
    expect(rule.priority).toBe(9);
    expect(rule.emailTemplateId).toBe(tplEmail);
    expect(rule.createdBy).toBe(SA); // provenance not client-settable
    expect(rule.recipients.map((r: any) => r.recipientType).sort()).toEqual(['GROUP', 'ROLE']);

    const audit = await latestAudit('NOTIFICATION_RULE_UPDATED', ruleId);
    expect((audit!.beforeValue as any).name).toBe(`cov rule put ${TAG}`);
    expect((audit!.beforeValue as any).recipients).toHaveLength(1);
    expect((audit!.afterValue as any).name).toBe(`cov rule put renamed ${TAG}`);
  });

  it('a single eventType is widened to eventTypes; empty template ids and description become null', async () => {
    const res = await app.inject({
      method: 'PUT', url: `/api/notification-rules/${ruleId}`, headers: H(saToken, PW),
      payload: { eventType: 'USER_CREATED', emailTemplateId: '', smsTemplateId: '', description: '' },
    });
    expect(res.statusCode).toBe(200);
    const rule = res.json();
    expect(rule.eventTypes).toEqual(['USER_CREATED']);
    expect(rule.emailTemplateId).toBeNull();
    expect(rule.smsTemplateId).toBeNull();
    expect(rule.description).toBeNull();
    // recipients omitted → left untouched
    expect(rule.recipients).toHaveLength(2);
  });

  it('an explicit empty recipients list removes every recipient', async () => {
    const res = await app.inject({
      method: 'PUT', url: `/api/notification-rules/${ruleId}`, headers: H(saToken, PW), payload: { recipients: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().recipients).toEqual([]);
    expect(await prisma.notificationRuleRecipient.count({ where: { ruleId } })).toBe(0);
  });

  it('answers 404 for an unknown id and writes no audit row', async () => {
    const missing = '00000000-0000-4000-8000-0000000004f4';
    const res = await app.inject({
      method: 'PUT', url: `/api/notification-rules/${missing}`, headers: H(saToken, PW), payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(404);
    expect(await latestAudit('NOTIFICATION_RULE_UPDATED', missing)).toBeNull();
  });

  it('an edit naming an unsent type is refused (EVENT_TYPE_NOT_SENT); one that leaves the types out keeps them (2026-10-24)', async () => {
    const bad = await app.inject({
      method: 'PUT', url: `/api/notification-rules/${ruleId}`, headers: H(saToken, PW), payload: { eventTypes: ['DEVICE_OFFLINE'] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('EVENT_TYPE_NOT_SENT');
    expect((await prisma.notificationRule.findUnique({ where: { id: ruleId } }))!.eventTypes).not.toContain('DEVICE_OFFLINE');
    const legacy = await prisma.notificationRule.create({
      data: { name: `cov legacy put ${TAG}`, eventType: 'DEVICE_ONLINE', eventTypes: ['DEVICE_ONLINE'], isActive: false, createdBy: 'cov-test' },
    });
    createdRuleIds.push(legacy.id);
    const rename = await app.inject({
      method: 'PUT', url: `/api/notification-rules/${legacy.id}`, headers: H(saToken, PW), payload: { name: `cov legacy put renamed ${TAG}` },
    });
    expect(rename.statusCode).toBe(200);
    expect(rename.json().eventTypes).toEqual(['DEVICE_ONLINE']);
  });

  it('rejects a schema violation with 400', async () => {
    const res = await app.inject({
      method: 'PUT', url: `/api/notification-rules/${ruleId}`, headers: H(saToken, PW), payload: { eventTypes: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires re-auth for the configured role and 403s a read-only role', async () => {
    const r1 = await app.inject({ method: 'PUT', url: `/api/notification-rules/${ruleId}`, headers: H(cfgToken), payload: { name: 'nope' } });
    expect(r1.statusCode).toBe(401);
    expect(r1.json().error).toBe('REAUTH_REQUIRED');
    const r2 = await app.inject({ method: 'PUT', url: `/api/notification-rules/${ruleId}`, headers: H(roToken, PW), payload: { name: 'nope' } });
    expect(r2.statusCode).toBe(403);
    expect((await prisma.notificationRule.findUnique({ where: { id: ruleId } }))!.name).not.toBe('nope');
  });
});

describe('PUT /api/notification-rules/:id/toggle', () => {
  it('flips isActive atomically and audits each flip with a signature meaning', async () => {
    const rule = (await createRule({ name: `cov toggle ${TAG}`, eventTypes: ['SYSTEM_ERROR'], isActive: false })).json();
    const on = await app.inject({ method: 'PUT', url: `/api/notification-rules/${rule.id}/toggle`, headers: H(saToken, PW), payload: {} });
    expect(on.statusCode).toBe(200);
    expect(on.json().isActive).toBe(true);
    const a1 = await latestAudit('NOTIFICATION_RULE_UPDATED', rule.id);
    expect(a1!.beforeValue).toMatchObject({ isActive: false });
    expect(a1!.afterValue).toMatchObject({ isActive: true });
    expect(a1!.signatureMeaning).toBe(`Notification rule "cov toggle ${TAG}" enabled`);

    const off = await app.inject({ method: 'PUT', url: `/api/notification-rules/${rule.id}/toggle`, headers: H(saToken, PW), payload: {} });
    expect(off.json().isActive).toBe(false);
    expect((await latestAudit('NOTIFICATION_RULE_UPDATED', rule.id))!.signatureMeaning).toMatch(/disabled$/);
  });

  it('answers 404 for an unknown id', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/notification-rules/00000000-0000-4000-8000-00000000f00d/toggle', headers: H(saToken, PW), payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires re-auth for the configured role', async () => {
    const rule = (await createRule({ name: `cov toggle reauth ${TAG}`, eventTypes: ['SYSTEM_ERROR'], isActive: false })).json();
    const res = await app.inject({ method: 'PUT', url: `/api/notification-rules/${rule.id}/toggle`, headers: H(cfgToken), payload: {} });
    expect(res.statusCode).toBe(401);
    expect((await prisma.notificationRule.findUnique({ where: { id: rule.id } }))!.isActive).toBe(false);
  });
});

describe('DELETE /api/notification-rules/:id', () => {
  it('deletes the rule, cascades its recipients and audits the prior name/eventType', async () => {
    const rule = (await createRule({
      name: `cov delete ${TAG}`, eventTypes: ['USER_CREATED'], isActive: false,
      recipients: [{ recipientType: 'USER', userId: ids.r1 }],
    })).json();
    const res = await app.inject({ method: 'DELETE', url: `/api/notification-rules/${rule.id}`, headers: H(saToken, PW) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(await prisma.notificationRule.findUnique({ where: { id: rule.id } })).toBeNull();
    expect(await prisma.notificationRuleRecipient.count({ where: { ruleId: rule.id } })).toBe(0);
    const audit = await latestAudit('NOTIFICATION_RULE_DELETED', rule.id);
    expect(audit!.beforeValue).toEqual({ name: `cov delete ${TAG}`, eventType: 'USER_CREATED' });
  });

  it('answers 404 for an unknown id', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/notification-rules/00000000-0000-4000-8000-00000000dead', headers: H(saToken, PW) });
    expect(res.statusCode).toBe(404);
  });

  it('requires re-auth for the configured role', async () => {
    const rule = (await createRule({ name: `cov delete reauth ${TAG}`, eventTypes: ['USER_CREATED'], isActive: false })).json();
    const res = await app.inject({ method: 'DELETE', url: `/api/notification-rules/${rule.id}`, headers: H(cfgToken) });
    expect(res.statusCode).toBe(401);
    expect(await prisma.notificationRule.findUnique({ where: { id: rule.id } })).not.toBeNull();
  });
});

describe('POST /api/notification-rules/:id/test', () => {
  it('test-fires an INACTIVE rule: in-app notifications reach every enabled recipient once, by username', async () => {
    const rule = (await createRule({
      name: `cov testfire ${TAG}`, eventTypes: ['USER_LOCKED'], isActive: false,
      inAppEnabled: true, emailEnabled: false, smsEnabled: false,
      // cooldown and conditions are bypassed by a test fire
      cooldownMinutes: 60, conditions: { neverMatches: 'x' },
      recipients: [
        { recipientType: 'ROLE', roleValue: ROLE_RCPT },   // r1, r2 (rx is DISABLED)
        { recipientType: 'GROUP', groupId },                 // r2 again
        { recipientType: 'USER', userId: ids.r1 },           // r1 again
      ],
    })).json();

    const res = await app.inject({ method: 'POST', url: `/api/notification-rules/${rule.id}/test`, headers: H(saToken), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, message: `Test notification dispatched for rule "cov testfire ${TAG}"` });

    const notes = await prisma.notification.findMany({ where: { title: `cov testfire ${TAG}` } });
    expect(notes.map(n => n.forUserId).sort()).toEqual([RCPT1, RCPT2].sort());
    for (const n of notes) {
      expect(n.type).toBe('USER_LOCKED');
      // test variables are "[Test <name>]" placeholders
      expect(n.message).toBe('User [Test username] account locked: [Test reason]');
      expect(n.metadata).toEqual({ eventType: 'USER_LOCKED', severity: 'WARNING' });
    }
  });

  it('a dispatch failure (database outage mid-dispatch) is reported in the body, not thrown as a 500', async () => {
    const rule = (await createRule({ name: `cov testfire fail ${TAG}`, eventTypes: ['SYSTEM_ERROR'], isActive: false })).json();
    dispatchFault.next = new Error('Invalid `prisma.notificationRule.findMany()` invocation in C:/app/src/x.ts:87 connection terminated');
    const res = await app.inject({ method: 'POST', url: `/api/notification-rules/${rule.id}/test`, headers: H(saToken), payload: {} });
    expect(res.statusCode).toBe(200);
    // CLAUDE.md strict audit: an internal (Prisma) message never reaches the client.
    expect(res.json()).toEqual({ success: false, error: 'The test dispatch failed because of an internal error. The details are in the server log.' });
  });

  it('answers 404 for an unknown rule', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/notification-rules/00000000-0000-4000-8000-00000000beef/test', headers: H(saToken), payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('403s a read-only role', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/notification-rules/${createdRuleIds[0]}/test`, headers: H(roToken), payload: {} });
    expect(res.statusCode).toBe(403);
  });
});
