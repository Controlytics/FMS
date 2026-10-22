/**
 * D-OPS-7 (2026-10-22): MAX_FILE_SIZE is THE upload limit. lib/upload-limits.ts
 * parses it once; app.ts and the e2e harness register multipart with it. The
 * enforced behaviour is proven through the real photo route in
 * modules/uploads/__tests__/photo-upload.coverage.test.ts; this file covers the
 * parser and guards the two registrations against a literal creeping back.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMaxFileSize, DEFAULT_MAX_UPLOAD_FILE_SIZE } from '../upload-limits.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('parseMaxFileSize', () => {
  it('reads a whole positive number of bytes', () => {
    expect(parseMaxFileSize('5242880')).toBe(5 * 1024 * 1024);
    expect(parseMaxFileSize(' 1024 ')).toBe(1024);
  });

  it.each([undefined, '', '   ', '0', '-5', '5MB', '1.5', '1e6', 'abc', '99999999999999999999'])('refuses %j', (raw) => {
    expect(parseMaxFileSize(raw as string | undefined)).toBeNull();
  });
});

describe('MAX_UPLOAD_FILE_SIZE (read at import)', () => {
  const prev = process.env.MAX_FILE_SIZE;
  afterEach(() => {
    if (prev === undefined) delete process.env.MAX_FILE_SIZE; else process.env.MAX_FILE_SIZE = prev;
    vi.doUnmock('../logger.js');
    vi.resetModules();
  });

  async function load(raw: string | undefined) {
    if (raw === undefined) delete process.env.MAX_FILE_SIZE; else process.env.MAX_FILE_SIZE = raw;
    const warn = vi.fn();
    vi.resetModules();
    vi.doMock('../logger.js', () => ({ getLogger: () => ({ warn }) }));
    const mod = await import('../upload-limits.js');
    return { value: mod.MAX_UPLOAD_FILE_SIZE, warn };
  }

  it('uses MAX_FILE_SIZE when it is valid', async () => {
    const { value, warn } = await load('2097152');
    expect(value).toBe(2097152);
    expect(warn).not.toHaveBeenCalled();
  });

  it('defaults to 5 MB, silently, when MAX_FILE_SIZE is unset', async () => {
    const { value, warn } = await load(undefined);
    expect(value).toBe(DEFAULT_MAX_UPLOAD_FILE_SIZE);
    expect(warn).not.toHaveBeenCalled();
  });

  it('defaults to 5 MB and SAYS so when MAX_FILE_SIZE is not a number of bytes', async () => {
    const { value, warn } = await load('5MB');
    expect(value).toBe(DEFAULT_MAX_UPLOAD_FILE_SIZE);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toEqual({ MAX_FILE_SIZE: '5MB', appliedBytes: DEFAULT_MAX_UPLOAD_FILE_SIZE });
  });
});

/** Every non-test .ts file under src/modules. */
function moduleSources(dir = path.join(SRC, 'modules')): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name !== '__tests__') out.push(...moduleSources(p)); }
    else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('no FILE_TOO_LARGE message states a size of its own (2026-10-22)', () => {
  // A message that hard-codes "5 MB" drifts the moment MAX_FILE_SIZE (or a
  // route's own per-request limit) changes: pm-schedules said "5 MB" after the
  // limit became MAX_FILE_SIZE. The size in a message must come from the same
  // constant the limit does.
  it('each FILE_TOO_LARGE response derives its size from a constant', () => {
    const offenders: string[] = [];
    for (const file of moduleSources()) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!line.includes("'FILE_TOO_LARGE'")) return;
        // The message is on the same line or within the next two.
        const window = lines.slice(i, i + 3).join('\n');
        if (/\d+(\.\d+)?\s?MB\b/.test(window.replace(/\$\{[^}]*\}/g, ''))) offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('both multipart registrations use the one limit', () => {
  it.each(['app.ts', path.join('e2e', 'test-helper.ts')])('%s registers multipart with MAX_UPLOAD_FILE_SIZE and no literal size', (file) => {
    const src = readFileSync(path.join(SRC, file), 'utf8');
    const reg = src.slice(src.indexOf('register(multipart'));
    const block = reg.slice(0, reg.indexOf(');') + 2);
    expect(block).toContain('fileSize: MAX_UPLOAD_FILE_SIZE');
    expect(block).not.toMatch(/fileSize:\s*\d/);
    expect(src).toContain("from './lib/upload-limits.js'".replace('./lib', file === 'app.ts' ? './lib' : '../lib'));
  });
});
