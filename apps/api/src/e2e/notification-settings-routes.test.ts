/**
 * /api/notification-settings — route → Prisma → digilog_test_db (coverage
 * campaign 2026-10-21). Complements notification-config-audit-masking.test.ts
 * (which pins the audit allow-lists) with the read masking, merge/rehydrate
 * rules, OAuth2 authorization-code flow, test sends, delivery logs and the
 * template CRUD.
 *
 * Boundaries mocked: nodemailer (SMTP), global fetch + node:dns/promises (the
 * OAuth2 token endpoints, reached through the REAL hardenedFetch).
 *
 * Shared-DB safety: own SUPER_ADMIN + throwaway roles/users; notification-email
 * and notification-sms are snapshotted and restored; action-reauth gets keys for
 * the throwaway role only; log rows and templates carry a unique marker and are
 * deleted. Tests whose send fails run with setTimeout faked, so the 5 s retry
 * they schedule is dropped instead of firing later in the shared fork.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { invalidateNotificationConfigCache } from '../modules/notification-delivery/config-loader.js';
import {
  uniq, ensureRole, ensureUser, deleteUsersAndRoles, login, addReauthRole, removeReauthRole,
  snapshotConfig, restoreConfig, setConfig, type ConfigSnapshot,
} from '../modules/notification-delivery/__tests__/cov-fixtures.js';

const { sendMail, verify, createTransport, lookup } = vi.hoisted(() => {
  const sendMail = vi.fn(async (m: any) => ({ messageId: `<${m.to}>` }));
  const verify = vi.fn(async () => true);
  return { sendMail, verify, createTransport: vi.fn(() => ({ sendMail, verify })), lookup: vi.fn() };
});
vi.mock('nodemailer', () => ({ default: { createTransport } }));
vi.mock('node:dns/promises', () => ({ lookup, default: { lookup } }));

const MASK = '••••••••';
const TAG = uniq();
const PW = 'CovNotifSet@2026';
const SA = `covns_sa_${TAG}`;
const CFG = `covns_cfg_${TAG}`;
const RO = `covns_ro_${TAG}`;
const NONE = `covns_no_${TAG}`;
const ROLE_CFG = `CNS_C_${TAG}`.slice(0, 20);
const ROLE_RO = `CNS_R_${TAG}`.slice(0, 20);
const ROLE_NONE = `CNS_N_${TAG}`.slice(0, 20);
const REAUTH_ACTIONS = ['UPDATE_EMAIL_CONFIG', 'UPDATE_SMS_CONFIG', 'DELETE_NOTIFICATION_LOG'];
const fetchMock = vi.fn();

let app: FastifyInstance;
let sa = '';
let cfg = '';
let ro = '';
let none = '';
let emailSnap: ConfigSnapshot;
let smsSnap: ConfigSnapshot;
const tplIds: string[] = [];

const H = (token: string, pw?: string) => ({ authorization: `Bearer ${token}`, ...(pw ? { 'x-reauth-password': pw } : {}) });
const get = (url: string, token = sa) => app.inject({ method: 'GET', url, headers: H(token) });
const storedEmail = async () => (await prisma.systemConfig.findUnique({ where: { configKey: 'notification-email' } }))?.configValue as Record<string, any>;
const storedSms = async () => (await prisma.systemConfig.findUnique({ where: { configKey: 'notification-sms' } }))?.configValue as Record<string, any>;
const latestAudit = (action: string, targetId: string) =>
  prisma.auditTrail.findFirst({ where: { action, targetId }, orderBy: { chainPosition: 'desc' } });

const EMAIL_BASE = {
  // TEST-NET-1 (RFC 5737, never routed): a concurrent real send reaches no server.
  // Not loopback: a loopback SMTP host is refused outright since SEC-08 (2026-10-22).
  host: '192.0.2.1', port: 1, secure: false, enabled: true, authType: 'basic',
  username: 'cov@cov.test', fromEmail: 'noreply@cov.test', fromName: 'Cov',
};

beforeAll(async () => {
  emailSnap = await snapshotConfig('notification-email');
  smsSnap = await snapshotConfig('notification-sms');
  app = await buildApp();
  await ensureRole(ROLE_CFG, ['CONFIG_READ', 'CONFIG_UPDATE']);
  await ensureRole(ROLE_RO, ['CONFIG_READ']);
  await ensureRole(ROLE_NONE, ['DASHBOARD_VIEW']);
  await ensureUser({ username: SA, password: PW, role: 'SUPER_ADMIN' });
  await ensureUser({ username: CFG, password: PW, role: ROLE_CFG });
  await ensureUser({ username: RO, password: PW, role: ROLE_RO });
  await ensureUser({ username: NONE, password: PW, role: ROLE_NONE });
  sa = await login(app, SA, PW);
  cfg = await login(app, CFG, PW);
  ro = await login(app, RO, PW);
  none = await login(app, NONE, PW);
  await addReauthRole(REAUTH_ACTIONS, ROLE_CFG);
  vi.stubGlobal('fetch', fetchMock);
  lookup.mockImplementation(async (host: string) => {
    const t: Record<string, string> = { 'login.microsoftonline.com': '20.190.160.20', 'oauth2.googleapis.com': '142.250.183.10' };
    // An IP literal resolves to itself, as the real resolver does (the SMTP host
    // is resolved and checked through lib/ssrf.ts since SEC-08, 2026-10-22).
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return [{ address: host, family: 4 }];
    if (!t[host]) throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    return [{ address: t[host], family: 4 }];
  });
}, 60_000);

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  fetchMock.mockReset();
  sendMail.mockClear();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await removeReauthRole(REAUTH_ACTIONS, ROLE_CFG);
  await restoreConfig(emailSnap);
  await restoreConfig(smsSnap);
  invalidateNotificationConfigCache();
  await prisma.notificationLog.deleteMany({ where: { recipient: { contains: TAG } } });
  await prisma.notificationTemplate.deleteMany({ where: { id: { in: tplIds } } });
  await deleteUsersAndRoles([SA, CFG, RO, NONE], [ROLE_CFG, ROLE_RO, ROLE_NONE]);
  await app?.close();
}, 60_000);

describe('email configuration', () => {
  it('GET masks secrets and never returns OAuth2 tokens or the pending CSRF state', async () => {
    await setConfig('notification-email', {
      ...EMAIL_BASE, password: 'p', clientSecret: 'cs', refreshToken: 'rt',
      accessToken: 'at', tokenExpiresAt: 123, oauth2PendingState: 'st', oauth2PendingStateAt: 1,
    });
    const res = await get('/api/notification-settings/email', ro);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ host: '192.0.2.1', password: MASK, clientSecret: MASK, refreshToken: MASK });
    for (const k of ['accessToken', 'tokenExpiresAt', 'oauth2PendingState', 'oauth2PendingStateAt']) expect(body).not.toHaveProperty(k);
  });

  it('GET answers {} when nothing is configured, and is refused without CONFIG_READ', async () => {
    await prisma.systemConfig.deleteMany({ where: { configKey: 'notification-email' } });
    expect((await get('/api/notification-settings/email', ro)).json()).toEqual({});
    expect((await get('/api/notification-settings/email', none)).statusCode).toBe(403);
  });

  it('PUT creates the row when absent (no beforeValue in the audit row)', async () => {
    await prisma.systemConfig.deleteMany({ where: { configKey: 'notification-email' } });
    const res = await app.inject({
      method: 'PUT', url: '/api/notification-settings/email', headers: H(sa, PW),
      payload: { ...EMAIL_BASE, password: 'first-pw' },
    });
    expect(res.statusCode).toBe(200);
    expect(await storedEmail()).toMatchObject({ host: '192.0.2.1', password: 'first-pw' });
    const audit = await latestAudit('UPDATE_EMAIL_CONFIG', 'notification-email');
    expect(audit!.userId).toBe(SA);
    expect(audit!.beforeValue).toBeNull();
    expect((audit!.afterValue as any).password).toBe('[redacted]');
  });

  it('PUT merges over the stored value (P5-05): an absent field is kept', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/notification-settings/email', headers: H(sa, PW), payload: { fromName: 'Renamed' },
    });
    expect(res.statusCode).toBe(200);
    expect(await storedEmail()).toMatchObject({ host: '192.0.2.1', password: 'first-pw', fromName: 'Renamed' });
    const audit = await latestAudit('UPDATE_EMAIL_CONFIG', 'notification-email');
    expect((audit!.beforeValue as any).fromName).toBe('Cov');
  });

  it('PUT echoing the mask keeps the stored secrets and the OAuth2 tokens the page never sends', async () => {
    await setConfig('notification-email', {
      ...EMAIL_BASE, password: 'real-pw', clientSecret: 'real-cs', refreshToken: 'real-rt',
      accessToken: 'real-at', tokenExpiresAt: 999, oauth2Configured: true,
    });
    const res = await app.inject({
      method: 'PUT', url: '/api/notification-settings/email', headers: H(sa, PW),
      payload: { ...EMAIL_BASE, password: MASK, clientSecret: MASK, refreshToken: MASK, host: '127.0.0.9' },
    });
    expect(res.statusCode).toBe(200);
    expect(await storedEmail()).toMatchObject({
      host: '127.0.0.9', password: 'real-pw', clientSecret: 'real-cs', refreshToken: 'real-rt',
      accessToken: 'real-at', tokenExpiresAt: 999, oauth2Configured: true,
    });
  });

  it('PUT validates the body', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/notification-settings/email', headers: H(sa, PW), payload: { port: 'not-a-port' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT: 403 without CONFIG_UPDATE; re-auth enforced for the configured role', async () => {
    const r403 = await app.inject({ method: 'PUT', url: '/api/notification-settings/email', headers: H(ro, PW), payload: { fromName: 'x' } });
    expect(r403.statusCode).toBe(403);
    const r401 = await app.inject({ method: 'PUT', url: '/api/notification-settings/email', headers: H(cfg), payload: { fromName: 'x' } });
    expect(r401.statusCode).toBe(401);
    expect(r401.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'UPDATE_EMAIL_CONFIG' });
    expect((await storedEmail()).fromName).not.toBe('x');

    const ok = await app.inject({ method: 'PUT', url: '/api/notification-settings/email', headers: H(cfg, PW), payload: { fromName: 'Signed' } });
    expect(ok.statusCode).toBe(200);
    // the signed change points at its REAUTH_SUCCESS row (2026-09-25)
    const row = await latestAudit('UPDATE_EMAIL_CONFIG', 'notification-email');
    expect(row!.userId).toBe(CFG);
    const sig = await prisma.auditTrail.findUnique({ where: { id: row!.signatureAuditId! } });
    expect(sig).toMatchObject({ action: 'REAUTH_SUCCESS', userId: CFG });
    expect((sig!.afterValue as any).reauthAction).toBe('UPDATE_EMAIL_CONFIG');
  });

  it('POST /email/test without a recipient verifies the SMTP connection', async () => {
    await setConfig('notification-email', EMAIL_BASE);
    invalidateNotificationConfigCache();
    const res = await app.inject({ method: 'POST', url: '/api/notification-settings/email/test', headers: H(sa), payload: {} });
    expect(res.json()).toEqual({ success: true, message: 'SMTP connection verified successfully' });
    expect(verify).toHaveBeenCalled();
  });

  it('POST /email/test with a recipient sends a logged test email', async () => {
    const to = `cov-ns-test-${TAG}@cov.test`;
    const res = await app.inject({ method: 'POST', url: '/api/notification-settings/email/test', headers: H(sa), payload: { recipient: to } });
    expect(res.json()).toEqual({ success: true, message: `Test email sent to ${to}` });
    const row = await prisma.notificationLog.findFirst({ where: { recipient: to } });
    expect(row).toMatchObject({ status: 'SENT', subject: 'DigiLog Test Notification', triggeredBy: 'manual' });
  });

  it('POST /email/test reports why it failed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await setConfig('notification-email', { ...EMAIL_BASE, enabled: false });
    invalidateNotificationConfigCache();
    const noRcpt = await app.inject({ method: 'POST', url: '/api/notification-settings/email/test', headers: H(sa), payload: {} });
    expect(noRcpt.json()).toEqual({ success: false, error: 'Email notifications are not enabled' });
    const to = `cov-ns-off-${TAG}@cov.test`;
    const withRcpt = await app.inject({ method: 'POST', url: '/api/notification-settings/email/test', headers: H(sa), payload: { recipient: to } });
    expect(withRcpt.json()).toEqual({ success: false, error: 'Email notifications are not enabled' });
    expect((await prisma.notificationLog.findFirst({ where: { recipient: to } }))!.status).toBe('RETRYING');
  });
});

describe('OAuth2 authorization-code flow', () => {
  it('redirect-uri honours the forwarded host/proto and defaults to http', async () => {
    const fwd = await app.inject({
      method: 'GET', url: '/api/notification-settings/email/oauth2/redirect-uri',
      headers: { ...H(ro), 'x-forwarded-host': 'fms.cov.test', 'x-forwarded-proto': 'https' },
    });
    expect(fwd.json()).toEqual({ redirectUri: 'https://fms.cov.test/api/notification-settings/email/oauth2/code' });
    const plain = await get('/api/notification-settings/email/oauth2/redirect-uri', ro);
    expect(plain.json().redirectUri).toMatch(/^http:\/\/[^/]+\/api\/notification-settings\/email\/oauth2\/code$/);
  });

  it('authorize returns no URL until a client id is configured', async () => {
    await setConfig('notification-email', { ...EMAIL_BASE, authType: 'oauth2' });
    const res = await get('/api/notification-settings/email/oauth2/authorize', cfg);
    expect(res.json()).toEqual({ authUrl: '' });
    expect((await storedEmail()).oauth2PendingState).toBeUndefined();
  });

  it('authorize (Microsoft) mints and stores a one-time state and builds the consent URL', async () => {
    await setConfig('notification-email', { ...EMAIL_BASE, authType: 'oauth2', oauth2Provider: 'microsoft', clientId: 'ms-cid', providerTenantId: 'tid-9' });
    const res = await app.inject({
      method: 'GET', url: '/api/notification-settings/email/oauth2/authorize',
      headers: { ...H(cfg), 'x-forwarded-host': 'fms.cov.test', 'x-forwarded-proto': 'https' },
    });
    const url = new URL(res.json().authUrl);
    expect(`${url.origin}${url.pathname}`).toBe('https://login.microsoftonline.com/tid-9/oauth2/v2.0/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'ms-cid', response_type: 'code', response_mode: 'query', prompt: 'consent',
      redirect_uri: 'https://fms.cov.test/api/notification-settings/email/oauth2/code',
      scope: 'offline_access https://outlook.office365.com/SMTP.Send',
    });
    const stored = await storedEmail();
    expect(url.searchParams.get('state')).toBe(stored.oauth2PendingState);
    expect(Date.now() - stored.oauth2PendingStateAt).toBeLessThan(60_000);
  });

  it('authorize (Google) builds the offline-access URL; an unknown provider gets none', async () => {
    await setConfig('notification-email', { ...EMAIL_BASE, authType: 'oauth2', oauth2Provider: 'google', clientId: 'g-cid' });
    const g = new URL((await get('/api/notification-settings/email/oauth2/authorize', cfg)).json().authUrl);
    expect(g.origin + g.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(g.searchParams.get('access_type')).toBe('offline');
    expect(g.searchParams.get('scope')).toBe('https://mail.google.com/');

    await setConfig('notification-email', { ...EMAIL_BASE, authType: 'oauth2', oauth2Provider: 'custom', clientId: 'c-cid' });
    expect((await get('/api/notification-settings/email/oauth2/authorize', cfg)).json()).toEqual({ authUrl: '' });
  });

  it('authorize needs CONFIG_UPDATE', async () => {
    expect((await get('/api/notification-settings/email/oauth2/authorize', ro)).statusCode).toBe(403);
  });

  it('the callback is public and escapes a provider-supplied error (H-4)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/notification-settings/email/oauth2/code?error=${encodeURIComponent('<img src=x>')}&error_description=${encodeURIComponent('"><script>alert(1)</script>')}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.body).toContain('&lt;img src=x&gt;: &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(res.body).not.toContain('<script>alert(1)');
  });

  it('the callback without a code says so', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notification-settings/email/oauth2/code' });
    expect(res.body).toContain('No authorization code received.');
  });

  it.each([
    ['no state', (_s: string) => ''],
    ['a forged state', (_s: string) => '&state=attacker-state'],
  ])('the callback with %s is refused before any token exchange (CSRF)', async (_l, q) => {
    await setConfig('notification-email', { ...EMAIL_BASE, oauth2Provider: 'microsoft', clientId: 'id', clientSecret: 's', oauth2PendingState: 'good-state', oauth2PendingStateAt: Date.now() });
    const res = await app.inject({ method: 'GET', url: `/api/notification-settings/email/oauth2/code?code=abc${q('good-state')}` });
    expect(res.body).toContain('Invalid or expired authorization state');
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await storedEmail()).accessToken).toBeUndefined();
  });

  it('an expired state (> 10 min) is refused', async () => {
    await setConfig('notification-email', { ...EMAIL_BASE, oauth2Provider: 'microsoft', clientId: 'id', oauth2PendingState: 'old', oauth2PendingStateAt: Date.now() - 11 * 60_000 });
    const res = await app.inject({ method: 'GET', url: '/api/notification-settings/email/oauth2/code?code=abc&state=old' });
    expect(res.body).toContain('Invalid or expired authorization state');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a valid Microsoft callback exchanges the code, saves the tokens and consumes the state', async () => {
    await setConfig('notification-email', {
      ...EMAIL_BASE, authType: 'oauth2', oauth2Provider: 'office365', clientId: 'ms-cid', clientSecret: 'ms~secret',
      providerTenantId: 'tid-9', oauth2PendingState: 'st-ok', oauth2PendingStateAt: Date.now(),
    });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'AT-1', refresh_token: 'RT-1', expires_in: 1800 }), { status: 200 }));
    const res = await app.inject({
      method: 'GET', url: '/api/notification-settings/email/oauth2/code?code=the-code&state=st-ok',
      headers: { 'x-forwarded-host': 'fms.cov.test', 'x-forwarded-proto': 'https' },
    });
    expect(res.body).toContain('OAuth2 Authorization Successful!');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://login.microsoftonline.com/tid-9/oauth2/v2.0/token');
    expect(init.body).toContain('client_secret=ms~secret');
    expect(Object.fromEntries(new URLSearchParams(init.body))).toMatchObject({
      client_id: 'ms-cid', code: 'the-code', grant_type: 'authorization_code',
      redirect_uri: 'https://fms.cov.test/api/notification-settings/email/oauth2/code',
      scope: 'offline_access https://outlook.office365.com/SMTP.Send',
    });
    const stored = await storedEmail();
    expect(stored).toMatchObject({ accessToken: 'AT-1', refreshToken: 'RT-1', oauth2Configured: true, oauth2PendingState: null, oauth2PendingStateAt: null });
    expect(stored.tokenExpiresAt - Date.now()).toBeGreaterThan(1_700_000);

    // replaying the same code+state fails: the state was consumed
    const replay = await app.inject({ method: 'GET', url: '/api/notification-settings/email/oauth2/code?code=the-code&state=st-ok' });
    expect(replay.body).toContain('Invalid or expired authorization state');

    const status = await get('/api/notification-settings/email/oauth2/status', ro);
    expect(status.json()).toEqual({ configured: true, hasRefreshToken: true, tokenExpiresAt: new Date(stored.tokenExpiresAt).toISOString() });
  });

  it('a Google callback keeps the stored refresh token when none is returned and defaults the lifetime to 1 h', async () => {
    await setConfig('notification-email', {
      ...EMAIL_BASE, oauth2Provider: 'google', clientId: 'g', clientSecret: 'gs', refreshToken: 'KEEP-RT',
      oauth2PendingState: 'g-st', oauth2PendingStateAt: Date.now(),
    });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'G-AT' }), { status: 200 }));
    const res = await app.inject({ method: 'GET', url: '/api/notification-settings/email/oauth2/code?code=c&state=g-st' });
    expect(res.body).toContain('OAuth2 Authorization Successful!');
    expect(fetchMock.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token');
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).has('scope')).toBe(false);
    const stored = await storedEmail();
    expect(stored).toMatchObject({ accessToken: 'G-AT', refreshToken: 'KEEP-RT' });
    expect(stored.tokenExpiresAt - Date.now()).toBeGreaterThan(3_500_000);
  });

  it('a token-endpoint refusal is shown escaped and nothing is saved', async () => {
    await setConfig('notification-email', { ...EMAIL_BASE, oauth2Provider: 'microsoft', clientId: 'id', oauth2PendingState: 'e-st', oauth2PendingStateAt: Date.now() });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid_grant', error_description: '<b>code expired</b>' }), { status: 400 }));
    const res = await app.inject({ method: 'GET', url: '/api/notification-settings/email/oauth2/code?code=c&state=e-st' });
    expect(res.body).toContain('<h2>Token Error</h2><p>&lt;b&gt;code expired&lt;/b&gt;</p>');
    expect((await storedEmail()).accessToken).toBeUndefined();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unauthorized_client' }), { status: 401 }));
    expect((await app.inject({ method: 'GET', url: '/api/notification-settings/email/oauth2/code?code=c&state=e-st' })).body).toContain('<p>unauthorized_client</p>');
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    expect((await app.inject({ method: 'GET', url: '/api/notification-settings/email/oauth2/code?code=c&state=e-st' })).body).toContain('<p>Token exchange failed</p>');
  });

  it('a transport failure during the exchange is reported escaped', async () => {
    await setConfig('notification-email', { ...EMAIL_BASE, oauth2Provider: 'microsoft', clientId: 'id', oauth2PendingState: 'x-st', oauth2PendingStateAt: Date.now() });
    fetchMock.mockRejectedValueOnce(new Error('connect ETIMEDOUT <idp>'));
    const res = await app.inject({ method: 'GET', url: '/api/notification-settings/email/oauth2/code?code=c&state=x-st' });
    expect(res.body).toContain('<h2>Error</h2><p>connect ETIMEDOUT &lt;idp&gt;</p>');
  });

  // The callback is PUBLIC (no JWT). A database failure inside it used to be
  // shown verbatim — Prisma text embeds the source path — to whoever loaded it.
  it('a database failure in the callback is reported generically (the raw Prisma text stays server-side)', async () => {
    // A REAL Prisma error: the config row disappears while the token exchange is
    // in flight, so the handler's final update fails with P2025. (Spying on a
    // Prisma model delegate is unsafe: it is a proxy the spy cannot pass through.)
    await setConfig('notification-email', { ...EMAIL_BASE, oauth2Provider: 'microsoft', clientId: 'id', oauth2PendingState: 'db-st', oauth2PendingStateAt: Date.now() });
    fetchMock.mockImplementationOnce(async () => {
      await prisma.systemConfig.deleteMany({ where: { configKey: 'notification-email' } });
      return new Response(JSON.stringify({ access_token: 'AT', expires_in: 60 }), { status: 200 });
    });
    const res = await app.inject({ method: 'GET', url: '/api/notification-settings/email/oauth2/code?code=c&state=db-st' });
    expect(res.body).toContain('<h2>Error</h2><p>The authorization could not be completed because of an internal error. The details are in the server log.</p>');
    expect(res.body).not.toMatch(/prisma|invocation|\.ts/i);
  });

  it('status reports an unconfigured mailbox', async () => {
    await setConfig('notification-email', EMAIL_BASE);
    // The handler returns null, but the response schema types the field as a
    // plain string, so it reaches the wire as "" today (reported as a contract
    // nit). Only "no expiry" is asserted — null or "" both satisfy it.
    const body = (await get('/api/notification-settings/email/oauth2/status', ro)).json();
    expect(body).toMatchObject({ configured: false, hasRefreshToken: false });
    expect(body.tokenExpiresAt || null).toBeNull();
  });
});

describe('SMS configuration', () => {
  it('GET masks provider secrets and every gateway header value', async () => {
    await setConfig('notification-sms', {
      provider: 'http-gateway', enabled: true, twilioAuthToken: 'tw', vonageApiSecret: 'vs', twilioAccountSid: 'ACpub',
      httpGatewayHeaders: { Authorization: 'Bearer k', 'X-Empty': '' },
    });
    const body = (await get('/api/notification-settings/sms', ro)).json();
    expect(body).toMatchObject({ twilioAuthToken: MASK, vonageApiSecret: MASK, twilioAccountSid: 'ACpub' });
    expect(body.httpGatewayHeaders).toEqual({ Authorization: MASK, 'X-Empty': '' });
  });

  it('GET answers {} when unconfigured', async () => {
    await prisma.systemConfig.deleteMany({ where: { configKey: 'notification-sms' } });
    expect((await get('/api/notification-settings/sms', ro)).json()).toEqual({});
  });

  it('PUT creates, then merges; a masked token or header keeps its stored value', async () => {
    const created = await app.inject({
      method: 'PUT', url: '/api/notification-settings/sms', headers: H(sa, PW),
      payload: { provider: 'twilio', enabled: false, twilioAccountSid: 'AC1', twilioAuthToken: 'real-tok', httpGatewayHeaders: { Authorization: 'Bearer real' } },
    });
    expect(created.statusCode).toBe(200);
    expect((await latestAudit('UPDATE_SMS_CONFIG', 'notification-sms'))!.beforeValue).toBeNull();

    const res = await app.inject({
      method: 'PUT', url: '/api/notification-settings/sms', headers: H(sa, PW),
      payload: { twilioAuthToken: MASK, httpGatewayHeaders: { Authorization: MASK, 'X-New': 'v' }, senderId: 'DIGI' },
    });
    expect(res.statusCode).toBe(200);
    expect(await storedSms()).toMatchObject({
      provider: 'twilio', twilioAccountSid: 'AC1', twilioAuthToken: 'real-tok', senderId: 'DIGI',
      httpGatewayHeaders: { Authorization: 'Bearer real', 'X-New': 'v' },
    });
    const audit = await latestAudit('UPDATE_SMS_CONFIG', 'notification-sms');
    expect((audit!.beforeValue as any).twilioAccountSid).toBe('AC1');
  });

  it('PUT rejects an unknown provider and enforces re-auth / permission', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/notification-settings/sms', headers: H(sa, PW), payload: { provider: 'aws-sns' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/notification-settings/sms', headers: H(ro, PW), payload: { senderId: 'x' } })).statusCode).toBe(403);
    const r = await app.inject({ method: 'PUT', url: '/api/notification-settings/sms', headers: H(cfg), payload: { senderId: 'x' } });
    expect(r.statusCode).toBe(401);
    expect(r.json().action).toBe('UPDATE_SMS_CONFIG');
  });

  it('POST /sms/test requires a recipient and reports the provider outcome', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/notification-settings/sms/test', headers: H(sa), payload: {} })).statusCode).toBe(400);
    await setConfig('notification-sms', { provider: 'twilio', enabled: true, twilioAccountSid: 'AC', twilioAuthToken: 't', twilioFromNumber: '+15550000000' });
    invalidateNotificationConfigCache();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ sid: 'SMt' }), { status: 201 }));
    const phone = `+9198${String(Date.now()).slice(-8)}`;
    const ok = await app.inject({ method: 'POST', url: '/api/notification-settings/sms/test', headers: H(sa), payload: { recipient: phone } });
    expect(ok.json()).toEqual({ success: true, message: `Test SMS sent to ${phone}` });
    await prisma.notificationLog.deleteMany({ where: { recipient: phone } });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const bad = await app.inject({ method: 'POST', url: '/api/notification-settings/sms/test', headers: H(sa), payload: { recipient: `x${TAG}` } });
    expect(bad.json()).toEqual({ success: false, error: `Invalid phone number: x${TAG}` });
  });

  // D3 (2026-10-21): an unreachable / blocked gateway made /sms/test answer 500
  // with a non-AppError message, and left the log row PENDING forever.
  it('POST /sms/test with a gateway the SSRF guard blocks reports the failure (200) and the row is not stranded', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await setConfig('notification-sms', { provider: 'http-gateway', enabled: true, httpGatewayUrl: 'http://127.0.0.1:9/send' });
    invalidateNotificationConfigCache();
    const phone = `+9197${String(Date.now()).slice(-8)}`;
    const res = await app.inject({ method: 'POST', url: '/api/notification-settings/sms/test', headers: H(sa), payload: { recipient: phone } });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(false);
    expect(res.json().error).toMatch(/^SMS request failed \(http-gateway\): Blocked outbound request: /);
    expect(fetchMock).not.toHaveBeenCalled();
    const row = await prisma.notificationLog.findFirst({ where: { recipient: phone } });
    expect(row!.status).toBe('RETRYING');
    expect(row!.errorMessage).toBe(res.json().error);
    await prisma.notificationLog.deleteMany({ where: { recipient: phone } });
  });
});

// SEC-03 (security assessment 06, operator decision 2026-10-22): POST /send let a
// CONFIG_UPDATE holder e-mail / text ANY recipient ANY text, with no signature, no
// audit row and nobody recorded as sender - and nothing in the app called it. It is
// REMOVED. The two test-sends stay, and each now writes an audit row: who, which
// channel, to whom, and whether it worked - never the error text (a delivery error
// can echo the http-gateway URL, which may carry an API key) or any config value.
describe('SEC-03: POST /send is removed; every test-send is audited', () => {
  const testRows = (userId: string) =>
    prisma.auditTrail.findMany({ where: { action: 'NOTIFICATION_TEST_SENT', userId }, orderBy: { chainPosition: 'asc' } });
  // The whole stored row as text (chainPosition is a BigInt), to prove no secret is in ANY column.
  const text = (row: unknown) => JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  const SMTP_SECRET = `smtp-secret-${TAG}`;
  const EMAIL_WITH_SECRETS = { ...EMAIL_BASE, password: SMTP_SECRET, clientSecret: `cs-secret-${TAG}` };

  it('POST /send answers exactly like an unknown path, for any role, and sends nothing', async () => {
    await setConfig('notification-email', EMAIL_BASE);
    invalidateNotificationConfigCache();
    const to = `cov-ns-gone-${TAG}@cov.test`;
    const payload = { channel: 'EMAIL', recipient: to, subject: 's', message: 'm' };
    for (const token of [sa, cfg, ro]) {
      const send = await app.inject({ method: 'POST', url: '/api/notification-settings/send', headers: H(token), payload });
      const unknown = await app.inject({ method: 'POST', url: '/api/notification-settings/no-such-route', headers: H(token), payload });
      expect(unknown.statusCode).toBe(404);
      expect(send.statusCode).toBe(unknown.statusCode);
      expect(send.body).toBe(unknown.body.split('no-such-route').join('send'));
    }
    expect(sendMail).not.toHaveBeenCalled();
    expect(await prisma.notificationLog.count({ where: { recipient: to } })).toBe(0);
  });

  it('/email/test with a recipient writes one row: who, EMAIL, the recipient, SEND, success - and no SMTP secret', async () => {
    await setConfig('notification-email', EMAIL_WITH_SECRETS);
    invalidateNotificationConfigCache();
    const before = (await testRows(SA)).length;
    const to = `cov-ns-audit-${TAG}@cov.test`;
    const res = await app.inject({ method: 'POST', url: '/api/notification-settings/email/test', headers: H(sa), payload: { recipient: to } });
    expect(res.json()).toEqual({ success: true, message: `Test email sent to ${to}` });

    const rows = await testRows(SA);
    expect(rows).toHaveLength(before + 1);
    const row = rows[rows.length - 1];
    expect(row).toMatchObject({ userId: SA, userRole: 'SUPER_ADMIN', targetType: 'system_config', targetId: 'notification-email', beforeValue: null });
    expect(row.afterValue).toEqual({ channel: 'EMAIL', recipient: to, mode: 'SEND', success: true });
    expect(text(row)).not.toContain(SMTP_SECRET);
    expect(text(row)).not.toContain(`cs-secret-${TAG}`);
  });

  it('/email/test without a recipient records the SMTP connection check (recipient null)', async () => {
    await setConfig('notification-email', EMAIL_WITH_SECRETS);
    invalidateNotificationConfigCache();
    const before = (await testRows(CFG)).length;
    const res = await app.inject({ method: 'POST', url: '/api/notification-settings/email/test', headers: H(cfg), payload: {} });
    expect(res.json()).toEqual({ success: true, message: 'SMTP connection verified successfully' });
    const rows = await testRows(CFG);
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]).toMatchObject({ userId: CFG, targetId: 'notification-email' });
    expect(rows[rows.length - 1].afterValue).toEqual({ channel: 'EMAIL', recipient: null, mode: 'CONNECTION_CHECK', success: true });
  });

  it('a failed test-send is still recorded, as failed, without the error text', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await setConfig('notification-email', { ...EMAIL_WITH_SECRETS, enabled: false });
    invalidateNotificationConfigCache();
    const before = (await testRows(SA)).length;
    const to = `cov-ns-audit-off-${TAG}@cov.test`;
    const res = await app.inject({ method: 'POST', url: '/api/notification-settings/email/test', headers: H(sa), payload: { recipient: to } });
    expect(res.json()).toEqual({ success: false, error: 'Email notifications are not enabled' });
    const rows = await testRows(SA);
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1].afterValue).toEqual({ channel: 'EMAIL', recipient: to, mode: 'SEND', success: false });
    expect(text(rows[rows.length - 1])).not.toContain('not enabled');
  });

  it('/sms/test records SMS + the recipient; the provider token and a gateway URL with a key never reach the row', async () => {
    const TWILIO_TOKEN = `tw-secret-${TAG}`;
    await setConfig('notification-sms', { provider: 'twilio', enabled: true, twilioAccountSid: 'AC', twilioAuthToken: TWILIO_TOKEN, twilioFromNumber: '+15550000000' });
    invalidateNotificationConfigCache();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ sid: 'SMt' }), { status: 201 }));
    const before = (await testRows(SA)).length;
    const phone = `+9196${String(Date.now()).slice(-8)}`;
    const ok = await app.inject({ method: 'POST', url: '/api/notification-settings/sms/test', headers: H(sa), payload: { recipient: phone } });
    expect(ok.json()).toEqual({ success: true, message: `Test SMS sent to ${phone}` });
    let rows = await testRows(SA);
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]).toMatchObject({ targetId: 'notification-sms' });
    expect(rows[rows.length - 1].afterValue).toEqual({ channel: 'SMS', recipient: phone, mode: 'SEND', success: true });
    expect(text(rows[rows.length - 1])).not.toContain(TWILIO_TOKEN);
    await prisma.notificationLog.deleteMany({ where: { recipient: phone } });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const GW_KEY = `gw-secret-${TAG}`;
    await setConfig('notification-sms', { provider: 'http-gateway', enabled: true, httpGatewayUrl: `http://127.0.0.1:9/send?apikey=${GW_KEY}` });
    invalidateNotificationConfigCache();
    const phone2 = `+9195${String(Date.now()).slice(-8)}`;
    const bad = await app.inject({ method: 'POST', url: '/api/notification-settings/sms/test', headers: H(sa), payload: { recipient: phone2 } });
    expect(bad.statusCode).toBe(200);
    expect(bad.json().success).toBe(false);
    rows = await testRows(SA);
    expect(rows).toHaveLength(before + 2);
    expect(rows[rows.length - 1].afterValue).toEqual({ channel: 'SMS', recipient: phone2, mode: 'SEND', success: false });
    expect(text(rows[rows.length - 1])).not.toContain(GW_KEY);
    expect(text(rows[rows.length - 1])).not.toContain('127.0.0.1:9');
    await prisma.notificationLog.deleteMany({ where: { recipient: phone2 } });
  });

  it('a refused request (400 / 403) writes no row', async () => {
    const [saBefore, roBefore, noneBefore] = (await Promise.all([testRows(SA), testRows(RO), testRows(NONE)])).map((x) => x.length);
    expect((await app.inject({ method: 'POST', url: '/api/notification-settings/sms/test', headers: H(sa), payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/notification-settings/email/test', headers: H(ro), payload: { recipient: `r-${TAG}@cov.test` } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/notification-settings/sms/test', headers: H(none), payload: { recipient: '+919800000000' } })).statusCode).toBe(403);
    expect((await testRows(SA)).length).toBe(saBefore);
    expect((await testRows(RO)).length).toBe(roBefore);
    expect((await testRows(NONE)).length).toBe(noneBefore);
  });
});

describe('delivery logs', () => {
  // a marker only these five rows carry (other rows in this file contain TAG too)
  const LG = `LG${TAG}`;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    const mk = (n: string, channel: 'EMAIL' | 'SMS', status: any, createdAt: string, subject: string | null = null) =>
      prisma.notificationLog.create({ data: { channel, status, recipient: `log-${n}-${LG}`, subject, message: 'm', createdAt: new Date(createdAt) } }).then(r => { ids[n] = r.id; });
    await mk('e1', 'EMAIL', 'SENT', '2026-01-10T10:00:00Z', `Subj-${LG}`);
    await mk('e2', 'EMAIL', 'FAILED', '2026-01-11T10:00:00Z');
    await mk('s1', 'SMS', 'SENT', '2026-01-12T10:00:00Z');
    await mk('s2', 'SMS', 'RETRYING', '2026-01-13T10:00:00Z');
    await mk('s3', 'SMS', 'FAILED', '2026-02-01T10:00:00Z');
  });

  const list = async (qs: string) => (await get(`/api/notification-settings/logs?search=${LG}&${qs}`, ro)).json();

  it('searches recipient and subject, newest first, with pagination', async () => {
    const all = await list('');
    expect(all.total).toBe(5);
    expect(all.data.map((r: any) => r.recipient.split('-')[1])).toEqual(['s3', 's2', 's1', 'e2', 'e1']);
    const p2 = await list('page=2&limit=2');
    expect(p2).toMatchObject({ total: 5, page: 2, limit: 2, totalPages: 3 });
    expect(p2.data.map((r: any) => r.recipient.split('-')[1])).toEqual(['s1', 'e2']);
    // subject match (case-insensitive) finds the row by its subject alone
    const bySubject = (await get(`/api/notification-settings/logs?search=${encodeURIComponent(`subj-${LG}`.toUpperCase())}`, ro)).json();
    expect(bySubject.data.map((r: any) => r.id)).toEqual([ids.e1]);
  });

  it('filters by channel, status and date range', async () => {
    expect((await list('channel=SMS')).total).toBe(3);
    expect((await list('channel=SMS&status=FAILED')).data.map((r: any) => r.id)).toEqual([ids.s3]);
    expect((await list('startDate=2026-01-11T00:00:00Z&endDate=2026-01-12T23:59:59Z')).data.map((r: any) => r.id)).toEqual([ids.s1, ids.e2]);
    expect((await list('startDate=2026-01-13T00:00:00Z')).total).toBe(2);
    expect((await list('endDate=2026-01-10T23:00:00Z')).data.map((r: any) => r.id)).toEqual([ids.e1]);
  });

  it('rejects an unknown status and a zero page', async () => {
    expect((await get('/api/notification-settings/logs?status=LOST', ro)).statusCode).toBe(400);
    expect((await get('/api/notification-settings/logs?page=0', ro)).statusCode).toBe(400);
  });

  it('stats count SENT/FAILED per channel (at least this file\'s rows)', async () => {
    const res = await get('/api/notification-settings/logs/stats', ro);
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.email.sent).toBeGreaterThanOrEqual(1);
    expect(s.email.failed).toBeGreaterThanOrEqual(1);
    expect(s.sms.sent).toBeGreaterThanOrEqual(1);
    expect(s.sms.failed).toBeGreaterThanOrEqual(1);
    expect(s.total).toBeGreaterThanOrEqual(5);
    expect(s.total).toBeGreaterThanOrEqual(s.email.sent + s.email.failed + s.sms.sent + s.sms.failed);
  });

  it('logs and stats are refused without CONFIG_READ', async () => {
    expect((await get('/api/notification-settings/logs', none)).statusCode).toBe(403);
    expect((await get('/api/notification-settings/logs/stats', none)).statusCode).toBe(403);
  });

  it('DELETE audits the dispatch evidence BEFORE removing the row', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/notification-settings/logs/${ids.e1}`, headers: H(sa, PW) });
    expect(res.statusCode).toBe(200);
    expect(await prisma.notificationLog.findUnique({ where: { id: ids.e1 } })).toBeNull();
    const audit = await latestAudit('NOTIFICATION_LOG_DELETED', ids.e1);
    expect(audit!.beforeValue).toMatchObject({ channel: 'EMAIL', status: 'SENT', recipient: `log-e1-${LG}`, subject: `Subj-${LG}` });
    expect(audit!.signatureMeaning).toBe(`EMAIL delivery log to "log-e1-${LG}" permanently deleted`);
  });

  it('DELETE: 404 for an unknown id, re-auth for the configured role, 403 for read-only', async () => {
    const missing = await app.inject({ method: 'DELETE', url: '/api/notification-settings/logs/00000000-0000-4000-8000-000000000404', headers: H(sa, PW) });
    expect(missing.statusCode).toBe(404);
    const r401 = await app.inject({ method: 'DELETE', url: `/api/notification-settings/logs/${ids.e2}`, headers: H(cfg) });
    expect(r401.statusCode).toBe(401);
    const r403 = await app.inject({ method: 'DELETE', url: `/api/notification-settings/logs/${ids.e2}`, headers: H(ro, PW) });
    expect(r403.statusCode).toBe(403);
    expect(await prisma.notificationLog.findUnique({ where: { id: ids.e2 } })).not.toBeNull();
    const ok = await app.inject({ method: 'DELETE', url: `/api/notification-settings/logs/${ids.e2}`, headers: H(cfg, PW) });
    expect(ok.statusCode).toBe(200);
  });
});

describe('notification templates', () => {
  let id = '';
  const name = `cov tpl ${TAG}`;

  it('POST creates a template and audits it', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/notification-settings/templates', headers: H(cfg),
      payload: { name, channel: 'EMAIL', subject: 'S ${x}', bodyTemplate: '<p>${x}</p>', description: 'd', variables: ['x'] },
    });
    expect(res.statusCode).toBe(200);
    id = res.json().id;
    tplIds.push(id);
    expect(res.json()).toMatchObject({ name, channel: 'EMAIL', createdBy: CFG, isActive: true });
    const audit = await latestAudit('NOTIFICATION_TEMPLATE_CREATED', id);
    expect(audit!.afterValue).toEqual({ name, channel: 'EMAIL', subject: 'S ${x}', bodyTemplate: '<p>${x}</p>', description: 'd', variables: ['x'] });
  });

  it('GET lists it', async () => {
    const res = await get('/api/notification-settings/templates', ro);
    expect(res.json().some((t: any) => t.id === id)).toBe(true);
  });

  it('POST rejects a missing body, an unknown channel and a duplicate name', async () => {
    const post = (payload: object) => app.inject({ method: 'POST', url: '/api/notification-settings/templates', headers: H(cfg), payload });
    expect((await post({ name: 'x', channel: 'EMAIL' })).statusCode).toBe(400);
    expect((await post({ name: 'x', channel: 'PUSH', bodyTemplate: 'b' })).statusCode).toBe(400);
    const dup = await post({ name, channel: 'SMS', bodyTemplate: 'b' });
    expect(dup.statusCode).toBe(409);
  });

  it('PUT updates only whitelisted fields (channel/createdBy stay) and audits before/after', async () => {
    const res = await app.inject({
      method: 'PUT', url: `/api/notification-settings/templates/${id}`, headers: H(cfg),
      // the page sends the whole object back, provenance included
      payload: { id, name: `${name} v2`, bodyTemplate: '<b>${x}</b>', isActive: false, channel: 'SMS', createdBy: 'forged', createdAt: '2000-01-01' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: `${name} v2`, bodyTemplate: '<b>${x}</b>', isActive: false, channel: 'EMAIL', createdBy: CFG });
    const audit = await latestAudit('NOTIFICATION_TEMPLATE_UPDATED', id);
    expect(audit!.beforeValue).toMatchObject({ name, isActive: true });
    expect(audit!.afterValue).toMatchObject({ name: `${name} v2`, isActive: false });
  });

  it('PUT / DELETE on an unknown id answer 404', async () => {
    const missing = '00000000-0000-4000-8000-0000000007e7';
    expect((await app.inject({ method: 'PUT', url: `/api/notification-settings/templates/${missing}`, headers: H(cfg), payload: { name: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/notification-settings/templates/${missing}`, headers: H(cfg) })).statusCode).toBe(404);
  });

  it('template writes need CONFIG_UPDATE', async () => {
    expect((await app.inject({ method: 'DELETE', url: `/api/notification-settings/templates/${id}`, headers: H(ro) })).statusCode).toBe(403);
    expect((await get('/api/notification-settings/templates', none)).statusCode).toBe(403);
  });

  it('DELETE audits the template before removing it', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/notification-settings/templates/${id}`, headers: H(cfg) });
    expect(res.json()).toEqual({ success: true });
    expect(await prisma.notificationTemplate.findUnique({ where: { id } })).toBeNull();
    const audit = await latestAudit('NOTIFICATION_TEMPLATE_DELETED', id);
    expect(audit!.beforeValue).toMatchObject({ name: `${name} v2`, channel: 'EMAIL', isActive: false });
    expect(audit!.afterValue).toEqual({ deleted: true });
  });
});
