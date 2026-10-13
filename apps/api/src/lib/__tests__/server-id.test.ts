import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serverIdFromCertPem, authorityKeyIdFromDer } from '../server-id.js';

/**
 * serverId = the served cert's authorityKeyIdentifier. Real certificates are
 * minted with openssl so the DER parser is tested against what openssl/mkcert
 * actually write, not a hand-built fixture.
 */
const dir = mkdtempSync(join(tmpdir(), 'serverid-'));
const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
const ossl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, env, stdio: 'pipe' });

function makeCa(name: string) {
  ossl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.pem`,
    '-days', '30', '-subj', `/CN=${name}`);
}
function makeLeaf(ca: string, out: string, ip: string) {
  writeFileSync(join(dir, `${out}.ext`),
    `authorityKeyIdentifier=keyid,issuer\nbasicConstraints=CA:FALSE\nsubjectAltName=IP:${ip}\n`);
  ossl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${out}.key`, '-out', `${out}.csr`, '-subj', '/CN=leaf');
  ossl('x509', '-req', '-in', `${out}.csr`, '-CA', `${ca}.pem`, '-CAkey', `${ca}.key`, '-CAcreateserial',
    '-days', '30', '-extfile', `${out}.ext`, '-out', `${out}.crt`);
  return readFileSync(join(dir, `${out}.crt`));
}

describe('serverIdFromCertPem', () => {
  let a1: Buffer; let a2: Buffer; let b1: Buffer;
  beforeAll(() => {
    makeCa('caA'); makeCa('caB');
    a1 = makeLeaf('caA', 'a1', '192.168.1.58');
    a2 = makeLeaf('caA', 'a2', '192.168.1.77'); // re-issue by the SAME CA
    b1 = makeLeaf('caB', 'b1', '192.168.1.58'); // another install's CA
  }, 60_000);

  it('is a hex key id, stable across re-issues by the same CA', () => {
    const id = serverIdFromCertPem(a1);
    expect(id).toMatch(/^[0-9a-f]{40}$/);
    expect(serverIdFromCertPem(a2)).toBe(id);
  });

  it('differs between installs (different CA)', () => {
    expect(serverIdFromCertPem(b1)).not.toBe(serverIdFromCertPem(a1));
  });

  it("equals the CA's own subjectKeyIdentifier", () => {
    const caText = execFileSync('openssl', ['x509', '-in', 'caA.pem', '-noout', '-ext', 'subjectKeyIdentifier'],
      { cwd: dir, env }).toString();
    const ski = caText.split('\n')[1].trim().replace(/:/g, '').toLowerCase();
    expect(serverIdFromCertPem(a1)).toBe(ski);
  });

  it('is null for plain HTTP (no certificate) and for a cert without the extension', () => {
    expect(serverIdFromCertPem(null)).toBeNull();
    expect(serverIdFromCertPem(undefined)).toBeNull();
    // a self-signed CA written with -x509 carries an AKI too, so test the DER walker
    // directly on a buffer with no AKI OID in it.
    expect(authorityKeyIdFromDer(Buffer.from([0x30, 0x03, 0x02, 0x01, 0x00]))).toBeNull();
  });

  it('reads the dev certificate the API actually serves', () => {
    const devCrt = resolve(__dirname, '../../../../../certs/server.crt');
    if (!existsSync(devCrt)) return;
    expect(serverIdFromCertPem(readFileSync(devCrt))).toMatch(/^[0-9a-f]{40}$/);
  });
});
