import { X509Certificate } from 'node:crypto';

/**
 * The HTTPS certificate this process is serving, read ONCE at boot from the same
 * bytes the HTTPS server loaded (app.ts) — the API never re-reads the files, so
 * a certificate swapped on disk is only served after a restart, and this must
 * report what is served, not what is on disk.
 *
 * Feeds the Super Admin's expiry warning (2026-10-31, `GET
 * /api/system-health/certificate` + the dashboard banner). A company
 * certificate renewed every two months that nobody swaps in time stops every
 * browser and tablet the day it expires; the FMS's own certificate lasts 10
 * years, so for it the warning simply never shows.
 */
export const CERTIFICATE_WARN_DAYS = 14;

export interface ServedCertificateInfo {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  /** Whole days left; negative once expired. */
  daysLeft: number;
  fingerprint256: string;
}

let served: X509Certificate | null = null;

const oneLine = (dn: string) => dn.split('\n').filter(Boolean).join(', ');

/** Record the served certificate (PEM chain; the first certificate is the server's). Plain HTTP: null. */
export function recordServedCertificate(pem: Buffer | string | null | undefined): void {
  served = pem ? new X509Certificate(pem) : null;
}

export function servedCertificateInfo(now: number = Date.now()): ServedCertificateInfo | null {
  if (!served) return null;
  const to = new Date(served.validTo);
  return {
    subject: oneLine(served.subject),
    issuer: oneLine(served.issuer),
    validFrom: new Date(served.validFrom).toISOString(),
    validTo: to.toISOString(),
    daysLeft: Math.floor((to.getTime() - now) / 86_400_000),
    fingerprint256: served.fingerprint256,
  };
}
