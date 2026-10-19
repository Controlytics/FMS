/**
 * Per-site tablet app: the certificate authority the APK trusts is ONE file,
 * res/raw/rootca.pem, and `scripts/build-site-apk.ps1` swaps a site's
 * rootCA.pem into exactly that file (2026-10-19). These checks keep the pieces
 * pointing at each other: if the resource is renamed or the trust config stops
 * reading it, the script would build an APK that trusts nothing new.
 *
 * Source-level on purpose: the Android build cannot run inside vitest.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(__dirname, '../../../../../..');
const rawRel = 'apps/android/android/app/src/main/res/raw/rootca.pem';
const nscPath = resolve(repo, 'apps/android/android/app/src/main/res/xml/network_security_config.xml');
const scriptPath = resolve(repo, 'scripts/build-site-apk.ps1');

describe('site APK certificate wiring', () => {
  it('the trust config reads @raw/rootca and keeps the manual-install fallback', () => {
    const nsc = readFileSync(nscPath, 'utf8');
    expect(nsc).toMatch(/<certificates\s+src="@raw\/rootca"\s*\/>/);
    expect(nsc).toMatch(/<certificates\s+src="user"\s*\/>/);
    expect(nsc).toMatch(/<certificates\s+src="system"\s*\/>/);
  });

  it('the built-in file is exactly one certificate and never a key', () => {
    expect(existsSync(resolve(repo, rawRel))).toBe(true);
    const pem = readFileSync(resolve(repo, rawRel), 'utf8');
    expect(pem).not.toMatch(/PRIVATE KEY/);
    expect(pem.match(/-----BEGIN CERTIFICATE-----/g)?.length).toBe(1);
  });

  it('the script swaps that same file, refuses keys, and restores it', () => {
    const ps = readFileSync(scriptPath, 'utf8');
    expect(ps).toContain(`$rawRel     = '${rawRel}'`);
    expect(ps).toMatch(/-match 'PRIVATE KEY'/);
    expect(ps).toMatch(/CA:TRUE/);
    expect(ps).toMatch(/finally \{[\s\S]*WriteAllBytes\(\$rawFile, \$original\)/);
  });
});
