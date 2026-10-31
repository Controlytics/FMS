import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Windows scripts that wait for the API must ask "is FMS answering?" on
 * https://127.0.0.1, never localhost, and WITHOUT checking the certificate.
 *
 * - localhost (2026-10-31): the API listens on IPv4 only (`host: '0.0.0.0'` in
 *   app.ts); Windows resolves localhost to ::1 first, and a refused ::1
 *   connection takes ~2 s to fail - longer than the 2 s per-try timeout. Every
 *   fresh install reported "API did not report healthy" and "installation did
 *   NOT finish" while the API was answering (laptop, 2026-10-23 and -31).
 * - certificate check (2026-10-31): a site on its company certificate
 *   (set-certificate.ps1) normally names neither 127.0.0.1 nor localhost, so a
 *   checked probe failed the same way on every upgrade there.
 *
 * ONE probe, scripts/health-probe.ps1, dot-sourced by every caller.
 * Source-level on purpose: the scripts cannot run inside vitest.
 */
const REPO = join(__dirname, '..', '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');
const CALLERS = ['install.ps1', 'upgrade.ps1', 'restore-database.ps1', 'apply-addresses.ps1', 'set-certificate.ps1', 'check-lan-cert.ps1'];
const code = (src: string) => src.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');

describe('health probe', () => {
  it('the API still listens on IPv4 only - the reason the probe uses 127.0.0.1', () => {
    expect(read('apps/api/src/app.ts')).toMatch(/app\.listen\(\{\s*port,\s*host:\s*'0\.0\.0\.0'\s*\}\)/);
  });

  it('health-probe.ps1 asks 127.0.0.1 and never checks the certificate (curl -k / own callback)', () => {
    const src = code(read('scripts/health-probe.ps1'));
    const urls = [...src.matchAll(/"(https?:\/\/[^"]*api\/health)"/g)].map((m) => m[1]);
    expect(urls).toEqual(['https://127.0.0.1:$Port/api/health']);
    // curl path: -k (no check) + --ssl-no-revoke (Schannel CRL fetch), output to NUL.
    expect(src).toMatch(/&\s*\$curl\s+-s\s+-k\s+--ssl-no-revoke\s+--max-time/);
    // no-curl path: a per-request callback accepting the certificate, never the
    // global ServicePointManager callback (it would stay off for the whole script).
    expect(src).toMatch(/req\.ServerCertificateValidationCallback\s*=\s*delegate\s*\{\s*return true;\s*\}/);
    expect(src).not.toMatch(/ServicePointManager\]?::ServerCertificateValidationCallback|ServicePointManager\.ServerCertificateValidationCallback/);
  });

  it.each(CALLERS)('%s waits through Wait-DigilogHealth and has no probe of its own', (script) => {
    const src = code(read(`scripts/${script}`));
    expect(src).toMatch(/\.\s*\(Join-Path\s+\$(PSScriptRoot|scriptsDir)\s+'health-probe\.ps1'\)/);
    expect(src).toMatch(/Wait-DigilogHealth\s+-Port/);
    expect(src).not.toMatch(/Invoke-WebRequest[^\n]*api\/health/);
  });

  it('collect-logs.ps1 (standalone, not staged) still probes 127.0.0.1 with curl -k', () => {
    const src = read('scripts/collect-logs.ps1');
    expect(src).toMatch(/\$url\s*=\s*"\$\{scheme\}:\/\/127\.0\.0\.1:\$ApiPort\/api\/health"/);
    expect(src).toMatch(/&\s*\$curl\s+-sk\b/);
  });
});
