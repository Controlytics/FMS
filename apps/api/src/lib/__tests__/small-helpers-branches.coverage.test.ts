/**
 * Edge cases of small pure lib/ helpers whose main paths are tested elsewhere:
 * server-id (DER parsing), rate-limit-key (IPv6 /64 bucketing), password-expiry
 * (anchor selection), config-settings-validate (each setting type), sanitize,
 * offline-time-window (default clock), date-range-guard (the Fastify hook) and
 * hash-chain (env-derived keyed-era anchor). Each assertion is the value a
 * caller gets back.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { authorityKeyIdFromDer, serverIdFromCertPem } from '../server-id.js';
import { rateLimitBucket, rateLimitKeyGenerator } from '../rate-limit-key.js';
import { isPasswordExpired, daysUntilPasswordExpiry } from '../password-expiry.js';
import { validateAgainstSettings } from '../config-settings-validate.js';
import type { SettingDefinition } from '../config-registry.js';
import { sanitizeStrings } from '../sanitize.js';
import { validateOfflinePerformedAt } from '../offline-time-window.js';
import { dateRangeGuard } from '../date-range-guard.js';
import { getAuditChainKeyedFrom, __setAuditChainKeyedFromForTest, getAuditChainKey, __setAuditChainKeyForTest } from '../hash-chain.js';

const OID = [0x06, 0x03, 0x55, 0x1d, 0x23];
const der = (...bytes: number[]) => Buffer.from(bytes);

describe('authorityKeyIdFromDer', () => {
  const keyId = [0xde, 0xad, 0xbe, 0xef];
  // OCTET STRING { SEQUENCE { [0] keyId } }
  const ext = (inner: number[]) => [0x04, inner.length, ...inner];
  const seq = (inner: number[]) => [0x30, inner.length, ...inner];
  const kid = [0x80, keyId.length, ...keyId];

  it('reads the key id, skipping a critical flag', () => {
    expect(authorityKeyIdFromDer(der(0x30, 0x00, ...OID, ...ext(seq(kid))))).toBe('deadbeef');
    expect(authorityKeyIdFromDer(der(...OID, 0x01, 0x01, 0xff, ...ext(seq(kid))))).toBe('deadbeef');
  });

  it('reads long-form DER lengths', () => {
    const inner = seq(kid);
    expect(authorityKeyIdFromDer(der(...OID, 0x04, 0x81, inner.length, ...inner))).toBe('deadbeef');
    expect(authorityKeyIdFromDer(der(...OID, 0x04, 0x82, 0x00, inner.length, ...inner))).toBe('deadbeef');
  });

  it('refuses indefinite or over-long length encodings', () => {
    expect(() => authorityKeyIdFromDer(der(...OID, 0x04, 0x80, 0x30))).toThrow('unsupported DER length');
    expect(() => authorityKeyIdFromDer(der(...OID, 0x04, 0x85, 1, 1, 1, 1, 1))).toThrow('unsupported DER length');
  });

  it.each([
    ['no AKI extension at all', der(0x30, 0x03, 0x02, 0x01, 0x00)],
    ['extension value is not an OCTET STRING', der(...OID, 0x05, 0x00)],
    ['the AKI is not a SEQUENCE', der(...OID, ...ext([0x31, 0x00]))],
    ['the AKI carries only issuer/serial (no [0] keyIdentifier)', der(...OID, ...ext(seq([0x81, 0x01, 0x00])))],
    ['a zero-length key id', der(...OID, ...ext(seq([0x80, 0x00])))],
    ['a key id longer than the buffer', der(...OID, 0x04, 0x05, 0x30, 0x03, 0x80, 0x20, 0x01)],
  ])('returns null when %s', (_label, buf) => {
    expect(authorityKeyIdFromDer(buf)).toBeNull();
  });

  it('has no server id without a certificate', () => {
    expect(serverIdFromCertPem(null)).toBeNull();
    expect(serverIdFromCertPem(undefined)).toBeNull();
    expect(serverIdFromCertPem('')).toBeNull();
  });
});

describe('rateLimitBucket', () => {
  it.each([
    [undefined, 'unknown'], [null, 'unknown'], ['', 'unknown'], ['   ', 'unknown'],
    [' 10.1.2.3 ', '10.1.2.3'],
    ['::ffff:10.1.2.3', '10.1.2.3'],
    ['::FFFF:192.168.0.9', '192.168.0.9'],
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:0db8:0001:0002:0000:0000:0000:0001', '2001:db8:1:2::/64'],
    ['2001:db8:1:2::5', '2001:db8:1:2::/64'],
    ['::1', '0:0:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['1:2:3:4:5:6:7::', '1:2:3:4::/64'],
    ['::1.2.3.4', '::1.2.3.4'],          // IPv4-compatible tail: refused by expandIPv6, bucketed as-is
    ['not-an-ip', 'not-an-ip'],
  ])('%j -> %j', (ip, bucket) => {
    expect(rateLimitBucket(ip as any)).toBe(bucket);
  });

  it('two hosts in one /64 share a bucket; different /64s do not', () => {
    expect(rateLimitKeyGenerator({ ip: '2001:db8:1:2::a' })).toBe(rateLimitKeyGenerator({ ip: '2001:db8:1:2:ffff::b' }));
    expect(rateLimitKeyGenerator({ ip: '2001:db8:1:2::a' })).not.toBe(rateLimitKeyGenerator({ ip: '2001:db8:1:3::a' }));
    expect(rateLimitKeyGenerator({})).toBe('unknown');
  });
});

describe('password expiry anchor', () => {
  const DAY = 86_400_000;
  const ago = (d: number) => new Date(Date.now() - d * DAY);

  it('is never expired when expiry is off', () => {
    for (const days of [0, -5, null, undefined]) {
      expect(isPasswordExpired(ago(500), ago(500), days as any, null)).toBe(false);
      expect(daysUntilPasswordExpiry(ago(500), ago(500), days as any, null)).toBeNull();
    }
  });

  it('falls back to the account creation date when the password was never changed', () => {
    expect(isPasswordExpired(null, ago(100), 90, null)).toBe(true);
    expect(isPasswordExpired(null, ago(10), 90, null)).toBe(false);
    expect(daysUntilPasswordExpiry(null, ago(10), 90, null)).toBe(80);
  });

  it('uses a later policy save as a grace floor, but never an earlier one', () => {
    expect(isPasswordExpired(ago(100), ago(400), 90, ago(5))).toBe(false);
    expect(daysUntilPasswordExpiry(ago(100), ago(400), 90, ago(5))).toBe(85);
    expect(isPasswordExpired(ago(100), ago(400), 90, ago(300))).toBe(true);
  });

  it('has no anchor (and so never expires) for a row without dates', () => {
    expect(isPasswordExpired(null, null as any, 90, null)).toBe(false);
    expect(daysUntilPasswordExpiry(null, null as any, 90, null)).toBeNull();
  });
});

describe('validateAgainstSettings', () => {
  const S = (s: Partial<SettingDefinition> & { key: string; type: SettingDefinition['type'] }): SettingDefinition => ({ label: '', ...s } as SettingDefinition);

  it('accepts no settings, and ignores unknown or json-typed keys', () => {
    expect(validateAgainstSettings(undefined, { a: 1 })).toEqual([]);
    expect(validateAgainstSettings([S({ key: 'blob', type: 'json' })], { blob: { anything: [1, 2] } })).toEqual([]);
    expect(validateAgainstSettings([S({ key: 'odd', type: 'weird' as any })], { odd: { x: 1 } })).toEqual([]);
  });

  it('names a field by its key when it has no label', () => {
    expect(validateAgainstSettings([S({ key: 'retries', type: 'number' })], { retries: Number.NaN })).toEqual(['retries must be a number']);
    expect(validateAgainstSettings([S({ key: 'retries', type: 'number' })], { retries: Number.POSITIVE_INFINITY })).toEqual(['retries must be a number']);
  });

  it('checks number bounds on both sides', () => {
    const def = [S({ key: 'n', label: 'Count', type: 'number', min: 2, max: 4 })];
    expect(validateAgainstSettings(def, { n: 1 })).toEqual(['Count must be at least 2']);
    expect(validateAgainstSettings(def, { n: 5 })).toEqual(['Count must be at most 4']);
    expect(validateAgainstSettings(def, { n: 3 })).toEqual([]);
  });

  it('select: one scalar value from the static options; live-data and option-less selects accept any value', () => {
    const opts = [{ value: 'A', label: 'A' }, { value: 2, label: 'Two' }];
    const def = [S({ key: 'mode', label: 'Mode', type: 'select', options: opts })];
    expect(validateAgainstSettings(def, { mode: { v: 'A' } })).toEqual(['Mode must be a single value']);
    expect(validateAgainstSettings(def, { mode: 'B' })).toEqual(['Mode must be one of: A, 2']);
    expect(validateAgainstSettings(def, { mode: 2 })).toEqual([]);
    expect(validateAgainstSettings([S({ key: 'r', type: 'select', options: opts, dynamicOptionsSource: '/api/roles' })], { r: 'ANY' })).toEqual([]);
    expect(validateAgainstSettings([S({ key: 'r', type: 'select', options: [] })], { r: 'ANY' })).toEqual([]);
  });

  it('multiselect: a list (or legacy single string) of allowed values', () => {
    const def = [S({ key: 'roles', label: 'Roles', type: 'multiselect', options: [{ value: 'QA', label: 'QA' }, { value: 'ADMIN', label: 'Admin' }] })];
    expect(validateAgainstSettings(def, { roles: ['QA', 'NOPE', 'ALSO'] })).toEqual(['Roles contains values that are not allowed: NOPE, ALSO']);
    expect(validateAgainstSettings(def, { roles: 'NOPE' })).toEqual(['Roles contains values that are not allowed: NOPE']);
    expect(validateAgainstSettings(def, { roles: '   ' })).toEqual([]);
    expect(validateAgainstSettings(def, { roles: ['QA', { x: 1 }] })).toEqual(['Roles must be a list of values']);
    expect(validateAgainstSettings(def, { roles: 7 })).toEqual(['Roles must be a list of values']);
    expect(validateAgainstSettings([S({ key: 'free', type: 'multiselect' })], { free: ['x', 2] })).toEqual([]);
  });

  it('text types: length bounds, and a masked secret is left alone', () => {
    const def = [S({ key: 'k', label: 'Key', type: 'secret', minLength: 4, maxLength: 6 })];
    expect(validateAgainstSettings(def, { k: 'abc' })).toEqual(['Key must be at least 4 characters']);
    expect(validateAgainstSettings(def, { k: 'abcdefg' })).toEqual(['Key must be at most 6 characters']);
    expect(validateAgainstSettings(def, { k: '••••••••' })).toEqual([]);
    expect(validateAgainstSettings([S({ key: 'u', label: 'URL', type: 'url' })], { u: 42 })).toEqual(['URL must be text']);
  });
});

describe('small edge cases', () => {
  it('sanitizeStrings keeps non-text array items as they are', () => {
    expect(sanitizeStrings({ list: ['<b>x</b>', 5, null, { n: '<i>y</i>' }] }))
      .toEqual({ list: ['&lt;b&gt;x&lt;/b&gt;', 5, null, { n: '&lt;i&gt;y&lt;/i&gt;' }] });
  });

  it('validateOfflinePerformedAt measures against the real clock when no "now" is given', () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    expect(validateOfflinePerformedAt(recent, { isReplay: true })?.toISOString()).toBe(recent);
    expect(() => validateOfflinePerformedAt(new Date(Date.now() + 86_400_000).toISOString(), { isReplay: true }))
      .toThrow(expect.objectContaining({ code: 'OFFLINE_TIME_FUTURE' }));
  });

  it('dateRangeGuard answers 400 INVALID_DATE_RANGE for an inverted range and lets a valid one through', async () => {
    const app = Fastify({ logger: false });
    app.addHook('preHandler', dateRangeGuard);
    app.get('/r', async () => ({ ok: true }));
    await app.ready();
    const bad = await app.inject({ method: 'GET', url: '/r?from=2026-05-02&to=2026-05-01' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'INVALID_DATE_RANGE', details: { startKey: 'from', endKey: 'to', start: '2026-05-02', end: '2026-05-01' } });
    expect((await app.inject({ method: 'GET', url: '/r?from=2026-05-01&to=2026-05-01' })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'GET', url: '/r' })).json()).toEqual({ ok: true });
    await app.close();
  });
});

describe('hash-chain env anchors', () => {
  const saved = { from: process.env.AUDIT_CHAIN_KEYED_FROM, key: process.env.AUDIT_CHAIN_KEY };
  afterEach(() => {
    if (saved.from === undefined) delete process.env.AUDIT_CHAIN_KEYED_FROM; else process.env.AUDIT_CHAIN_KEYED_FROM = saved.from;
    if (saved.key === undefined) delete process.env.AUDIT_CHAIN_KEY; else process.env.AUDIT_CHAIN_KEY = saved.key;
    __setAuditChainKeyedFromForTest(undefined);
    __setAuditChainKeyForTest(undefined);
  });

  it.each([
    ['', null], ['   ', null], ['abc', null], ['-3', null], ['120', 120], ['120.9', 120], ['0', 0],
  ])('AUDIT_CHAIN_KEYED_FROM=%j -> %j', (raw, expected) => {
    process.env.AUDIT_CHAIN_KEYED_FROM = raw;
    __setAuditChainKeyedFromForTest(undefined);
    expect(getAuditChainKeyedFrom()).toBe(expected);
  });

  it('is null when AUDIT_CHAIN_KEYED_FROM is unset, and a blank AUDIT_CHAIN_KEY means "no key"', () => {
    delete process.env.AUDIT_CHAIN_KEYED_FROM;
    __setAuditChainKeyedFromForTest(undefined);
    expect(getAuditChainKeyedFrom()).toBeNull();
    process.env.AUDIT_CHAIN_KEY = '   ';
    __setAuditChainKeyForTest(undefined);
    expect(getAuditChainKey()).toBeNull();
    process.env.AUDIT_CHAIN_KEY = '  k3y  ';
    __setAuditChainKeyForTest(undefined);
    expect(getAuditChainKey()).toBe('k3y');
  });
});
