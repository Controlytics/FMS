/**
 * SEC-08 (security assessment 2026-10-22): the LDAP server URL is admin-typed,
 * and the server opened a socket to it with no destination check. An ADMIN
 * could point test-connection at loopback / link-local, and the raw error text
 * worked as a port scanner:
 *
 *   ldap://127.0.0.1:5432        → "read ECONNRESET"     (port open)
 *   ldap://127.0.0.1:1           → "connect ECONNREFUSED" (port closed)
 *   ldap://169.254.169.254:389   → "Connection timeout"   (filtered)
 *
 * Fixed: the host goes through lib/ssrf.ts's resolved-destination check before
 * any socket (test-connection AND the login bind), private LAN stays allowed,
 * and every connection-level failure answers with one generic sentence, no
 * sooner than a fixed floor (the time told the port state too) — the raw error
 * goes to the services log only.
 *
 * The two boundaries replaced are the `ldapts` client (no directory exists) and
 * name resolution (no DNS); the stored config is supplied by stubbing getConfig.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ldap = vi.hoisted(() => ({
  instances: [] as Array<{ opts: any; bind: any; unbind: any; search: any }>,
  bindImpl: null as null | (() => Promise<void>),
}));
vi.mock('ldapts', () => ({
  Client: class {
    opts: any; bind: any; unbind: any; search: any;
    constructor(opts: any) {
      this.opts = opts;
      this.bind = vi.fn(ldap.bindImpl ?? (async () => undefined));
      this.unbind = vi.fn(async () => undefined);
      this.search = vi.fn(async () => ({ searchEntries: [] }));
      ldap.instances.push(this);
    }
  },
}));

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }));

const { ldapService, LDAP_TEST_FAILURE_FLOOR_MS } = await import('../ldap.service.js');

const BLOCKED = 'LDAP connection failed: the server address is not allowed (loopback and link-local addresses are refused).';
const UNREACHABLE = 'LDAP connection failed: could not reach the LDAP server. Check the address and port, and that the server is reachable from this machine.';

const STORED = {
  enabled: true, serverUrl: 'ldaps://10.20.30.40:636', bindDN: 'cn=svc,dc=cvl,dc=lan', bindPassword: 'svc-pw',
  searchBase: 'dc=cvl,dc=lan', searchFilter: '(sAMAccountName={{username}})', usernameAttribute: 'sAMAccountName',
  emailAttribute: 'mail', fullNameAttribute: 'displayName', departmentAttribute: 'department', groupAttribute: 'memberOf',
  tlsRejectUnauthorized: true, connectionTimeout: 2000, roleMappings: [], defaultRole: 'OPERATOR', syncAttributes: true,
};

const netErr = (code: string, message: string) => Object.assign(new Error(message), { code });

beforeEach(() => {
  ldap.instances.length = 0;
  ldap.bindImpl = null;
  vi.spyOn(ldapService, 'getConfig').mockResolvedValue({ ...STORED } as any);
  dns.lookup.mockReset().mockImplementation(async (host: string) => {
    if (host === 'dc01.cvl.lan') return [{ address: '192.168.10.20', family: 4 }];
    if (host === 'localhost') return [{ address: '127.0.0.1', family: 4 }];
    if (host === 'nx.cvl.lan') throw netErr('ENOTFOUND', 'getaddrinfo ENOTFOUND nx.cvl.lan');
    return [{ address: host, family: host.includes(':') ? 6 : 4 }];
  });
});
afterEach(() => { vi.restoreAllMocks(); });

const probe = (serverUrl: string) => ldapService.testConnection({ serverUrl, bindDN: 'cn=x', bindPassword: 'typed' });

describe('test-connection: loopback / link-local are refused before any socket is opened', () => {
  it.each([
    'ldap://127.0.0.1:5432', 'ldap://127.0.0.1:1', 'ldap://169.254.169.254:389',
    'ldap://localhost:389', 'ldaps://[::1]:636', 'ldap://0.0.0.0:389', 'ldaps://[fe80::1]:636',
  ])('%s', async (serverUrl) => {
    expect(await probe(serverUrl)).toEqual({ success: false, message: BLOCKED });
    expect(ldap.instances).toHaveLength(0);
  });

  it('the stored server is checked too (a test with no body)', async () => {
    vi.spyOn(ldapService, 'getConfig').mockResolvedValue({ ...STORED, serverUrl: 'ldap://127.0.0.1:389' } as any);
    expect(await ldapService.testConnection()).toEqual({ success: false, message: BLOCKED });
    expect(ldap.instances).toHaveLength(0);
  });
});

describe('test-connection: the private LAN stays usable', () => {
  it('a LAN IP and a LAN hostname are connected to, with the configured options', async () => {
    expect(await probe('ldap://10.20.30.40:389')).toEqual({ success: true, message: 'Successfully connected and authenticated to LDAP server' });
    expect(await probe('ldaps://dc01.cvl.lan:636')).toMatchObject({ success: true });
    expect(ldap.instances[0].bind).toHaveBeenCalledWith('cn=x', 'typed');
    // SEC-14: the client connects to the address that PASSED the check, not to
    // a name ldapts would resolve again (DNS rebinding); the typed name stays
    // the TLS servername so the certificate is still checked against it.
    expect(ldap.instances.map((c) => c.opts)).toEqual([
      { url: 'ldap://10.20.30.40:389', connectTimeout: 2000, tlsOptions: { rejectUnauthorized: true } },
      { url: 'ldaps://192.168.10.20:636', connectTimeout: 2000, tlsOptions: { rejectUnauthorized: true, servername: 'dc01.cvl.lan' } },
    ]);
  });

  it('a name that would resolve to loopback on a SECOND lookup cannot be reached that way (the checked address is pinned)', async () => {
    // First answer LAN, every later answer loopback: the classic rebinding trick.
    let calls = 0;
    dns.lookup.mockImplementation(async () => (calls++ === 0
      ? [{ address: '192.168.10.21', family: 4 }]
      : [{ address: '127.0.0.1', family: 4 }]));
    await probe('ldaps://rebind.cvl.lan:636');
    expect(calls).toBe(1);
    expect(ldap.instances[0].opts.url).toBe('ldaps://192.168.10.21:636');
    expect(ldap.instances[0].opts.tlsOptions.servername).toBe('rebind.cvl.lan');
  });

  it('an IPv6 LAN literal is connected to as is, with no servername', async () => {
    await probe('ldaps://[fd00::25]:636');
    expect(ldap.instances[0].opts.url).toBe('ldaps://[fd00::25]:636');
    expect(ldap.instances[0].opts.tlsOptions).toEqual({ rejectUnauthorized: true });
  });
});

describe('test-connection: connection failures are indistinguishable', () => {
  // Every "unreachable" answer waits out a fixed floor so its TIME does not
  // tell the port state either; the clock is faked so the suite does not wait.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout'] }); });
  afterEach(() => { vi.useRealTimers(); });
  /** Run a probe, letting `ms` of (fake) time pass. */
  const timed = async (serverUrl: string, ms = 5000, body: Record<string, unknown> = {}) => {
    const p = ldapService.testConnection({ serverUrl, bindDN: 'cn=x', bindPassword: 'typed', ...body });
    await vi.advanceTimersByTimeAsync(ms);
    return p;
  };

  it.each([
    ['refused (port closed)', () => netErr('ECONNREFUSED', 'connect ECONNREFUSED 10.20.30.40:1')],
    ['reset (port open, not LDAP)', () => netErr('ECONNRESET', 'read ECONNRESET')],
    ['timeout (filtered)', () => new Error('Connection timeout')],
    ['host unreachable', () => netErr('EHOSTUNREACH', 'connect EHOSTUNREACH 10.20.30.40:389')],
    ['TLS failure', () => netErr('DEPTH_ZERO_SELF_SIGNED_CERT', 'self-signed certificate')],
    ['a non-Error rejection', () => 'plain string failure'],
  ])('%s → the one generic sentence, never the raw error', async (_label, make) => {
    ldap.bindImpl = async () => { throw make(); };
    const res = await timed('ldap://10.20.30.40:389');
    expect(res).toEqual({ success: false, message: UNREACHABLE });
  });

  it('and in the same time: a reset (open port) is not answered before the floor, nor before a longer connect timeout', async () => {
    ldap.bindImpl = async () => { throw netErr('ECONNRESET', 'read ECONNRESET'); };
    let settled = false;
    const p = ldapService.testConnection({ serverUrl: 'ldap://10.20.30.40:5432', bindDN: 'cn=x', bindPassword: 'typed' }).then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(LDAP_TEST_FAILURE_FLOOR_MS - 50);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(await p).toEqual({ success: false, message: UNREACHABLE });

    settled = false;
    const q = ldapService.testConnection({ serverUrl: 'ldap://10.20.30.40:1', bindDN: 'cn=x', bindPassword: 'typed', connectionTimeout: 8000 }).then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(7900);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect((await q).message).toBe(UNREACHABLE);
  });

  it('a name that does not resolve gets the same sentence (no DNS oracle either)', async () => {
    expect(await timed('ldap://nx.cvl.lan:389')).toEqual({ success: false, message: UNREACHABLE });
    expect(ldap.instances).toHaveLength(0);
  });

  it('an LDAP-level answer is reported — the server WAS reached and spoke LDAP', async () => {
    ldap.bindImpl = async () => { throw Object.assign(new Error('Code: 0x31'), { code: 49, name: 'InvalidCredentialsError' }); };
    expect(await probe('ldap://10.20.30.40:389')).toEqual({ success: false, message: 'LDAP connection failed: the server rejected the bind credentials.' });
    ldap.bindImpl = async () => { throw Object.assign(new Error('Code: 0x34'), { code: 52, name: 'UnavailableError' }); };
    expect(await probe('ldap://10.20.30.40:389')).toEqual({ success: false, message: 'LDAP connection failed: the server answered with LDAP result code 52.' });
  });

  it('a malformed URL with an ldap scheme but no host is refused without a socket', async () => {
    expect(await probe('ldap:///dc=cvl,dc=lan')).toEqual({ success: false, message: 'Server URL must include a host name or address' });
    expect(ldap.instances).toHaveLength(0);
  });
});

describe('login bind: the same destination check', () => {
  it('a stored loopback / link-local server is never bound to — the login gets null', async () => {
    for (const serverUrl of ['ldap://127.0.0.1:389', 'ldap://169.254.169.254:389']) {
      vi.spyOn(ldapService, 'getConfig').mockResolvedValue({ ...STORED, serverUrl } as any);
      expect(await ldapService.authenticateUser('jdoe', 'pw')).toBeNull();
    }
    expect(ldap.instances).toHaveLength(0);
  });

  it('a stored LAN server is still used', async () => {
    expect(await ldapService.authenticateUser('jdoe', 'pw')).toBeNull(); // no search hits
    expect(ldap.instances).toHaveLength(1);
    expect(ldap.instances[0].opts.url).toBe(STORED.serverUrl);
  });

  it('a stored LAN host name is bound to at its checked address, verified under its name', async () => {
    vi.spyOn(ldapService, 'getConfig').mockResolvedValue({ ...STORED, serverUrl: 'ldaps://dc01.cvl.lan:636' } as any);
    await ldapService.authenticateUser('jdoe', 'pw');
    expect(ldap.instances[0].opts).toMatchObject({ url: 'ldaps://192.168.10.20:636', tlsOptions: { servername: 'dc01.cvl.lan' } });
  });
});
