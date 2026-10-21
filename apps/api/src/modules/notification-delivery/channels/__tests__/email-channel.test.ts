/**
 * emailChannel against the real notification-email config row (coverage
 * campaign 2026-10-21). Boundaries mocked:
 *   - nodemailer.createTransport (SMTP) — the options it receives are asserted;
 *   - global fetch + node:dns/promises — the OAuth2 token endpoints are reached
 *     through the REAL lib/ssrf.ts hardenedFetch.
 * The Microsoft refresh-token path persists rotated tokens with its own
 * PrismaClient into notification-email; that row is snapshotted and restored.
 *
 * Module state (cached transporter / OAuth token) is steered deliberately:
 * every test uses a distinct SMTP host (busts the transporter cache) and token
 * responses default to a short lifetime (< the 60 s reuse buffer) so a token is
 * only reused where a test asks for it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { prisma } from '../../../../lib/prisma.js';
import { emailChannel } from '../email-channel.js';
import { invalidateNotificationConfigCache } from '../../config-loader.js';
import { snapshotConfig, restoreConfig, setConfig, type ConfigSnapshot } from '../../__tests__/cov-fixtures.js';

const { sendMail, verify, createTransport, lookup } = vi.hoisted(() => {
  const sendMail = vi.fn();
  const verify = vi.fn();
  const createTransport = vi.fn(() => ({ sendMail, verify }));
  return { sendMail, verify, createTransport, lookup: vi.fn() };
});
vi.mock('nodemailer', () => ({ default: { createTransport } }));
vi.mock('node:dns/promises', () => ({ lookup, default: { lookup } }));

const fetchMock = vi.fn();
let snap: ConfigSnapshot;
let hostSeq = 0;

const BASE = {
  port: 587, secure: false, enabled: true, authType: 'basic',
  username: 'mailer@cov.test', password: 'pw-1', fromEmail: 'noreply@cov.test', fromName: 'DigiLog Cov',
};
async function useEmail(cfg: Record<string, unknown> = {}) {
  const host = `smtp${++hostSeq}.cov.invalid`;
  await setConfig('notification-email', { ...BASE, host, ...cfg });
  invalidateNotificationConfigCache();
  return host;
}
const tokenRes = (token: string, expires_in = 30, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ access_token: token, expires_in, ...extra }), { status: 200 });
const send = (message = 'hello', subject?: string) =>
  emailChannel.send({ channel: 'EMAIL', recipient: 'ops@cov.test', message, ...(subject ? { subject } : {}) });
const lastTransportOpts = () => (createTransport.mock.calls.at(-1) as any[])[0];

beforeAll(async () => {
  snap = await snapshotConfig('notification-email');
  vi.stubGlobal('fetch', fetchMock);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await restoreConfig(snap);
  invalidateNotificationConfigCache();
});
beforeEach(() => {
  sendMail.mockReset();
  verify.mockReset();
  createTransport.mockClear();
  fetchMock.mockReset();
  lookup.mockReset();
  lookup.mockImplementation(async (host: string) => {
    const table: Record<string, string> = {
      'login.microsoftonline.com': '20.190.160.20',
      'oauth2.googleapis.com': '142.250.183.10',
      'idp.cov.test': '203.0.113.20',
      'internal-idp.cov.test': '127.0.0.1',
    };
    if (!table[host]) throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    return [{ address: table[host], family: 4 }];
  });
});

describe('basic auth', () => {
  it('refuses while disabled or unconfigured', async () => {
    await useEmail({ enabled: false });
    expect(await send()).toEqual({ success: false, error: 'Email notifications are not enabled' });
    expect(await emailChannel.testConnection()).toEqual({ success: false, error: 'Email notifications are not enabled' });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('builds a TLS-verifying transport and sends text + branded HTML', async () => {
    const host = await useEmail();
    sendMail.mockResolvedValueOnce({ messageId: '<a@cov>' });
    expect(await send('line one\nline two', 'Filter overdue')).toEqual({ success: true, messageId: '<a@cov>' });

    const opts = lastTransportOpts();
    expect(opts).toMatchObject({
      host, port: 587, secure: false, family: 4,
      auth: { user: 'mailer@cov.test', pass: 'pw-1' },
      tls: { rejectUnauthorized: true }, // secure by default (2026-07-15)
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    });
    const mail = sendMail.mock.calls[0][0];
    expect(mail).toMatchObject({ from: '"DigiLog Cov" <noreply@cov.test>', to: 'ops@cov.test', subject: 'Filter overdue', text: 'line one\nline two' });
    // plain text: newlines become <br>, subject is the page title and heading
    expect(mail.html).toContain('line one<br>line two');
    expect(mail.html).toContain('<title>Filter overdue</title>');
    expect(mail.html).toContain('>Filter overdue</h2>');
  });

  it('passes HTML through untouched, strips tags for the text part, and defaults the subject', async () => {
    await useEmail();
    sendMail.mockResolvedValueOnce({ messageId: '<b@cov>' });
    await send('<p>Hi<br>there</p>');
    const mail = sendMail.mock.calls[0][0];
    expect(mail.subject).toBe('DigiLog Notification');
    expect(mail.text).toBe('Hithere');
    expect(mail.html).toContain('<p>Hi<br>there</p>');
  });

  // D7 (2026-10-21): the Subject is plain text. It goes into the Subject header as
  // is, and is escaped only where it is embedded in the HTML wrapper (<title>,
  // <h2>), which it used not to be. The text alternative never shows entities.
  it('escapes the subject inside the HTML wrapper only, and the text part carries no entities', async () => {
    await useEmail();
    sendMail.mockResolvedValueOnce({ messageId: '<d7@cov>' });
    const subject = 'Pump <3> "A&B" fault';
    await send('<p>Tank &quot;A&amp;B&quot; &lt;north&gt; it&#39;s down</p>', subject);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.subject).toBe(subject);
    expect(mail.html).toContain('<title>Pump &lt;3&gt; &quot;A&amp;B&quot; fault</title>');
    expect(mail.html).toContain('>Pump &lt;3&gt; &quot;A&amp;B&quot; fault</h2>');
    expect(mail.html).not.toContain(subject);
    expect(mail.text).toBe('Tank "A&B" <north> it\'s down');
  });

  it('honours an explicit tlsRejectUnauthorized=false for a self-signed internal server', async () => {
    await useEmail({ tlsRejectUnauthorized: false });
    sendMail.mockResolvedValueOnce({ messageId: '<c@cov>' });
    await send();
    expect(lastTransportOpts().tls).toEqual({ rejectUnauthorized: false });
  });

  it('reuses the transporter for an unchanged config and rebuilds it on a password rotation (#notif-1)', async () => {
    const host = await useEmail();
    sendMail.mockResolvedValue({ messageId: '<d@cov>' });
    await send();
    await send();
    expect(createTransport).toHaveBeenCalledTimes(1);
    await setConfig('notification-email', { ...BASE, host, password: 'pw-ROTATED' });
    invalidateNotificationConfigCache();
    await send();
    expect(createTransport).toHaveBeenCalledTimes(2);
    expect(lastTransportOpts().auth.pass).toBe('pw-ROTATED');
  });

  it('reports a send error as a failed DeliveryResult (Error and non-Error throws)', async () => {
    await useEmail();
    sendMail.mockRejectedValueOnce(new Error('535 auth failed'));
    expect(await send()).toEqual({ success: false, error: '535 auth failed' });
    sendMail.mockRejectedValueOnce('socket hang up');
    expect(await send()).toEqual({ success: false, error: 'socket hang up' });
    // basic auth keeps its transporter after a failure
    expect(createTransport).toHaveBeenCalledTimes(1);
  });

  it('testConnection verifies SMTP; a failure resets the transporter so the next call rebuilds it', async () => {
    await useEmail();
    verify.mockResolvedValueOnce(true);
    expect(await emailChannel.testConnection()).toEqual({ success: true, messageId: 'connection-verified' });
    verify.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await emailChannel.testConnection()).toEqual({ success: false, error: 'ECONNREFUSED' });
    verify.mockRejectedValueOnce(42);
    expect(await emailChannel.testConnection()).toEqual({ success: false, error: '42' });
    // built once, reused by the 2nd call, rebuilt for the 3rd after the 2nd failed
    expect(createTransport).toHaveBeenCalledTimes(2);
  });

  it('the transport resolves hosts over IPv4 only, whatever lookup options nodemailer passes', async () => {
    await useEmail();
    sendMail.mockResolvedValueOnce({ messageId: '<e@cov>' });
    await send();
    const dnsLookup = lastTransportOpts().dnsLookup as (...a: any[]) => void;
    const viaLookup = (...args: any[]) => new Promise<any>((resolve, reject) =>
      dnsLookup('localhost', ...args, (err: any, address: any, family: any) => (err ? reject(err) : resolve({ address, family }))));
    for (const r of [await viaLookup(), await viaLookup(6), await viaLookup({ all: false, family: 6 })]) {
      expect(r).toEqual({ address: '127.0.0.1', family: 4 });
    }
  });
});

describe('OAuth2 — Microsoft / Office 365', () => {
  it('uses a still-valid saved access token without calling the token endpoint', async () => {
    await useEmail({
      authType: 'oauth2', oauth2Provider: 'office365', clientId: 'cid', clientSecret: 'cs',
      accessToken: 'SAVED-AT', tokenExpiresAt: Date.now() + 3_600_000,
    });
    sendMail.mockResolvedValueOnce({ messageId: '<ms1@cov>' });
    expect((await send()).success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lastTransportOpts()).toMatchObject({ auth: { type: 'OAuth2', user: 'mailer@cov.test', accessToken: 'SAVED-AT' }, tls: { rejectUnauthorized: true } });
    // force the cached token out for the following tests
    sendMail.mockRejectedValueOnce(new Error('expire cache'));
    await send();
  });

  it('refresh-token flow: posts to the tenant endpoint and persists the rotated tokens', async () => {
    await useEmail({
      authType: 'oauth2', oauth2Provider: 'microsoft', clientId: 'cid', clientSecret: 'se~cret',
      providerTenantId: 'tenant-1', refreshToken: 'RT-OLD',
    });
    fetchMock.mockResolvedValueOnce(tokenRes('MS-AT', 3600, { refresh_token: 'RT-NEW' }));
    sendMail.mockResolvedValueOnce({ messageId: '<ms2@cov>' });
    expect((await send()).success).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.body).toContain('client_secret=se~cret'); // '~' left unescaped
    const p = new URLSearchParams(init.body);
    expect(p.get('grant_type')).toBe('refresh_token');
    expect(p.get('refresh_token')).toBe('RT-OLD');
    expect(p.get('scope')).toBe('offline_access https://outlook.office365.com/SMTP.Send');
    expect(lastTransportOpts().auth.accessToken).toBe('MS-AT');

    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'notification-email' } });
    const v = row!.configValue as Record<string, any>;
    expect(v.accessToken).toBe('MS-AT');
    expect(v.refreshToken).toBe('RT-NEW');
    expect(v.tokenExpiresAt).toBeGreaterThan(Date.now() + 3_000_000);
  });

  it('a refresh that returns no new refresh token keeps the stored one', async () => {
    // drop the hour-long MS-AT the previous test cached
    await useEmail({ authType: 'oauth2', oauth2Provider: 'microsoft', clientId: 'cid', clientSecret: 'cs', accessToken: 'x', tokenExpiresAt: Date.now() + 3_600_000 });
    sendMail.mockRejectedValueOnce(new Error('drop cache'));
    await send();
    await useEmail({ authType: 'oauth2', oauth2Provider: 'microsoft', clientId: 'cid', clientSecret: 'cs', refreshToken: 'RT-STAYS' });
    fetchMock.mockResolvedValueOnce(tokenRes('MS-AT', 3600)); // no refresh_token in the reply
    sendMail.mockResolvedValueOnce({ messageId: '<ms2b@cov>' });
    expect((await send()).success).toBe(true);
    const v = (await prisma.systemConfig.findUnique({ where: { configKey: 'notification-email' } }))!.configValue as any;
    expect(v).toMatchObject({ accessToken: 'MS-AT', refreshToken: 'RT-STAYS' });
  });

  it('a cached token is reused for the next send (no second token request)', async () => {
    await useEmail({ authType: 'oauth2', oauth2Provider: 'microsoft', clientId: 'cid', clientSecret: 'cs' });
    // the previous test left MS-AT cached for an hour
    sendMail.mockResolvedValueOnce({ messageId: '<ms3@cov>' });
    await send();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lastTransportOpts().auth.accessToken).toBe('MS-AT');
    // an oauth2 send failure drops the cached token AND transporter
    sendMail.mockRejectedValueOnce(new Error('535 token rejected'));
    expect(await send()).toEqual({ success: false, error: '535 token rejected' });
    fetchMock.mockResolvedValueOnce(tokenRes('MS-AT-2'));
    sendMail.mockResolvedValueOnce({ messageId: '<ms4@cov>' });
    await send();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastTransportOpts().auth.accessToken).toBe('MS-AT-2');
  });

  it('client-credentials flow on the common tenant when there is no refresh token; rotated tokens are not persisted', async () => {
    await useEmail({ authType: 'oauth2', oauth2Provider: 'microsoft', clientId: 'cid', clientSecret: 'cs' });
    fetchMock.mockResolvedValueOnce(tokenRes('CC-AT'));
    sendMail.mockResolvedValueOnce({ messageId: '<ms5@cov>' });
    await send();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
    const p = new URLSearchParams(init.body);
    expect(p.get('grant_type')).toBe('client_credentials');
    expect(p.get('scope')).toBe('https://outlook.office365.com/.default');
    const v = (await prisma.systemConfig.findUnique({ where: { configKey: 'notification-email' } }))!.configValue as any;
    expect(v.accessToken).toBeUndefined();
  });

  it('a token-endpoint error fails the send with the provider text', async () => {
    await useEmail({ authType: 'oauth2', oauth2Provider: 'microsoft', clientId: 'cid', clientSecret: 'bad' });
    fetchMock.mockResolvedValueOnce(new Response('AADSTS7000215: Invalid client secret', { status: 401 }));
    expect(await send()).toEqual({ success: false, error: 'Microsoft OAuth2 token error: AADSTS7000215: Invalid client secret' });
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('OAuth2 — Google and custom providers', () => {
  it('Google refresh-token flow', async () => {
    await useEmail({ authType: 'oauth2', oauth2Provider: 'google', clientId: 'gid', clientSecret: 'gs', refreshToken: 'G-RT' });
    fetchMock.mockResolvedValueOnce(tokenRes('G-AT'));
    sendMail.mockResolvedValueOnce({ messageId: '<g1@cov>' });
    expect((await send()).success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      client_id: 'gid', client_secret: 'gs', refresh_token: 'G-RT', grant_type: 'refresh_token',
    });
    expect(lastTransportOpts().auth.accessToken).toBe('G-AT');
  });

  it('Google token error', async () => {
    await useEmail({ authType: 'oauth2', oauth2Provider: 'google', clientId: 'gid', clientSecret: 'gs', refreshToken: 'revoked' });
    fetchMock.mockResolvedValueOnce(new Response('invalid_grant', { status: 400 }));
    expect(await send()).toEqual({ success: false, error: 'Google OAuth2 token error: invalid_grant' });
  });

  it('custom provider posts client credentials (+ scope) to the configured token URL', async () => {
    await useEmail({
      authType: 'oauth2', oauth2Provider: 'custom', clientId: 'xid', clientSecret: 'xs',
      tokenUrl: 'https://idp.cov.test/oauth/token', scope: 'smtp.send',
    });
    fetchMock.mockResolvedValueOnce(tokenRes('X-AT'));
    sendMail.mockResolvedValueOnce({ messageId: '<x1@cov>' });
    expect((await send()).success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://idp.cov.test/oauth/token');
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      client_id: 'xid', client_secret: 'xs', grant_type: 'client_credentials', scope: 'smtp.send',
    });
  });

  it('custom provider without a scope omits it; a token error is reported', async () => {
    await useEmail({ authType: 'oauth2', oauth2Provider: 'custom', clientId: 'xid', clientSecret: 'xs', tokenUrl: 'https://idp.cov.test/t' });
    fetchMock.mockResolvedValueOnce(new Response('denied', { status: 403 }));
    expect(await send()).toEqual({ success: false, error: 'OAuth2 token error: denied' });
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).has('scope')).toBe(false);
  });

  it('custom provider with no token URL fails without any request', async () => {
    await useEmail({ authType: 'oauth2', oauth2Provider: 'custom', clientId: 'xid', clientSecret: 'xs' });
    expect(await send()).toEqual({ success: false, error: 'OAuth2 token URL not configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an admin-typed token URL that resolves to loopback is blocked by the SSRF guard (SAST-01)', async () => {
    await useEmail({ authType: 'oauth2', oauth2Provider: 'custom', clientId: 'xid', clientSecret: 'xs', tokenUrl: 'https://internal-idp.cov.test/t' });
    const r = await send();
    expect(r.success).toBe(false);
    expect(r.error).toBe('Blocked outbound request: Destination address not allowed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('testConnection fetches the OAuth2 token first, then verifies SMTP', async () => {
    await useEmail({ authType: 'oauth2', oauth2Provider: 'google', clientId: 'gid', clientSecret: 'gs', refreshToken: 'G-RT' });
    // a fresh Response per call: a body can only be read once
    fetchMock.mockImplementation(async () => tokenRes('G-AT-T'));
    verify.mockResolvedValueOnce(true);
    expect(await emailChannel.testConnection()).toEqual({ success: true, messageId: 'connection-verified' });
    expect(fetchMock).toHaveBeenCalled();
    expect(lastTransportOpts().auth.accessToken).toBe('G-AT-T');
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 400 }));
    expect(await emailChannel.testConnection()).toEqual({ success: false, error: 'Google OAuth2 token error: nope' });
  });
});
