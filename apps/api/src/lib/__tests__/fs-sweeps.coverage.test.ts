/**
 * Filesystem edge cases of the two sweepers, on private temp folders:
 *   log-retention       a file it may not delete is reported (not thrown), the
 *                        root/modules layout quirks, logDirSizeBytes
 *   photo-orphan-sweep  a non-file candidate is kept, an undeletable orphan is
 *                        reported, and an unreadable folder is an error
 * Nothing outside the temp folders is touched; photo-orphan-sweep is always
 * given its directory explicitly (its default is the live uploads folder).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pruneChannelDir, pruneAllLogs, logDirSizeBytes } from '../log-retention.js';
import { sweepOrphanPhotos } from '../photo-orphan-sweep.js';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cvl-sweeps-'));
const DAY = 86_400_000;
const isWin = process.platform === 'win32';

/**
 * Make `file` undeletable until the returned release runs. Windows: another
 * process holds it open with no delete sharing (Node's own unlink clears the
 * read-only bit, so chmod is not enough there). POSIX: a read-only parent dir.
 */
async function pin(file: string): Promise<() => Promise<void>> {
  if (!isWin) {
    const dir = path.dirname(file);
    fs.chmodSync(dir, 0o555);
    return async () => { fs.chmodSync(dir, 0o755); };
  }
  const child = spawn('powershell.exe', ['-NoProfile', '-Command',
    `$f=[System.IO.File]::Open('${file.replace(/'/g, "''")}','Open','Read','None'); Write-Output LOCKED; Start-Sleep -Seconds 60`]);
  await new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('LOCKED')) resolve(); });
    child.on('exit', (code) => reject(new Error(`lock holder exited early (${code})`)));
  });
  return async () => {
    const gone = new Promise((r) => child.once('exit', r));
    child.kill();
    await gone;
  };
}

afterAll(() => { fs.rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

describe('log retention', () => {
  it('reports an entry it cannot delete instead of throwing, and still drops the date', async () => {
    const dir = path.join(ROOT, 'locked-channel');
    fs.mkdirSync(dir, { recursive: true });
    for (const d of ['2026-01-02', '2026-01-03']) fs.writeFileSync(path.join(dir, `http.${d}.1.log`), d);
    // A directory with a log file's name: matched by the pattern, refused by unlink.
    const stuck = path.join(dir, 'http.2026-01-01.1.log');
    fs.mkdirSync(stuck);
    const res = await pruneChannelDir(dir, 2);
    expect(res.removedDates).toEqual(['2026-01-01']);
    expect(res.deleted).toBe(0);
    expect(res.errors).toEqual([{ file: stuck, message: expect.stringMatching(/^E[A-Z]+/) }]);
    expect(fs.existsSync(stuck)).toBe(true);
  });

  it('skips loose files at the root and inside modules/, and a modules entry that is a file', async () => {
    const root = path.join(ROOT, 'app-layout');
    fs.mkdirSync(path.join(root, 'modules', 'sync'), { recursive: true });
    fs.writeFileSync(path.join(root, 'README.txt'), 'operator note');
    fs.writeFileSync(path.join(root, 'modules', 'stray.log'), 'x');
    for (let i = 1; i <= 3; i++) fs.writeFileSync(path.join(root, 'modules', 'sync', `sync.2026-02-0${i}.1.log`), 'x');
    const res = await pruneAllLogs(1, root);
    expect(res.removedDates).toEqual(['2026-02-02', '2026-02-01']);
    expect(res.deleted).toBe(2);
    expect(fs.existsSync(path.join(root, 'README.txt'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'modules', 'stray.log'))).toBe(true);

    const fileModules = path.join(ROOT, 'file-modules');
    fs.mkdirSync(fileModules, { recursive: true });
    fs.writeFileSync(path.join(fileModules, 'modules'), 'not a directory');
    expect(await pruneAllLogs(1, fileModules)).toEqual({ scanned: 0, deleted: 0, removedDates: [], errors: [] });
  });

  it('logDirSizeBytes adds up every file in the tree, and is 0 for a missing folder', async () => {
    const root = path.join(ROOT, 'sized');
    fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(root, 'x.log'), Buffer.alloc(100));
    fs.writeFileSync(path.join(root, 'a', 'y.log'), Buffer.alloc(250));
    fs.writeFileSync(path.join(root, 'a', 'b', 'z.log'), Buffer.alloc(7));
    expect(await logDirSizeBytes(root)).toBe(357);
    expect(await logDirSizeBytes(path.join(ROOT, 'does-not-exist'))).toBe(0);
  });
});

describe('photo orphan sweep', () => {
  const dir = path.join(ROOT, 'photos');
  const photo = () => `${randomUUID()}-${randomUUID()}.jpg`;
  const old = (p: string) => { const t = new Date(Date.now() - 3 * DAY); fs.utimesSync(p, t, t); };

  beforeAll(() => { fs.mkdirSync(dir, { recursive: true }); });

  it('keeps a candidate that is not a regular file, and uses the 24 h default age', async () => {
    const asDir = path.join(dir, photo());
    fs.mkdirSync(asDir);
    old(asDir);
    const fresh = path.join(dir, photo());
    fs.writeFileSync(fresh, 'x'); // just uploaded: under the default 24 h
    const res = await sweepOrphanPhotos({ dir });
    expect(res).toMatchObject({ scanned: 2, deleted: 0, kept: 2, errors: [] });
    expect(fs.existsSync(asDir)).toBe(true);
    expect(fs.existsSync(fresh)).toBe(true);
    fs.rmSync(asDir, { recursive: true });
    fs.rmSync(fresh);
  });

  it('reports an orphan it cannot delete', async () => {
    const name = photo();
    const p = path.join(dir, name);
    fs.writeFileSync(p, 'x');
    old(p);
    const release = await pin(p);
    try {
      const res = await sweepOrphanPhotos({ dir, minAgeMs: DAY });
      expect(res.deleted).toBe(0);
      expect(res.errors).toEqual([expect.stringMatching(new RegExp(`^${name}: E[A-Z]+$`))]);
      expect(fs.existsSync(p)).toBe(true);
    } finally { await release(); fs.rmSync(p, { force: true }); }
  }, 60_000);

  it('with no folder given, sweeps <UPLOAD_DIR>/photos', async () => {
    const uploadRoot = path.join(ROOT, 'upload-root');
    fs.mkdirSync(path.join(uploadRoot, 'photos'), { recursive: true });
    const orphan = path.join(uploadRoot, 'photos', photo());
    fs.writeFileSync(orphan, 'x');
    old(orphan);
    const saved = process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR = uploadRoot;
    vi.resetModules();
    let mod: typeof import('../photo-orphan-sweep.js');
    let prismaMod: typeof import('../prisma.js');
    try {
      mod = await import('../photo-orphan-sweep.js');
      prismaMod = await import('../prisma.js');
    } finally {
      if (saved === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = saved;
    }
    try {
      expect(await mod.sweepOrphanPhotos()).toMatchObject({ scanned: 1, deleted: 1, kept: 0, errors: [] });
      expect(fs.existsSync(orphan)).toBe(false);
    } finally { await prismaMod.prisma.$disconnect(); }
  }, 60_000);

  it('fails loudly when the folder exists but cannot be read', async () => {
    const notADir = path.join(ROOT, 'photos-is-a-file');
    fs.writeFileSync(notADir, 'x');
    await expect(sweepOrphanPhotos({ dir: notADir })).rejects.toMatchObject({ code: expect.stringMatching(/^E/) });
  });
});
