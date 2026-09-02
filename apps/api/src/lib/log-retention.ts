import { readdir, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { APP_LOG_ROOT } from './log-dir.js';

/**
 * Keep the newest N *days* of log files per channel. Day N+1 arrives → the
 * oldest day's files are deleted.
 *
 * ## Why this exists instead of pino-roll's `limit`
 *
 * Read from pino-roll@4.0.0's own source, not its README:
 *
 * 1. `removeOldFiles()` is called ONLY from inside `roll()`, which fires on the
 *    midnight timer or on a size overflow. It never runs at startup. On a plant
 *    PC that is powered off overnight, the midnight roll never fires while the
 *    process is alive — so files would accumulate forever and the 7-day promise
 *    would silently be a lie.
 * 2. Its two cleanup branches disagree by one: with `removeOtherLogFiles:false`
 *    it keeps `count + 1` files (as documented); with `true` it keeps `count`.
 *    "7" could mean 8 depending on which mode you picked.
 *
 * So pino-roll owns the *rolling* (daily switch, same-day reuse across a
 * restart, Windows unlink retry) and this owns the *retention*. It runs at
 * startup AND on a daily cron, so the rule holds no matter how often the
 * service restarts or how long the machine was off.
 *
 * ## Days, not files
 *
 * A single day can span several files when a size cap splits it
 * (`http.2026-08-31.1.log`, `.2.log`, …). Retention groups by DATE and keeps
 * the newest `keep` dates, so a busy day never evicts a quiet one — otherwise
 * one heavy afternoon could silently wipe out the rest of the week.
 */
export const DEFAULT_RETENTION_DAYS = 7;

/**
 * `LOG_RETENTION_DAYS` exists for the customer who is told to keep 30 days.
 * Clamped to >= 1: a misconfigured `0` must never mean "delete today's log".
 */
export function retentionDays(): number {
  const raw = Number(process.env.LOG_RETENTION_DAYS);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_RETENTION_DAYS;
  return Math.floor(raw);
}

/**
 * `<base>.<yyyy-MM-dd>.<n>.log` — exactly the shape pino-roll produces with
 * `frequency:'daily'` + `dateFormat:'yyyy-MM-dd'` + `extension:'.log'`.
 *
 * Anchored at both ends on purpose. This function DELETES files, so it must
 * match only what we wrote. Anything else in the directory — an operator's
 * saved copy, a zip, a file from an older naming scheme — is left alone.
 */
const LOG_FILE_RE = /^(.+)\.(\d{4}-\d{2}-\d{2})\.(\d+)\.log$/;

export interface PruneResult {
  /** Directories examined. */
  scanned: number;
  /** Files removed. */
  deleted: number;
  /** Dates removed, newest first — for the log line the sweep itself writes. */
  removedDates: string[];
  /** Per-file failures (Windows file lock, permissions). Never thrown. */
  errors: Array<{ file: string; message: string }>;
}

function emptyResult(): PruneResult {
  return { scanned: 0, deleted: 0, removedDates: [], errors: [] };
}

function mergeInto(target: PruneResult, add: PruneResult): void {
  target.scanned += add.scanned;
  target.deleted += add.deleted;
  target.removedDates.push(...add.removedDates);
  target.errors.push(...add.errors);
}

/**
 * Prune ONE channel directory to the newest `keep` dates.
 *
 * Exported so the unit test can drive it against a temp directory without
 * needing the whole logger stack.
 */
export async function pruneChannelDir(dir: string, keep: number): Promise<PruneResult> {
  const result = emptyResult();

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // Channel never used yet, or the directory was removed underneath us.
    // Not an error: nothing to retain.
    return result;
  }
  result.scanned = 1;

  // date -> file names for that date
  const byDate = new Map<string, string[]>();
  for (const name of entries) {
    const m = LOG_FILE_RE.exec(name);
    if (!m) continue;
    const date = m[2];
    const bucket = byDate.get(date);
    if (bucket) bucket.push(name);
    else byDate.set(date, [name]);
  }

  if (byDate.size <= keep) return result;

  // ISO dates sort correctly as strings — newest first, keep the head.
  const dates = [...byDate.keys()].sort().reverse();
  const doomed = dates.slice(keep);

  for (const date of doomed) {
    for (const name of byDate.get(date) ?? []) {
      const full = path.join(dir, name);
      try {
        await unlink(full);
        result.deleted++;
      } catch (err) {
        result.errors.push({ file: full, message: (err as Error).message });
      }
    }
    result.removedDates.push(date);
  }

  return result;
}

/**
 * Prune every channel directory under `<LOG_DIR>/app/`.
 *
 * Scope is deliberately narrow — only directories WE create, only files
 * matching the pattern WE write:
 *   - WinSW's own logs sit in the parent `<LOG_DIR>/` and are already bounded
 *     (10 MB x 8). Windows will not let us unlink a file WinSW holds open, and
 *     they are the only record of a crash that happens before this process can
 *     log anything — we do not touch them.
 *   - Postgres logs are self-recycling by weekday (`postgresql-%a.log` +
 *     `log_truncate_on_rotation`), configured in scripts/provision-db.ps1.
 */
export async function pruneAllLogs(
  keep: number = retentionDays(),
  root: string = APP_LOG_ROOT,
): Promise<PruneResult> {
  const total = emptyResult();

  let entries: Array<{ name: string; isDirectory: boolean }>;
  try {
    const dirents = await readdir(root, { withFileTypes: true });
    entries = dirents.map((d) => ({ name: d.name, isDirectory: d.isDirectory() }));
  } catch {
    // No logs written yet — first boot. Nothing to do.
    return total;
  }

  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const dir = path.join(root, entry.name);

    if (entry.name === 'modules') {
      // One level deeper: <root>/modules/<module-name>/
      let modDirs: string[] = [];
      try {
        const dirents = await readdir(dir, { withFileTypes: true });
        modDirs = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
      } catch {
        continue;
      }
      for (const mod of modDirs) {
        mergeInto(total, await pruneChannelDir(path.join(dir, mod), keep));
      }
      continue;
    }

    mergeInto(total, await pruneChannelDir(dir, keep));
  }

  // De-duplicate dates across channels for a tidy summary line.
  total.removedDates = [...new Set(total.removedDates)].sort().reverse();
  return total;
}

/**
 * Total bytes currently held under the app log root. Reported at boot so an
 * operator (and we) can see the real disk cost rather than an estimate, and so
 * runaway growth is visible before it fills the disk.
 */
export async function logDirSizeBytes(root: string = APP_LOG_ROOT): Promise<number> {
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        await walk(full);
      } else {
        try {
          total += (await stat(full)).size;
        } catch {
          /* file vanished mid-walk — ignore */
        }
      }
    }
  };
  await walk(root);
  return total;
}

/** Human-readable byte size for the boot summary line. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
