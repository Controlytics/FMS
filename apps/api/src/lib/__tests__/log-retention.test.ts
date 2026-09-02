import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pruneChannelDir, pruneAllLogs, retentionDays, formatBytes } from '../log-retention.js';

/**
 * The 7-day rule is the requirement the operator stated in their own words:
 * "if new file coming last old file should be removed ... only 7 days log files
 * should be stored". These tests are the proof it holds — a boot that reports
 * `deletedFiles: 0` on an empty directory proves the sweep RUNS, not that it
 * PRUNES.
 */

let dir: string;

async function touch(name: string, bytes = 10): Promise<void> {
  await writeFile(path.join(dir, name), 'x'.repeat(bytes));
}

async function names(d = dir): Promise<string[]> {
  return (await readdir(d)).sort();
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'digilog-logs-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('pruneChannelDir — keeps the newest N days', () => {
  it('reduces 12 days to 7, keeping the NEWEST 7', async () => {
    const days = [
      '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24',
      '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29',
      '2026-08-30', '2026-08-31',
    ];
    for (const d of days) await touch(`error.${d}.1.log`);

    const result = await pruneChannelDir(dir, 7);

    const left = await names();
    expect(left).toHaveLength(7);
    expect(result.deleted).toBe(5);
    // The five oldest went; the seven newest stayed.
    expect(left).toEqual([
      'error.2026-08-25.1.log', 'error.2026-08-26.1.log', 'error.2026-08-27.1.log',
      'error.2026-08-28.1.log', 'error.2026-08-29.1.log', 'error.2026-08-30.1.log',
      'error.2026-08-31.1.log',
    ]);
    expect(result.errors).toEqual([]);
  });

  it('is a no-op at exactly 7 days — the boundary must not delete today', async () => {
    for (const d of ['08-25', '08-26', '08-27', '08-28', '08-29', '08-30', '08-31']) {
      await touch(`http.2026-${d}.1.log`);
    }
    const result = await pruneChannelDir(dir, 7);
    expect(result.deleted).toBe(0);
    expect(await names()).toHaveLength(7);
  });

  it('counts a size-split day as ONE day, deleting all of its parts together', async () => {
    // A busy day splits into .1 .2 .3 once it passes the size cap. If retention
    // counted FILES, one heavy afternoon would evict the rest of the week.
    await touch('http.2026-08-25.1.log');
    await touch('http.2026-08-26.1.log');
    await touch('http.2026-08-27.1.log');
    for (const n of [1, 2, 3, 4, 5, 6]) await touch(`http.2026-08-31.${n}.log`);

    const result = await pruneChannelDir(dir, 2);

    // Two DAYS kept (08-27 and 08-31) — that is 7 files, not 2.
    expect(await names()).toEqual([
      'http.2026-08-27.1.log',
      'http.2026-08-31.1.log', 'http.2026-08-31.2.log', 'http.2026-08-31.3.log',
      'http.2026-08-31.4.log', 'http.2026-08-31.5.log', 'http.2026-08-31.6.log',
    ]);
    expect(result.removedDates).toEqual(['2026-08-26', '2026-08-25']);
  });

  it('never touches a file that is not one of ours', async () => {
    // The sweep unlinks files, so it must match only the exact shape we write.
    // An operator's saved copy, a zip, or an older naming scheme must survive.
    await touch('error.2026-08-01.1.log');
    await touch('error.2026-08-02.1.log');
    await touch('error.2026-08-03.1.log');
    await touch('operator-copy-of-error.txt');
    await touch('error.log');
    await touch('error-2026-08-01.log');       // dashes, not dots
    await touch('incident-2026-08-01.zip');

    await pruneChannelDir(dir, 1);

    const left = await names();
    expect(left).toContain('operator-copy-of-error.txt');
    expect(left).toContain('error.log');
    expect(left).toContain('error-2026-08-01.log');
    expect(left).toContain('incident-2026-08-01.zip');
    // Only the two oldest matching files were removed.
    expect(left).toContain('error.2026-08-03.1.log');
    expect(left).not.toContain('error.2026-08-01.1.log');
    expect(left).not.toContain('error.2026-08-02.1.log');
  });

  it('returns cleanly for a directory that does not exist', async () => {
    const result = await pruneChannelDir(path.join(dir, 'never-used'), 7);
    expect(result.deleted).toBe(0);
    expect(result.errors).toEqual([]);
  });
});

describe('pruneAllLogs — every channel keeps its OWN 7 days', () => {
  it('prunes core channels and nested module channels independently', async () => {
    const mk = async (rel: string, dates: string[]) => {
      const d = path.join(dir, rel);
      await mkdir(d, { recursive: true });
      const base = path.basename(rel);
      for (const date of dates) await writeFile(path.join(d, `${base}.${date}.1.log`), 'x');
    };
    const nineDays = [
      '2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27',
      '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31',
    ];
    await mk('error', nineDays);
    await mk('http', nineDays);
    await mk('application', ['2026-08-30', '2026-08-31']);
    await mk('modules/filter-operations', nineDays);
    await mk('modules/backup', ['2026-08-31']);

    const result = await pruneAllLogs(7, dir);

    // 7 kept per channel, independently — not 7 across the whole tree.
    expect(await names(path.join(dir, 'error'))).toHaveLength(7);
    expect(await names(path.join(dir, 'http'))).toHaveLength(7);
    expect(await names(path.join(dir, 'modules', 'filter-operations'))).toHaveLength(7);
    // Channels under the limit are untouched.
    expect(await names(path.join(dir, 'application'))).toHaveLength(2);
    expect(await names(path.join(dir, 'modules', 'backup'))).toHaveLength(1);

    expect(result.deleted).toBe(6); // 2 each from the three nine-day channels
  });

  it('returns cleanly on first boot, before any log directory exists', async () => {
    const result = await pruneAllLogs(7, path.join(dir, 'not-created-yet'));
    expect(result).toEqual({ scanned: 0, deleted: 0, removedDates: [], errors: [] });
  });
});

describe('retentionDays', () => {
  const original = process.env.LOG_RETENTION_DAYS;
  afterEach(() => {
    if (original === undefined) delete process.env.LOG_RETENTION_DAYS;
    else process.env.LOG_RETENTION_DAYS = original;
  });

  it('defaults to 7', () => {
    delete process.env.LOG_RETENTION_DAYS;
    expect(retentionDays()).toBe(7);
  });

  it('honours an explicit override', () => {
    process.env.LOG_RETENTION_DAYS = '30';
    expect(retentionDays()).toBe(30);
  });

  it('refuses 0 and negatives — a misconfiguration must never delete today', () => {
    process.env.LOG_RETENTION_DAYS = '0';
    expect(retentionDays()).toBe(7);
    process.env.LOG_RETENTION_DAYS = '-3';
    expect(retentionDays()).toBe(7);
    process.env.LOG_RETENTION_DAYS = 'not-a-number';
    expect(retentionDays()).toBe(7);
  });
});

describe('formatBytes', () => {
  it('renders sizes an operator can read', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.00 GB');
  });
});
