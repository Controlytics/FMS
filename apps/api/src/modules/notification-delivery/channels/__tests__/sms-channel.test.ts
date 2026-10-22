/**
 * smsChannel against the real notification-sms config row (coverage campaign
 * 2026-10-21). The two network boundaries are mocked:
 *   - global fetch  — Twilio / Vonage call it directly; the HTTP gateway reaches
 *     it through the REAL lib/ssrf.ts hardenedFetch;
 *   - node:dns/promises lookup — what hardenedFetch resolves the gateway host
 *     with, so the SSRF guard runs for real without network access.
 * notification-sms is snapshotted and restored.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { smsChannel } from '../sms-channel.js';
import { invalidateNotificationConfigCache } from '../../config-loader.js';
import { snapshotConfig, restoreConfig, setConfig, type ConfigSnapshot } from '../../__tests__/cov-fixtures.js';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup, default: { lookup } }));

const fetchMock = vi.fn();
let snap: ConfigSnapshot;

const HOSTS: Record<string, string> = {
  'gw.cov.test': '203.0.113.10',     // TEST-NET-3: public, allowed
  'lan-gw.cov.test': '192.168.50.5', // private LAN: allowed on purpose
  'meta.cov.test': '169.254.169.254', // cloud metadata: blocked
};

async function useSms(cfg: Record<string, unknown>) {
  await setConfig('notification-sms', { enabled: true, ...cfg });
  invalidateNotificationConfigCache();
}
const send = (recipient: string, message = 'hello') => smsChannel.send({ channel: 'SMS', recipient, message });
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  snap = await snapshotConfig('notification-sms');
  vi.stubGlobal('fetch', fetchMock);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await restoreConfig(snap);
  invalidateNotificationConfigCache();
});
beforeEach(() => {
  fetchMock.mockReset();
  lookup.mockReset();
  lookup.mockImplementation(async (host: string) => {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return [{ address: host, family: 4 }];
    const ip = HOSTS[host];
    if (!ip) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    return [{ address: ip, family: 4 }];
  });
});

describe('guards common to every provider', () => {
  it('refuses when SMS is disabled or unconfigured', async () => {
    await useSms({ enabled: false, provider: 'twilio' });
    expect(await send('+919876543210')).toEqual({ success: false, error: 'SMS notifications are not enabled' });
    expect(await smsChannel.testConnection()).toEqual({ success: false, error: 'SMS notifications are not enabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalises the number (strips spaces/dashes/parens, adds +91 by default) and rejects a non-E.164 result', async () => {
    await useSms({ provider: 'twilio', twilioAccountSid: 'AC1', twilioAuthToken: 't', twilioFromNumber: '+15550001111' });
    fetchMock.mockResolvedValueOnce(jsonRes({ sid: 'SM1' }, 201));
    expect(await send('(98765) 432-10')).toEqual({ success: true, messageId: 'SM1' });
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1].body)).get('To')).toBe('+919876543210');

    expect(await send('12')).toEqual({ success: false, error: 'Invalid phone number: 12' });
    expect(await send('+0123456789')).toEqual({ success: false, error: 'Invalid phone number: +0123456789' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the configured country code, with or without its leading +', async () => {
    for (const code of ['44', '+44']) {
      await useSms({ provider: 'twilio', twilioAccountSid: 'AC1', twilioAuthToken: 't', twilioFromNumber: '+15550001111', defaultCountryCode: code });
      fetchMock.mockResolvedValueOnce(jsonRes({ sid: 'SM' }, 201));
      await send('7700900123');
      expect(new URLSearchParams(String(fetchMock.mock.calls.at(-1)![1].body)).get('To')).toBe('+447700900123');
    }
  });

  // Operator decision 2026-10-22 ("Send exactly the text"): an SMS is plain text
  // (D7), so nothing shaped like a tag is removed. Stripping <...> cut readings
  // and names: "pressure < 2 bar (limit > 4)" lost everything between the signs.
  it('sends the text exactly as given, < and > included', async () => {
    await useSms({ provider: 'twilio', twilioAccountSid: 'AC1', twilioAuthToken: 't', twilioFromNumber: '+15550001111' });
    fetchMock.mockResolvedValueOnce(jsonRes({ sid: 'SM' }, 201));
    const text = 'Filter <A1>: pressure < 2 bar (limit > 4)';
    await send('+919876543210', text);
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1].body)).get('Body')).toBe(text);
  });

  it('caps the text at 1600 characters', async () => {
    await useSms({ provider: 'twilio', twilioAccountSid: 'AC1', twilioAuthToken: 't', twilioFromNumber: '+15550001111' });
    fetchMock.mockResolvedValueOnce(jsonRes({ sid: 'SM' }, 201));
    await send('+919876543210', 'x'.repeat(2000));
    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1].body)).get('Body')!;
    expect(body).toBe('x'.repeat(1600));
  });

  it('rejects an unknown provider', async () => {
    await useSms({ provider: 'carrier-pigeon' });
    expect(await send('+919876543210')).toEqual({ success: false, error: 'Unknown SMS provider: carrier-pigeon' });
  });
});

describe('Twilio', () => {
  it('posts form-encoded To/From/Body with Basic auth to the account Messages endpoint', async () => {
    await useSms({ provider: 'twilio', twilioAccountSid: 'ACabc', twilioAuthToken: 'secret', twilioFromNumber: '+15550001111' });
    fetchMock.mockResolvedValueOnce(jsonRes({ sid: 'SMok' }, 201));
    expect(await send('+919876543210', 'Pump 3 offline')).toEqual({ success: true, messageId: 'SMok' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACabc/Messages.json');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('ACabc:secret').toString('base64')}`);
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const p = new URLSearchParams(String(init.body));
    expect([p.get('To'), p.get('From'), p.get('Body')]).toEqual(['+919876543210', '+15550001111', 'Pump 3 offline']);
  });

  it('surfaces the provider message on a non-2xx, or the status when there is none', async () => {
    await useSms({ provider: 'twilio', twilioAccountSid: 'AC1', twilioAuthToken: 't', twilioFromNumber: '+15550001111' });
    fetchMock.mockResolvedValueOnce(jsonRes({ message: 'The To number is unverified' }, 400));
    expect(await send('+919876543210')).toEqual({ success: false, error: 'The To number is unverified' });
    fetchMock.mockResolvedValueOnce(jsonRes({}, 503));
    expect(await send('+919876543210')).toEqual({ success: false, error: 'Twilio error: 503' });
    fetchMock.mockResolvedValueOnce(jsonRes({}, 201)); // no sid
    expect(await send('+919876543210')).toEqual({ success: true, messageId: '' });
  });

  it('refuses to call out without credentials, and testConnection says which are missing', async () => {
    await useSms({ provider: 'twilio', twilioAccountSid: 'AC1' });
    expect(await send('+919876543210')).toEqual({ success: false, error: 'Twilio credentials not configured' });
    expect(await smsChannel.testConnection()).toEqual({ success: false, error: 'Twilio credentials missing' });
    expect(fetchMock).not.toHaveBeenCalled();
    await useSms({ provider: 'twilio', twilioAccountSid: 'AC1', twilioAuthToken: 't' });
    expect(await smsChannel.testConnection()).toEqual({ success: true, messageId: 'config-validated' });
  });
});

describe('Vonage', () => {
  it('posts JSON with the number minus its +, and the from-number', async () => {
    await useSms({ provider: 'vonage', vonageApiKey: 'k', vonageApiSecret: 's', vonageFromNumber: 'DIGI' });
    fetchMock.mockResolvedValueOnce(jsonRes({ messages: [{ status: '0', 'message-id': 'V1' }] }));
    expect(await send('+919876543210', 'hi')).toEqual({ success: true, messageId: 'V1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://rest.nexmo.com/sms/json');
    expect(JSON.parse(init.body)).toEqual({ api_key: 'k', api_secret: 's', to: '919876543210', from: 'DIGI', text: 'hi' });
  });

  it('falls back to senderId, then "DigiLog", for the from field', async () => {
    await useSms({ provider: 'vonage', vonageApiKey: 'k', vonageApiSecret: 's', senderId: 'SENDR' });
    fetchMock.mockResolvedValueOnce(jsonRes({ messages: [{ status: '0' }] }));
    expect(await send('+919876543210')).toEqual({ success: true, messageId: '' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).from).toBe('SENDR');
    await useSms({ provider: 'vonage', vonageApiKey: 'k', vonageApiSecret: 's' });
    fetchMock.mockResolvedValueOnce(jsonRes({ messages: [{ status: '0' }] }));
    await send('+919876543210');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).from).toBe('DigiLog');
  });

  it('treats any status other than "0" as a failure, with the provider error text', async () => {
    await useSms({ provider: 'vonage', vonageApiKey: 'k', vonageApiSecret: 's' });
    fetchMock.mockResolvedValueOnce(jsonRes({ messages: [{ status: '4', 'error-text': 'Bad Credentials' }] }));
    expect(await send('+919876543210')).toEqual({ success: false, error: 'Bad Credentials' });
    fetchMock.mockResolvedValueOnce(jsonRes({}));
    expect(await send('+919876543210')).toEqual({ success: false, error: 'Vonage send failed' });
  });

  it('refuses without credentials', async () => {
    await useSms({ provider: 'vonage', vonageApiKey: 'k' });
    expect(await send('+919876543210')).toEqual({ success: false, error: 'Vonage credentials not configured' });
    expect(await smsChannel.testConnection()).toEqual({ success: false, error: 'Vonage credentials missing' });
    await useSms({ provider: 'vonage', vonageApiKey: 'k', vonageApiSecret: 's' });
    expect(await smsChannel.testConnection()).toEqual({ success: true, messageId: 'config-validated' });
    expect(fetchMock).not.toHaveBeenCalled(); // testConnection only checks configuration
  });
});

describe('HTTP gateway (through the real SSRF guard)', () => {
  it('POST: fills {phone}/{message} in the body raw and in the URL encoded; sends the configured headers', async () => {
    await useSms({
      provider: 'http-gateway',
      httpGatewayUrl: 'https://gw.cov.test/send?to={phone}&text={message}',
      httpGatewayMethod: 'POST',
      httpGatewayHeaders: { Authorization: 'Bearer gw-key', 'Content-Type': 'application/json' },
      httpGatewayBodyTemplate: '{"to":"{phone}","msg":"{message}","again":"{phone}"}',
    });
    fetchMock.mockResolvedValueOnce(new Response('queued', { status: 200 }));
    const r = await send('+919876543210', 'A & B');
    expect(r.success).toBe(true);
    expect(r.messageId).toMatch(/^http-\d+$/);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://gw.cov.test/send?to=+919876543210&text=A%20%26%20B');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer gw-key', 'Content-Type': 'application/json' });
    expect(init.body).toBe('{"to":"+919876543210","msg":"A & B","again":"+919876543210"}');
    expect(init.redirect).toBe('error'); // hardenedFetch refuses redirects
    expect(lookup).toHaveBeenCalledWith('gw.cov.test', { all: true });
  });

  it('GET (and POST without a template) sends no body; default header is JSON content-type; LAN gateways are allowed', async () => {
    await useSms({ provider: 'http-gateway', httpGatewayUrl: 'http://lan-gw.cov.test/sms?p={phone}', httpGatewayMethod: 'GET' });
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    expect((await send('+919876543210')).success).toBe(true);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', headers: { 'Content-Type': 'application/json' } });
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();

    await useSms({ provider: 'http-gateway', httpGatewayUrl: 'https://gw.cov.test/x' }); // method defaults to POST
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    await send('+919876543210');
    expect(fetchMock.mock.calls[1][1].method).toBe('POST');
    expect(fetchMock.mock.calls[1][1].body).toBeUndefined();
  });

  it('a 2xx whose body fails the configured success regex is a failure; a match is a success', async () => {
    await useSms({ provider: 'http-gateway', httpGatewayUrl: 'https://gw.cov.test/x', httpGatewaySuccessRegex: '"status"\\s*:\\s*"success"' });
    fetchMock.mockResolvedValueOnce(new Response('{"status":"queued-but-not-really"}', { status: 200 }));
    const bad = await send('+919876543210');
    expect(bad.success).toBe(false);
    expect(bad.error).toMatch(/^HTTP Gateway 2xx but body did not match success pattern/);
    fetchMock.mockResolvedValueOnce(new Response('{"status": "success"}', { status: 200 }));
    expect((await send('+919876543210')).success).toBe(true);
  });

  it('without a regex, an unambiguous JSON failure body on a 2xx is still a failure', async () => {
    await useSms({ provider: 'http-gateway', httpGatewayUrl: 'https://gw.cov.test/x' });
    fetchMock.mockResolvedValueOnce(new Response('{"success":false,"message":"insufficient credit"}', { status: 200 }));
    expect(await send('+919876543210')).toEqual({ success: false, error: 'HTTP Gateway reported failure: insufficient credit' });
  });

  // D3 (2026-10-21): transport errors and unreadable replies used to escape send().
  it.each([
    ['http-gateway', { httpGatewayUrl: 'https://gw.cov.test/x' }, () => fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')), 'SMS request failed (http-gateway): fetch failed'],
    ['twilio', { twilioAccountSid: 'AC1', twilioAuthToken: 't', twilioFromNumber: '+15550001111' }, () => fetchMock.mockRejectedValueOnce(new Error('The operation was aborted due to timeout')), 'SMS request failed (twilio): The operation was aborted due to timeout'],
    ['vonage', { vonageApiKey: 'k', vonageApiSecret: 's' }, () => fetchMock.mockResolvedValueOnce(new Response('<html>502</html>', { status: 502 })), /^SMS request failed \(vonage\): Unexpected token/],
    // a rejection that is not an Error
    ['twilio', { twilioAccountSid: 'AC1', twilioAuthToken: 't', twilioFromNumber: '+15550001111' }, () => fetchMock.mockRejectedValueOnce('socket closed'), 'SMS request failed (twilio): socket closed'],
  ])('a %s call that throws is returned as a failed DeliveryResult', async (provider, cfg, arrange, error) => {
    await useSms({ provider, ...cfg });
    arrange();
    const r = await send('+919876543210');
    expect(r.success).toBe(false);
    if (typeof error === 'string') expect(r.error).toBe(error);
    else expect(r.error).toMatch(error);
  });

  it('a non-2xx is a failure carrying the status and the body', async () => {
    await useSms({ provider: 'http-gateway', httpGatewayUrl: 'https://gw.cov.test/x' });
    fetchMock.mockResolvedValueOnce(new Response('upstream down', { status: 502 }));
    expect(await send('+919876543210')).toEqual({ success: false, error: 'HTTP Gateway error (502): upstream down' });
  });

  it('is never called without a URL, and testConnection reports the missing URL', async () => {
    await useSms({ provider: 'http-gateway' });
    expect(await send('+919876543210')).toEqual({ success: false, error: 'HTTP Gateway URL not configured' });
    expect(await smsChannel.testConnection()).toEqual({ success: false, error: 'HTTP Gateway URL missing' });
    await useSms({ provider: 'http-gateway', httpGatewayUrl: 'https://gw.cov.test/x' });
    expect(await smsChannel.testConnection()).toEqual({ success: true, messageId: 'config-validated' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['loopback', 'http://127.0.0.1:8080/send'],
    ['cloud metadata via DNS', 'http://meta.cov.test/latest'],
    ['non-http scheme', 'file:///etc/passwd'],
  ])('the SSRF guard blocks a %s gateway before any request is made', async (_l, url) => {
    await useSms({ provider: 'http-gateway', httpGatewayUrl: url });
    // D3 (2026-10-21): the block is a failed DeliveryResult, never an exception.
    const r = await send('+919876543210');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/^SMS request failed \(http-gateway\): Blocked outbound request: /);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
