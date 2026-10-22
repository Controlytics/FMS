/**
 * dispatchNotification against digilog_test_db (coverage campaign 2026-10-21):
 * rule matching, recipient resolution (ROLE / GROUP / USER), cooldown,
 * conditions, template selection and the three delivery channels.
 *
 * Boundaries mocked: nodemailer (SMTP) and global fetch (Twilio). The rules,
 * users, groups, phone configs, notification rows and notification_logs rows
 * are all real.
 *
 * Shared-DB safety: matched rules use DEVICE_* event types (nothing emits them
 * any more) and are deleted in afterAll; ROLE recipients use throwaway roles
 * holding only this file's users; notification-email / notification-sms are
 * snapshotted and restored, and the SMTP host is TEST-NET-1 (RFC 5737, never
 * routed) so a concurrent process that sends meanwhile reaches no server (not
 * loopback: a loopback SMTP host is refused outright since SEC-08, 2026-10-22).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { dispatchNotification } from '../notification-dispatcher.js';
import { invalidateNotificationConfigCache } from '../config-loader.js';
import {
  uniq, ensureRole, ensureUser, deleteUsersAndRoles, snapshotConfig, restoreConfig, setConfig, waitFor, type ConfigSnapshot,
} from './cov-fixtures.js';

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn(async (m: any) => ({ messageId: `<${m.to}>` }));
  return { sendMail, createTransport: vi.fn(() => ({ sendMail, verify: vi.fn() })) };
});
vi.mock('nodemailer', () => ({ default: { createTransport } }));

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sid: 'SMdisp' }), { status: 201 }));

const TAG = uniq();
const ROLE_D = `CND_A_${TAG}`.slice(0, 20);
const ROLE_D2 = `CND_B_${TAG}`.slice(0, 20);
const ROLE_EMPTY = `CND_E_${TAG}`.slice(0, 20);
const U = {
  a: `covdp_a_${TAG}`, b: `covdp_b_${TAG}`, c: `covdp_c_${TAG}`, off: `covdp_x_${TAG}`,
};
const PW = 'CovDisp@Test2026';
const ids: Record<string, string> = {};
let groupId = '';
const ruleIds: string[] = [];
const tplIds: string[] = [];
let emailSnap: ConfigSnapshot;
let smsSnap: ConfigSnapshot;

async function makeRule(data: Record<string, any>, recipients: Array<Record<string, any>>) {
  const rule = await prisma.notificationRule.create({
    data: {
      name: `cov disp ${uniq()}`, eventType: data.eventTypes?.[0] ?? 'DEVICE_OFFLINE',
      eventTypes: ['DEVICE_OFFLINE'], conditions: {}, inAppEnabled: true, emailEnabled: false, smsEnabled: false,
      cooldownMinutes: 0, isActive: true, createdBy: 'cov-test', ...data,
      recipients: { create: recipients },
    },
  });
  ruleIds.push(rule.id);
  return rule;
}
const inApp = (ruleName: string) => prisma.notification.findMany({ where: { title: ruleName }, orderBy: { forUserId: 'asc' } });
const logsFor = (ruleId: string, channel: 'EMAIL' | 'SMS') =>
  prisma.notificationLog.findMany({ where: { channel, metadata: { path: ['ruleId'], equals: ruleId } }, orderBy: { recipient: 'asc' } });
const waitLogs = (ruleId: string, channel: 'EMAIL' | 'SMS', n: number) =>
  waitFor(async () => {
    const rows = await logsFor(ruleId, channel);
    return rows.length >= n && rows.every(r => r.status !== 'PENDING') ? rows : null;
  });

beforeAll(async () => {
  emailSnap = await snapshotConfig('notification-email');
  smsSnap = await snapshotConfig('notification-sms');
  await setConfig('notification-email', {
    host: '192.0.2.1', port: 1, secure: false, enabled: true, authType: 'basic',
    username: 'cov', password: 'x', fromEmail: 'noreply@cov.test', fromName: 'Cov',
  });
  await setConfig('notification-sms', {
    provider: 'twilio', enabled: true, twilioAccountSid: 'ACd', twilioAuthToken: 't', twilioFromNumber: '+15550000000',
  });
  invalidateNotificationConfigCache();
  vi.stubGlobal('fetch', fetchMock);

  await ensureRole(ROLE_D, ['DASHBOARD_VIEW']);
  await ensureRole(ROLE_D2, ['DASHBOARD_VIEW']);
  await ensureRole(ROLE_EMPTY, ['DASHBOARD_VIEW']);
  ids.a = (await ensureUser({ username: U.a, password: PW, role: ROLE_D, fullName: 'Alice Cov' })).id;
  ids.b = (await ensureUser({ username: U.b, password: PW, role: ROLE_D, email: null, fullName: 'Bob NoMail' })).id;
  ids.c = (await ensureUser({ username: U.c, password: PW, role: ROLE_D2, fullName: 'Carol Group' })).id;
  ids.off = (await ensureUser({ username: U.off, password: PW, role: ROLE_D, status: 'DISABLED' })).id;
  groupId = (await prisma.userGroup.create({ data: { name: `cov disp grp ${TAG}`, createdBy: 'cov-test' } })).id;
  await prisma.userGroupMember.createMany({ data: [{ groupId, userId: ids.c }, { groupId, userId: ids.off }] });
  await setConfig(`user-phone-${ids.a}`, { phone: '+919811111111' });
  await setConfig(`user-phone-${ids.c}`, { phone: '+919822222222' });
}, 60_000);

beforeEach(() => {
  sendMail.mockClear();
  fetchMock.mockClear();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.notificationLog.deleteMany({ where: { OR: ruleIds.map(id => ({ metadata: { path: ['ruleId'], equals: id } })) } });
  await prisma.notification.deleteMany({ where: { forUserId: { in: Object.values(U) } } });
  await prisma.notificationRule.deleteMany({ where: { id: { in: ruleIds } } });
  await prisma.notificationTemplate.deleteMany({ where: { id: { in: tplIds } } });
  await prisma.systemConfig.deleteMany({ where: { configKey: { in: [`user-phone-${ids.a}`, `user-phone-${ids.c}`] } } });
  await prisma.userGroup.deleteMany({ where: { id: groupId } });
  await deleteUsersAndRoles(Object.values(U), [ROLE_D, ROLE_D2, ROLE_EMPTY]);
  await restoreConfig(emailSnap);
  await restoreConfig(smsSnap);
  invalidateNotificationConfigCache();
}, 60_000);

describe('recipients and the three channels', () => {
  it('fans an event out to every ENABLED user reached by role, group or user — once each — on every enabled channel', async () => {
    const rule = await makeRule(
      { eventTypes: ['DEVICE_OFFLINE'], eventType: 'DEVICE_OFFLINE', emailEnabled: true, smsEnabled: true },
      [
        { recipientType: 'ROLE', roleValue: ROLE_D },   // a, b  (off is DISABLED)
        { recipientType: 'GROUP', groupId },             // c     (off is DISABLED)
        { recipientType: 'USER', userId: ids.a },        // a again
      ],
    );
    const ts = '2026-03-04T05:06:07.000Z';
    await dispatchNotification({
      eventType: 'DEVICE_OFFLINE', context: {},
      variables: { deviceName: 'Pump 7', unsPath: 'site/hall/pump7', timestamp: ts },
    });

    // In-app: one per resolved user, addressed by USERNAME
    const notes = await inApp(rule.name);
    expect(notes.map(n => n.forUserId)).toEqual([U.a, U.b, U.c].sort());
    for (const n of notes) {
      expect(n).toMatchObject({ type: 'DEVICE_OFFLINE', message: 'Device Pump 7 went offline' });
      expect(n.metadata).toEqual({ eventType: 'DEVICE_OFFLINE', severity: 'WARNING' });
    }

    // Email: only users with an address (b has none), default per-event template
    const emails = await waitLogs(rule.id, 'EMAIL', 2);
    expect(emails.map(e => e.recipient).sort()).toEqual([`${U.a}@cov.test`, `${U.c}@cov.test`].sort());
    for (const e of emails) {
      expect(e).toMatchObject({ status: 'SENT', triggeredBy: 'notification-rule', subject: '[DigiLog] Device Offline: Pump 7' });
      expect(e.message).toContain('<h2>Device Went Offline</h2>');
      expect(e.message).toContain('site/hall/pump7');
      // the UTC ISO timestamp was re-rendered in the configured format
      expect(e.message).not.toContain(ts);
      expect(e.metadata).toMatchObject({ ruleName: rule.name, eventType: 'DEVICE_OFFLINE', ruleId: rule.id });
    }

    // SMS: only users with a user-phone-<id> config; default SMS template
    const sms = await waitLogs(rule.id, 'SMS', 2);
    expect(sms.map(s => s.recipient).sort()).toEqual(['+919811111111', '+919822222222']);
    const smsBody = sms[0].message;
    expect(smsBody.split('\n')[0]).toBe('DigiLog Device Offline: Pump 7');
    expect(smsBody).toContain('\nDevice: Pump 7\nUNS Path: site/hall/pump7\nTime: ');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // D7 (2026-10-21): every channel used to get HTML-escaped values, so the in-app
  // list and SMS showed `&amp;` / `&quot;` / `&lt;` (the web renders that text
  // as text). Only the e-mail BODY is HTML.
  it('values are plain text in-app, in SMS and in the e-mail subject; escaped only inside the e-mail body', async () => {
    const rule = await makeRule(
      { eventTypes: ['DEVICE_OFFLINE'], eventType: 'DEVICE_OFFLINE', emailEnabled: true, smsEnabled: true, inAppEnabled: true },
      [{ recipientType: 'USER', userId: ids.a }],
    );
    const name = 'Tank "A&B" <north>';
    await dispatchNotification({ eventType: 'DEVICE_OFFLINE', context: {}, variables: { deviceName: name, unsPath: 'x/y' }, forceRuleId: rule.id });

    const [note] = await inApp(rule.name);
    expect(note.message).toBe(`Device ${name} went offline`);

    const [sms] = await waitLogs(rule.id, 'SMS', 1);
    expect(sms.message.split('\n')[0]).toBe(`DigiLog Device Offline: ${name}`);
    expect(sms.message).toContain(`\nDevice: ${name}\n`);

    const [email] = await waitLogs(rule.id, 'EMAIL', 1);
    expect(email.subject).toBe(`[DigiLog] Device Offline: ${name}`);
    expect(email.message).toContain('Tank &quot;A&amp;B&quot; &lt;north&gt;');
    expect(email.message).not.toContain(name);
    const mail = sendMail.mock.calls.find((c: any[]) => c[0].to === `${U.a}@cov.test`)![0];
    expect(mail.subject).toBe(`[DigiLog] Device Offline: ${name}`);
    expect(mail.html).toContain('<title>[DigiLog] Device Offline: Tank &quot;A&amp;B&quot; &lt;north&gt;</title>');
    expect(mail.text).toContain(name);
  });

  it('a rule whose recipients resolve to nobody sends nothing', async () => {
    const rule = await makeRule({ eventTypes: ['DEVICE_INACTIVITY'], eventType: 'DEVICE_INACTIVITY', emailEnabled: true }, [
      { recipientType: 'ROLE', roleValue: ROLE_EMPTY },
    ]);
    await dispatchNotification({ eventType: 'DEVICE_INACTIVITY', context: {}, variables: { deviceName: 'x' }, forceRuleId: rule.id });
    expect(await inApp(rule.name)).toHaveLength(0);
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('rule matching', () => {
  it('an inactive rule is not matched by its event, but a test fire (forceRuleId) reaches it', async () => {
    const rule = await makeRule({ eventTypes: ['DEVICE_ONLINE'], eventType: 'DEVICE_ONLINE', isActive: false }, [
      { recipientType: 'USER', userId: ids.a },
    ]);
    await dispatchNotification({ eventType: 'DEVICE_ONLINE', context: {}, variables: { deviceName: 'Fan' } });
    expect(await inApp(rule.name)).toHaveLength(0);
    await dispatchNotification({ eventType: 'DEVICE_ONLINE', context: {}, variables: { deviceName: 'Fan' }, forceRuleId: rule.id });
    const notes = await inApp(rule.name);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ message: 'Device Fan is back online', metadata: { severity: 'INFO', eventType: 'DEVICE_ONLINE' } });
  });

  it('conditions: an array is any-of, a scalar compares as a string, empty/null conditions are ignored', async () => {
    const rule = await makeRule(
      { eventTypes: ['DEVICE_INACTIVITY'], eventType: 'DEVICE_INACTIVITY', conditions: { site: ['A', 'B'], line: 3, note: '', extra: null } },
      [{ recipientType: 'USER', userId: ids.a }],
    );
    const fire = (context: Record<string, unknown>) =>
      dispatchNotification({ eventType: 'DEVICE_INACTIVITY', context, variables: { deviceName: 'D', inactiveSince: 'noon' } });
    await fire({ site: 'C', line: 3 });   // site not in list
    await fire({ site: 'A', line: 4 });   // line differs
    await fire({ line: 3 });              // site missing
    expect(await inApp(rule.name)).toHaveLength(0);
    await fire({ site: 'B', line: '3' }); // '3' == 3 as strings
    const notes = await inApp(rule.name);
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toBe('Device D has been inactive since noon');
  });

  it('cooldown suppresses a repeat within the window; a test fire ignores it', async () => {
    const rule = await makeRule({ eventTypes: ['DEVICE_INACTIVITY'], eventType: 'DEVICE_INACTIVITY', cooldownMinutes: 5 }, [
      { recipientType: 'USER', userId: ids.b },
    ]);
    const ev = { eventType: 'DEVICE_INACTIVITY', context: {}, variables: { deviceName: 'C1', inactiveSince: 't' } };
    await dispatchNotification({ ...ev, variables: { ...ev.variables } });
    await dispatchNotification({ ...ev, variables: { ...ev.variables } });
    expect(await inApp(rule.name)).toHaveLength(1);
    // after the window it fires again
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5 * 60_000 + 1);
    try {
      await dispatchNotification({ ...ev, variables: { ...ev.variables } });
    } finally {
      spy.mockRestore();
    }
    expect(await inApp(rule.name)).toHaveLength(2);
    await dispatchNotification({ ...ev, variables: { ...ev.variables }, forceRuleId: rule.id });
    expect(await inApp(rule.name)).toHaveLength(3);
  });
});

describe('templates', () => {
  it('uses the rule\'s DB templates for email and SMS, with per-recipient variables', async () => {
    const et = await prisma.notificationTemplate.create({
      data: { name: `cov disp email ${TAG}`, channel: 'EMAIL', subject: 'Hi ${recipientName}: ${eventLabel}', bodyTemplate: '<p>${summary} for ${recipientEmail}</p>', createdBy: 'cov' },
    });
    const st = await prisma.notificationTemplate.create({
      data: { name: `cov disp sms ${TAG}`, channel: 'SMS', bodyTemplate: 'SMS ${deviceName} to ${recipientName}', createdBy: 'cov' },
    });
    tplIds.push(et.id, st.id);
    const rule = await makeRule(
      { eventTypes: ['DEVICE_ONLINE'], eventType: 'DEVICE_ONLINE', emailEnabled: true, smsEnabled: true, inAppEnabled: false, emailTemplateId: et.id, smsTemplateId: st.id },
      [{ recipientType: 'USER', userId: ids.a }],
    );
    await dispatchNotification({ eventType: 'DEVICE_ONLINE', context: {}, variables: { deviceName: 'Chiller' }, forceRuleId: rule.id });
    const [email] = await waitLogs(rule.id, 'EMAIL', 1);
    expect(email.subject).toBe('Hi Alice Cov: Device Online');
    expect(email.message).toBe(`<p>Chiller for ${U.a}@cov.test</p>`);
    const [sms] = await waitLogs(rule.id, 'SMS', 1);
    expect(sms.message).toBe('SMS Chiller to Alice Cov');
    expect(await inApp(rule.name)).toHaveLength(0); // in-app disabled
  });

  it('a DB email template without a subject sends with an empty subject', async () => {
    const et = await prisma.notificationTemplate.create({
      data: { name: `cov disp nosubj ${TAG}`, channel: 'EMAIL', bodyTemplate: 'Body ${deviceName}', createdBy: 'cov' },
    });
    tplIds.push(et.id);
    const rule = await makeRule(
      { eventTypes: ['DEVICE_ONLINE'], eventType: 'DEVICE_ONLINE', emailEnabled: true, inAppEnabled: false, emailTemplateId: et.id },
      [{ recipientType: 'USER', userId: ids.a }],
    );
    await dispatchNotification({ eventType: 'DEVICE_ONLINE', context: {}, variables: { deviceName: 'AHU-9' }, forceRuleId: rule.id });
    const [email] = await waitLogs(rule.id, 'EMAIL', 1);
    expect(email.subject).toBe('');
    expect(email.message).toBe('Body AHU-9');
  });

  it('falls back to the per-event defaults when a configured template id no longer exists', async () => {
    const gone = '00000000-0000-4000-8000-00000000a11a';
    const rule = await makeRule(
      { eventTypes: ['DEVICE_ONLINE'], eventType: 'DEVICE_ONLINE', emailEnabled: true, smsEnabled: true, inAppEnabled: false, emailTemplateId: gone, smsTemplateId: gone },
      [{ recipientType: 'USER', userId: ids.a }],
    );
    await dispatchNotification({ eventType: 'DEVICE_ONLINE', context: {}, variables: { deviceName: 'Boiler', message: 'custom summary' }, forceRuleId: rule.id });
    const [email] = await waitLogs(rule.id, 'EMAIL', 1);
    expect(email.subject).toBe('[DigiLog] Device Online: Boiler');
    expect(email.message).toContain('<h2>Device Back Online</h2>');
    const [sms] = await waitLogs(rule.id, 'SMS', 1);
    // summary prefers variables.message
    expect(sms.message.split('\n')[0]).toBe('DigiLog Device Online: custom summary');
  });

  it('an event type with no built-in wording gets the generic templates; an un-storable in-app type is logged, not thrown', async () => {
    const rule = await makeRule(
      { eventTypes: ['DEVICE_ONLINE'], eventType: 'DEVICE_ONLINE', emailEnabled: true, smsEnabled: true, inAppEnabled: true },
      [{ recipientType: 'USER', userId: ids.a }],
    );
    await expect(dispatchNotification({
      eventType: 'CUSTOM_EVT', context: {}, variables: { timestamp: 'not a date' }, forceRuleId: rule.id,
    })).resolves.toBeUndefined();
    const [email] = await waitLogs(rule.id, 'EMAIL', 1);
    expect(email.subject).toBe('[DigiLog] Alert: CUSTOM_EVT');
    expect(email.message).toContain('<h2>DigiLog Alert</h2>');
    // an unparseable timestamp is left as given
    expect(email.message).toContain('<p>Time: not a date</p>');
    const [sms] = await waitLogs(rule.id, 'SMS', 1);
    expect(sms.message).toBe('DigiLog CUSTOM_EVT: CUSTOM_EVT\nTime: not a date');
    // 'CUSTOM_EVT' is not a NotificationType: the in-app insert is refused before
    // it reaches the database, and logged (A-15; see dispatcher-type-guard.test.ts)
    expect(await inApp(rule.name)).toHaveLength(0);
  });

  it.each([
    ['USER_LOGIN', { username: 'jdoe', fullName: 'J Doe', role: 'QA', ipAddress: '10.0.0.9' }, '[DigiLog] User Login: jdoe', 'User jdoe logged in', 'INFO'],
    ['USER_CREATED', { username: 'nu', createdBy: 'boss', email: 'nu@x' }, '[DigiLog] New User Created: nu', 'New user nu created by boss', 'INFO'],
    ['CHECKLIST_SUBMITTED', { checklistName: 'CL-1', submittedBy: 'op' }, '[DigiLog] Checklist Submitted: CL-1', 'Checklist CL-1 submitted by op', 'INFO'],
    ['CHECKLIST_APPROVED', { checklistName: 'CL-2', approvedBy: 'qa' }, '[DigiLog] Checklist Approved: CL-2', 'Checklist CL-2 approved by qa', 'INFO'],
    ['CHECKLIST_REJECTED', { checklistName: 'CL-3', rejectedBy: 'qa', reason: 'smudged' }, '[DigiLog] Checklist Rejected: CL-3', 'Checklist CL-3 rejected by qa', 'INFO'],
    ['SYSTEM_ERROR', { errorType: 'DB', errorMessage: 'pool exhausted', url: '/x' }, '[DigiLog] System Error: DB', 'System error: pool exhausted', 'WARNING'],
  ])('%s: default subject, in-app wording and severity', async (eventType, variables, subject, inAppMsg, severity) => {
    const rule = await makeRule(
      { eventTypes: ['DEVICE_ONLINE'], eventType: 'DEVICE_ONLINE', emailEnabled: true, inAppEnabled: true },
      [{ recipientType: 'USER', userId: ids.a }],
    );
    await dispatchNotification({ eventType, context: {}, variables: { ...(variables as Record<string, string>) }, forceRuleId: rule.id });
    const [email] = await waitLogs(rule.id, 'EMAIL', 1);
    expect(email.subject).toBe(subject);
    const [note] = await inApp(rule.name);
    expect(note).toMatchObject({ type: eventType, message: inAppMsg, metadata: { severity } });
  });
});
