import { X509Certificate } from 'node:crypto';

/**
 * Stable identity of THIS DigiLog install, published on /api/health as
 * `serverId` so the tablet can rediscover the server after a DHCP address change
 * without latching onto a different DigiLog install on the same network
 * (tasks/AUTO-IP-RECOVERY-PLAN.md, Part 2).
 *
 * Value = the served certificate's authorityKeyIdentifier (hex). It identifies
 * the install's CA: it survives every re-issue of server.crt by the same CA, and
 * differs between installs. It is public (sent in every TLS handshake), so
 * publishing it leaks nothing. The CA files themselves are never read.
 *
 * Node's X509Certificate does not expose the AKI, so it is read from the DER:
 *   OID 2.5.29.35 (06 03 55 1D 23) [BOOLEAN critical]? OCTET STRING {
 *     SEQUENCE { [0] keyIdentifier, ... } }
 */
const AKI_OID = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x23]);

/** Read one DER length at `at`; returns [length, offsetAfterLength]. */
function derLength(buf: Buffer, at: number): [number, number] {
  const first = buf[at];
  if (first < 0x80) return [first, at + 1];
  const n = first & 0x7f;
  if (n === 0 || n > 4) throw new Error('unsupported DER length');
  let len = 0;
  for (let i = 1; i <= n; i++) len = len * 256 + buf[at + i];
  return [len, at + 1 + n];
}

export function authorityKeyIdFromDer(der: Buffer): string | null {
  const at = der.indexOf(AKI_OID);
  if (at < 0) return null;
  let p = at + AKI_OID.length;
  if (der[p] === 0x01) p += 3; // BOOLEAN critical (01 01 xx)
  if (der[p] !== 0x04) return null; // extnValue OCTET STRING
  [, p] = derLength(der, p + 1);
  if (der[p] !== 0x30) return null; // AuthorityKeyIdentifier SEQUENCE
  [, p] = derLength(der, p + 1);
  if (der[p] !== 0x80) return null; // [0] keyIdentifier is optional; absent → no id
  const [len, start] = derLength(der, p + 1);
  if (len === 0 || start + len > der.length) return null;
  return der.subarray(start, start + len).toString('hex');
}

/** serverId for the served certificate PEM, or null (plain HTTP / no AKI). */
export function serverIdFromCertPem(pem: Buffer | string | null | undefined): string | null {
  if (!pem) return null;
  // Not caught: this is the same file the HTTPS server just loaded, so a parse
  // failure means a broken certificate and should stop the boot loudly.
  return authorityKeyIdFromDer(new X509Certificate(pem).raw);
}
