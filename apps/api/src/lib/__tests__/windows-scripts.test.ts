import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Rules for the Windows scripts the installer ships (scripts/*.ps1|cmd|mjs),
 * each learnt from a failure that only showed on a customer-style machine.
 * Source-level on purpose: the scripts cannot run inside vitest.
 */
const REPO = join(__dirname, '..', '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');
const withoutComments = (src: string) => src.split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');

/** The scripts build-installer.ps1 copies into {app}\scripts. */
function stagedScripts(): string[] {
  const m = read('scripts/build-installer.ps1').match(/foreach \(\$s in ((?:'[^']+',?\s*)+)\)\s*\{\s*Copy-Item \(Join-Path \$PSScriptRoot \$s\)/);
  if (!m) throw new Error('staging list not found in scripts/build-installer.ps1 - update this test');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** The text of the first param( ... ) block, parentheses balanced. */
function paramBlock(src: string): string | null {
  const at = src.search(/\bparam\s*\(/i);
  if (at < 0) return null;
  let depth = 0;
  for (let i = src.indexOf('(', at); i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(at, i + 1);
  }
  return null;
}

const scriptDirs = ['scripts', 'installer/test'];
const ps1Files = scriptDirs.flatMap((d) => readdirSync(join(REPO, d)).filter((f) => f.endsWith('.ps1')).map((f) => `${d}/${f}`));

describe('Windows scripts', () => {
  // 2026-10-31: in an advanced script ([CmdletBinding()]) Windows PowerShell 5.1
  // leaves $PSScriptRoot EMPTY while it evaluates param() defaults. The Start-menu
  // "Apply server addresses" (no arguments) died there on every install since
  // 2026-10-10: `[string]$InstallDir = (Split-Path -Parent $PSScriptRoot)`.
  it.each(ps1Files)('%s: no $PSScriptRoot in an advanced script\'s param() defaults', (rel) => {
    const src = read(rel);
    if (!/\[CmdletBinding\(/i.test(src)) return;
    const block = paramBlock(withoutComments(src.slice(src.search(/\[CmdletBinding\(/i))));
    expect(block, `${rel}: no param block after [CmdletBinding()]`).not.toBeNull();
    expect(block!, `${rel}: resolve the default in the script body instead`).not.toMatch(/\$PSScriptRoot/i);
  });

  it('every sibling a shipped script calls is shipped too (else it fails on the customer PC)', () => {
    const staged = new Set(stagedScripts());
    const missing: string[] = [];
    for (const s of staged) {
      const src = withoutComments(read(`scripts/${s}`));
      const refs = s.endsWith('.cmd')
        ? [...src.matchAll(/%~dp0([\w.-]+\.(?:ps1|mjs|cmd))/g)].map((m) => m[1])
        : [...src.matchAll(/Join-Path \$(?:PSScriptRoot|scriptsDir) '([\w.-]+\.(?:ps1|mjs|cmd))'/g)].map((m) => m[1]);
      for (const r of refs) if (!staged.has(r)) missing.push(`${s} -> ${r}`);
    }
    // Start-menu shortcuts into {app}\scripts
    for (const m of read('installer/DigiLog.iss').matchAll(/Filename: "\{app\}\\scripts\\([\w.-]+)"/g)) {
      if (!staged.has(m[1])) missing.push(`DigiLog.iss -> ${m[1]}`);
    }
    // set-certificate.ps1 runs the checker by variable, not Join-Path literal
    if (!staged.has('check-certificate.mjs')) missing.push('set-certificate.ps1 -> check-certificate.mjs');
    expect(missing).toEqual([]);
    for (const s of staged) expect(existsSync(join(REPO, 'scripts', s)), s).toBe(true);
  });

  // Windows PowerShell 5.1 reads a BOM-less script in the ANSI code page: one
  // em dash in CODE tokenises as garbage (CHANGELOG, 2026-04); in a comment it is
  // harmless (backup-db.ps1 has a section sign there). cmd.exe reads .cmd in the
  // OEM code page. Node reads .mjs as UTF-8, so those are exempt.
  it('shipped .ps1 code and .cmd files are ASCII only', () => {
    const bad = stagedScripts().filter((s) => {
      if (s.endsWith('.mjs')) return false;
      let src = read(`scripts/${s}`);
      if (s.endsWith('.ps1')) src = withoutComments(src.replace(/<#[\s\S]*?#>/g, ''));
      return /[^\x00-\x7f]/.test(src);
    });
    expect(bad).toEqual([]);
  });

  it('every scheduled task is registered by install AND upgrade, and removed by uninstall', () => {
    const install = withoutComments(read('scripts/install.ps1'));
    const upgrade = withoutComments(read('scripts/upgrade.ps1'));
    const uninstall = withoutComments(read('scripts/uninstall.ps1'));
    const registrars = readdirSync(join(REPO, 'scripts')).filter((f) => /^register-.*-task\.ps1$/.test(f));
    expect(registrars.sort()).toEqual(['register-backup-task.ps1', 'register-cert-check-task.ps1']);
    for (const r of registrars) {
      const name = read(`scripts/${r}`).match(/\$taskName\s*=\s*'([^']+)'/)?.[1];
      expect(name, r).toBeTruthy();
      expect(install, `install.ps1 must call ${r}`).toContain(`'${r}'`);
      expect(upgrade, `upgrade.ps1 must call ${r} (Setup's upgrade path never runs install.ps1)`).toContain(`'${r}'`);
      expect(uninstall, `uninstall.ps1 must remove '${name}'`).toMatch(new RegExp(`Unregister-ScheduledTask -TaskName '${name}'`));
    }
  });

  it('the legacy OpenSSL provider is staged for old .pfx files (set-certificate.ps1)', () => {
    const b = read('scripts/build-installer.ps1');
    expect(b).toMatch(/x64\\lib\\ossl-modules\\legacy\.dll/);
    expect(b).toMatch(/Join-Path \$sslDest 'ossl-modules\\legacy\.dll'/);
    expect(read('scripts/set-certificate.ps1')).toMatch(/\$env:OPENSSL_MODULES\s*=\s*Join-Path \(Split-Path \$OpenSsl\) 'ossl-modules'/);
  });
});
