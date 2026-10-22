/**
 * delivery.service + config-loader + template-engine against digilog_test_db
 * (coverage campaign 2026-10-21).
 *
 * Boundaries mocked: nodemailer (SMTP) and global fetch (the Twilio REST call).
 * Everything else is real: the notification_logs rows, the config rows the
 * channels read, the retry state machine.
 *
 * Retries run on setTimeout. Only setTimeout/clearTimeout are faked, and only
 * inside the retry tests — Date and setImmediate stay real so Prisma and the
 * DB polling keep working. A pending retry is dropped by clearAllTimers() so it
 * can never fire later in the shared fork.
 *
 * notification-email / notification-sms are snapshotted and restored. Every
 * row this file writes carries a unique recipient marker and is deleted.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import {
  sendNotification, testChannel, sendTestNotification,
} from '../delivery.service.js';
import { getEmailConfig, getSmsConfig, invalidateNotificationConfigCache } from '../config-loader.js';
import { resolveTemplate } from '../template-engine.js';
import { emailChannel } from '../channels/email-channel.js';
import { smsChannel } from '../channels/sms-channel.js';
import { uniq, snapshotConfig, restoreConfig, setConfig, waitFor, type ConfigSnapshot } from './cov-fixtures.js';

const { sendMail, verify, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn();
  const verify = vi.fn();
  const createTransport = vi.fn(() => ({ sendMail, verify }));
  return { sendMail, verify, createTransport };
});
vi.mock('nodemailer', () => ({ default: { createTransport } }));

const TAG = uniq();
const mailbox = (n: string) => `cov-dlv-${n}-${TAG}@cov.test`;
let emailSnap: ConfigSnapshot;
let smsSnap: ConfigSnapshot;
const fetchMock = vi.fn();

const EMAIL_CFG = {
  // A TEST-NET-1 address (RFC 5737, never routed): if another process sends
  // while this config is live, it reaches no server. Not loopback: since SEC-08
  // (2026-10-22) a loopback SMTP host is refused before any transport is built,
  // which would stop this file's own (mocked) sends as well.
  host: '192.0.2.1', port: 1, secure: false, enabled: true, authType: 'basic',
  username: 'cov', password: 'cov-pw', fromEmail: 'noreply@cov.test', fromName: 'Cov Sender',
};

beforeAll(async () => {
  emailSnap = await snapshotConfig('notification-email');
  smsSnap = await snapshotConfig('notification-sms');
  await setConfig('notification-email', EMAIL_CFG);
  await setConfig('notification-sms', {
    provider: 'twilio', enabled: true, defaultCountryCode: '+91',
    twilioAccountSid: 'ACcov', twilioAuthToken: 'tok', twilioFromNumber: '+15550000000',
  });
  invalidateNotificationConfigCache();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  sendMail.mockReset();
  verify.mockReset();
  fetchMock.mockReset();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await restoreConfig(emailSnap);
  await restoreConfig(smsSnap);
  invalidateNotificationConfigCache();
  await prisma.notificationLog.deleteMany({ where: { recipient: { contains: TAG } } });
});

const rowFor = (recipient: string) => prisma.notificationLog.findFirst({ where: { recipient }, orderBy: { createdAt: 'desc' } });

describe('resolveTemplate', () => {
  it('html mode: substitutes ${var} (trimmed), HTML-escapes the value, leaves unknown placeholders alone', () => {
    expect(resolveTemplate('Hi ${ name }, ${missing} — ${x}', { name: '<b>"A&B"</b> it\'s', x: '1' }, 'html'))
      .toBe('Hi &lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt; it&#39;s, ${missing} — 1');
  });

  // D7 (2026-10-21): values were HTML-escaped for EVERY channel, so SMS bodies,
  // in-app messages and e-mail Subject lines showed `&amp;` / `&quot;` / `&lt;`.
  it('text mode: substitutes the value exactly as given', () => {
    expect(resolveTemplate('Locked: ${reason} (${ who })', { reason: 'Too many "failed" attempts & <lockout>', who: "o'brien" }, 'text'))
      .toBe('Locked: Too many "failed" attempts & <lockout> (o\'brien)');
  });
});

describe('config-loader', () => {
  it('caches each config for 30 s and invalidateNotificationConfigCache() drops it', async () => {
    invalidateNotificationConfigCache();
    expect((await getEmailConfig())!.host).toBe('192.0.2.1');
    await setConfig('notification-email', { ...EMAIL_CFG, host: '192.0.2.2' });
    // still served from the cache
    expect((await getEmailConfig())!.host).toBe('192.0.2.1');
    // TTL expiry without an explicit invalidation
    const realNow = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(realNow + 31_000);
    try {
      expect((await getEmailConfig())!.host).toBe('192.0.2.2');
    } finally {
      spy.mockRestore();
    }
    await setConfig('notification-email', EMAIL_CFG);
    invalidateNotificationConfigCache();
    expect((await getEmailConfig())!.host).toBe('192.0.2.1');
    expect((await getSmsConfig())!.provider).toBe('twilio');
  });

  it('returns no config when the row does not exist', async () => {
    const snap = await snapshotConfig('notification-sms');
    try {
      await prisma.systemConfig.delete({ where: { configKey: 'notification-sms' } });
      invalidateNotificationConfigCache();
      // Typed `| null`, returns undefined today; callers only test `!config`.
      expect((await getSmsConfig()) ?? null).toBeNull();
      expect(await testChannel('SMS')).toEqual({ success: false, error: 'SMS notifications are not enabled' });
    } finally {
      await restoreConfig(snap);
      invalidateNotificationConfigCache();
    }
  });
});

describe('sendNotification', () => {
  it('answers an unknown channel without writing a log row', async () => {
    const r = await sendNotification({ channel: 'FAX' as any, recipient: mailbox('fax'), message: 'x' });
    expect(r).toEqual({ success: false, error: 'Unknown channel: FAX' });
    expect(await rowFor(mailbox('fax'))).toBeNull();
  });

  it('resolves variables into message AND subject, logs PENDING→SENT and keeps metadata + messageId', async () => {
    sendMail.mockResolvedValueOnce({ messageId: '<m1@cov>' });
    const to = mailbox('ok');
    const r = await sendNotification({
      channel: 'EMAIL', recipient: to, subject: 'Alert ${who}', message: 'Hello ${who}, value ${v}',
      variables: { who: 'Ann <script>', v: '42' }, templateId: 'tpl-cov', triggeredBy: 'manual', metadata: { origin: 'cov' },
    });
    expect(r).toEqual({ success: true, messageId: '<m1@cov>' });
    const row = await rowFor(to);
    // D7: the e-mail BODY is HTML, so its values are escaped; the Subject is a
    // plain-text header, so its values are not.
    expect(row).toMatchObject({
      status: 'SENT', subject: 'Alert Ann <script>', message: 'Hello Ann &lt;script&gt;, value 42',
      templateId: 'tpl-cov', triggeredBy: 'manual', maxRetries: 3, retryCount: 0,
    });
    expect(row!.sentAt).toBeInstanceOf(Date);
    expect(row!.metadata).toEqual({ origin: 'cov', messageId: '<m1@cov>' });
    // the RESOLVED text is what reached SMTP; the subject is escaped only where it is embedded in HTML
    const mail = sendMail.mock.calls[0][0];
    expect(mail).toMatchObject({ to, subject: 'Alert Ann <script>', text: 'Hello Ann <script>, value 42' });
    expect(mail.html).toContain('<title>Alert Ann &lt;script&gt;</title>');
  });

  it('an SMS with variables carries them as plain text (D7)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ sid: 'SMplain' }), { status: 201 }));
    const marker = mailbox('sms-plain');
    await sendNotification({ channel: 'SMS', recipient: '+919876543210', message: 'Tank ${t} offline', variables: { t: 'A&B "north"' }, metadata: { marker } });
    const row = await prisma.notificationLog.findFirst({ where: { metadata: { path: ['marker'], equals: marker } } });
    expect(row!.message).toBe('Tank A&B "north" offline');
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1].body)).get('Body')).toBe('Tank A&B "north" offline');
    await prisma.notificationLog.deleteMany({ where: { id: row!.id } });
  });

  it('with variables but no subject, leaves the subject unset', async () => {
    sendMail.mockResolvedValueOnce({ messageId: '<m2@cov>' });
    const to = mailbox('nosubj');
    await sendNotification({ channel: 'EMAIL', recipient: to, message: 'x ${a}', variables: { a: 'b' } });
    const row = await rowFor(to);
    expect(row!.subject).toBeNull();
    expect(row!.message).toBe('x b');
    expect(row!.metadata).toEqual({ messageId: '<m2@cov>' });
  });

  it('a failed send is logged RETRYING (attempt 1, next in 5 s) and the caller gets the failure', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // An SMTP reply: the channel reports its code, never the raw text (SEC-08, 2026-10-22).
    sendMail.mockRejectedValueOnce(Object.assign(new Error('421 4.7.0 try later'), { responseCode: 421 }));
    const to = mailbox('fail1');
    const before = Date.now();
    const r = await sendNotification({ channel: 'EMAIL', recipient: to, subject: 's', message: 'm' });
    expect(r).toEqual({ success: false, error: 'The SMTP server rejected the request (response code 421).' });
    const row = await rowFor(to);
    expect(row).toMatchObject({ status: 'RETRYING', retryCount: 1, errorMessage: 'The SMTP server rejected the request (response code 421).' });
    const delta = row!.nextRetryAt!.getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(4_900);
    expect(delta).toBeLessThan(6_000);
  });

  it('retries on the 5 s / 15 s backoff and is FAILED after the third failed attempt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    sendMail
      .mockRejectedValueOnce(Object.assign(new Error('attempt 1'), { responseCode: 421 }))
      .mockRejectedValueOnce(Object.assign(new Error('attempt 2'), { responseCode: 451 }))
      .mockRejectedValueOnce(Object.assign(new Error('attempt 3'), { responseCode: 452 }));
    const to = mailbox('fail3');
    await sendNotification({ channel: 'EMAIL', recipient: to, subject: 's', message: 'm' });
    expect(sendMail).toHaveBeenCalledTimes(1);

    // attempt 2 fires at +5 s, not before
    await waitFor(async () => vi.getTimerCount() > 0);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(sendMail).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const r2 = await waitFor(async () => {
      const row = await rowFor(to);
      return row?.retryCount === 2 ? row : null;
    });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(r2).toMatchObject({ status: 'RETRYING', errorMessage: 'The SMTP server rejected the request (response code 451).' });
    // the row promises the wait the code will actually take (C-11): 15 s
    const promised = r2.nextRetryAt!.getTime() - r2.updatedAt.getTime();
    expect(promised).toBeGreaterThanOrEqual(14_900);
    expect(promised).toBeLessThan(16_000);

    // attempt 3 fires at +15 s
    await waitFor(async () => vi.getTimerCount() > 0);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(sendMail).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    const r3 = await waitFor(async () => {
      const row = await rowFor(to);
      return row?.status === 'FAILED' ? row : null;
    });
    expect(sendMail).toHaveBeenCalledTimes(3);
    expect(r3).toMatchObject({ retryCount: 3, errorMessage: 'The SMTP server rejected the request (response code 452).', nextRetryAt: null });
    expect(vi.getTimerCount()).toBe(0); // nothing further scheduled
  });

  it('a retry that succeeds marks the row SENT and clears the error and next-retry time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    sendMail.mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce({ messageId: '<retry-ok@cov>' });
    const to = mailbox('recover');
    await sendNotification({ channel: 'EMAIL', recipient: to, message: 'm', metadata: { k: 'v' } });
    await waitFor(async () => vi.getTimerCount() > 0);
    await vi.advanceTimersByTimeAsync(5_000);
    const row = await waitFor(async () => {
      const r = await rowFor(to);
      return r?.status === 'SENT' ? r : null;
    });
    expect(row).toMatchObject({ errorMessage: null, nextRetryAt: null, retryCount: 1 });
    expect(row.metadata).toEqual({ k: 'v', messageId: '<retry-ok@cov>' });
    expect(row.sentAt).toBeInstanceOf(Date);
  });

  // D3 (2026-10-21): an SMS provider call that THREW (network error, SSRF block,
  // non-JSON reply) escaped sendNotification: the caller got an exception, the
  // log row stayed PENDING forever and no retry was scheduled.
  it.each([
    ['a network error', 'net', () => fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')), /^SMS request failed \(twilio\): fetch failed$/],
    ['a non-JSON 502 page', 'html502', () => fetchMock.mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 })), /^SMS request failed \(twilio\): Unexpected token/],
  ])('an SMS provider call that throws (%s) is a failed send, never an exception', async (_l, key, arrange, error) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    arrange();
    const marker = mailbox(`sms-throw-${key}`);
    const r = await sendNotification({ channel: 'SMS', recipient: '+919876543210', message: 'm', metadata: { marker } });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(error);
    const row = await prisma.notificationLog.findFirst({ where: { metadata: { path: ['marker'], equals: marker } } });
    expect(row).toMatchObject({ status: 'RETRYING', retryCount: 1 });
    expect(row!.errorMessage).toBe(r.error);
    expect(vi.getTimerCount()).toBeGreaterThan(0); // a retry is scheduled
    await prisma.notificationLog.deleteMany({ where: { id: row!.id } });
  });

  it('an SMS that throws on every attempt ends FAILED after three attempts, never stuck', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const marker = mailbox('sms-throw-all');
    await sendNotification({ channel: 'SMS', recipient: '+919876543210', message: 'm', metadata: { marker } });
    for (const delay of [5_000, 15_000]) {
      await waitFor(async () => vi.getTimerCount() > 0);
      await vi.advanceTimersByTimeAsync(delay);
    }
    const row = await waitFor(async () => {
      const r = await prisma.notificationLog.findFirst({ where: { metadata: { path: ['marker'], equals: marker } } });
      return r?.status === 'FAILED' ? r : null;
    });
    expect(row).toMatchObject({ retryCount: 3, nextRetryAt: null, errorMessage: 'SMS request failed (twilio): fetch failed' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await prisma.notificationLog.deleteMany({ where: { id: row.id } });
  });

  // A channel throws outside its own try/catch when its configuration cannot even
  // be loaded (the database is unreachable). The channel objects are plain
  // objects, so the throw is injected there — never by spying on a Prisma model
  // delegate, which is a proxy that vi.spyOn cannot pass through or restore.
  const dbDown = () => new Error("Invalid `prisma.systemConfig.findUnique()` invocation in C:/app/src/x.ts:23 Can't reach database server");

  it('a channel that throws (its configuration cannot be loaded) fails the send cleanly; the raw DB error stays server-side', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const spy = vi.spyOn(emailChannel, 'send').mockRejectedValueOnce(dbDown());
    try {
      const to = mailbox('cfg-down');
      const r = await sendNotification({ channel: 'EMAIL', recipient: to, subject: 's', message: 'm' });
      expect(r).toEqual({ success: false, error: 'Delivery failed because of an internal error. The details are in the server log.' });
      expect(await rowFor(to)).toMatchObject({ status: 'RETRYING', retryCount: 1, errorMessage: r.error });
      expect(vi.getTimerCount()).toBeGreaterThan(0); // retried like any other failure
    } finally {
      spy.mockRestore();
    }
  });

  it('testChannel answers a channel that throws with a generic failure, not an exception', async () => {
    const spy = vi.spyOn(smsChannel, 'testConnection').mockRejectedValueOnce(dbDown());
    try {
      expect(await testChannel('SMS')).toEqual({ success: false, error: 'Delivery failed because of an internal error. The details are in the server log.' });
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    ['the first retry', 1],
    ['the second retry', 2],
  ])('a channel that THROWS on %s never becomes an unhandled rejection', async (_l, gracefulFailures) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const unhandled: unknown[] = [];
    const onUnhandled = (r: unknown) => unhandled.push(r);
    process.on('unhandledRejection', onUnhandled);
    try {
      for (let i = 0; i < gracefulFailures; i++) {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: `refused ${i}` }), { status: 400 }));
      }
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      const marker = mailbox(`throw${gracefulFailures}`);
      const r = await sendNotification({ channel: 'SMS', recipient: '+919876543210', message: 'm', metadata: { marker } });
      expect(r).toEqual({ success: false, error: 'refused 0' });
      for (const delay of [5_000, 15_000].slice(0, gracefulFailures)) {
        await waitFor(async () => vi.getTimerCount() > 0);
        await vi.advanceTimersByTimeAsync(delay);
      }
      await waitFor(async () => fetchMock.mock.calls.length === gracefulFailures + 1);
      for (let i = 0; i < 20; i++) await new Promise((res) => setImmediate(res));
      expect(unhandled).toEqual([]);
      await prisma.notificationLog.deleteMany({ where: { metadata: { path: ['marker'], equals: marker } } });
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('SMS goes through the configured provider and is logged SENT', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ sid: 'SMcov' }), { status: 201 }));
    const to = `98765 43210`; // normalised by the channel; logged as given
    const marker = mailbox('sms');
    const r = await sendNotification({ channel: 'SMS', recipient: to, message: '<b>hi</b>', metadata: { marker } });
    expect(r).toEqual({ success: true, messageId: 'SMcov' });
    const row = await prisma.notificationLog.findFirst({ where: { metadata: { path: ['marker'], equals: marker } } });
    expect(row).toMatchObject({ channel: 'SMS', status: 'SENT', recipient: to });
    await prisma.notificationLog.deleteMany({ where: { id: row!.id } });
  });
});

describe('testChannel / sendTestNotification', () => {
  it('testChannel rejects an unknown channel and delegates EMAIL/SMS to the channel check', async () => {
    expect(await testChannel('PIGEON' as any)).toEqual({ success: false, error: 'Unknown channel: PIGEON' });
    verify.mockResolvedValueOnce(true);
    expect(await testChannel('EMAIL')).toEqual({ success: true, messageId: 'connection-verified' });
    expect(await testChannel('SMS')).toEqual({ success: true, messageId: 'config-validated' });
  });

  it('sendTestNotification sends an HTML email with a configured-time stamp, tagged manual + test', async () => {
    sendMail.mockResolvedValueOnce({ messageId: '<t@cov>' });
    const to = mailbox('test-email');
    const r = await sendTestNotification('EMAIL', to);
    expect(r.success).toBe(true);
    const row = await rowFor(to);
    expect(row).toMatchObject({ subject: 'DigiLog Test Notification', triggeredBy: 'manual', status: 'SENT' });
    expect(row!.message).toMatch(/^<p>This is a <strong>test notification<\/strong> from DigiLog\.<\/p>.*<p>Timestamp: .+<\/p>$/);
    expect(row!.metadata).toMatchObject({ test: true });
  });

  it('sendTestNotification sends a plain-text SMS', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ sid: 'SMtest' }), { status: 201 }));
    const phone = '+919000000001';
    const r = await sendTestNotification('SMS', phone);
    expect(r).toEqual({ success: true, messageId: 'SMtest' });
    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1].body));
    expect(body.get('Body')).toMatch(/^DigiLog Test: Your SMS notification is configured correctly\. Timestamp: .+/);
    await prisma.notificationLog.deleteMany({ where: { recipient: phone, triggeredBy: 'manual', status: 'SENT', message: { startsWith: 'DigiLog Test:' } } });
  });
});
