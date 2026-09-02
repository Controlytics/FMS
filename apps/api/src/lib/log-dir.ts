import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Single source of truth for where operational log files live.
 *
 * Mirrors `uploads-dir.ts` deliberately: the customer installer already creates
 * `C:\ProgramData\DigiLog\logs` (installer/DigiLog.iss) and computes it as
 * `$logDir` (scripts/install.ps1) for WinSW's service logs. Setting LOG_DIR to
 * that same path puts our files alongside the ones that catch a crash BEFORE
 * this process gets far enough to open a log file.
 *
 * Fallback (no LOG_DIR, i.e. local dev) = apps/api/logs, computed from THIS
 * file's own location so it is stable regardless of process.cwd(). Both the
 * tsx/dev path (src/lib) and the compiled path (dist/lib) resolve to the same
 * apps/api/logs.
 */
export const LOG_ROOT = process.env.LOG_DIR
  ? path.resolve(process.env.LOG_DIR)
  : path.join(__dirname, '..', '..', 'logs');

/**
 * Our own files live under `<LOG_ROOT>/app/` so they never collide with WinSW's
 * `DigiLogAPI.out.log` / `.err.log` / `.wrapper.log`, which sit directly in
 * LOG_ROOT and are rotated by WinSW on its own schedule.
 */
export const APP_LOG_ROOT = path.join(LOG_ROOT, 'app');

/**
 * Each channel gets its OWN directory — not cosmetic.
 *
 * pino-roll's `detectLastNumber()` (lib/utils.js) scans the whole directory and
 * returns the highest trailing number found on ANY file in it, not just files
 * matching this stream's base name. With `error.2026-08-31.1.log` and
 * `http.2026-08-31.7.log` side by side, the error stream would resume at number
 * 7. One directory per channel makes that scan correct by construction, and it
 * makes "show me last week's errors" a single folder.
 */
export function channelDir(channel: string): string {
  // Business-module channels are namespaced `mod:<name>` so they can never
  // collide with a core channel name (a module called "http" would otherwise
  // write into the HTTP channel's directory).
  if (channel.startsWith('mod:')) {
    return path.join(APP_LOG_ROOT, 'modules', channel.slice(4));
  }
  return path.join(APP_LOG_ROOT, channel);
}

/**
 * Base file name (no date, no sequence number, no extension) for a channel.
 * pino-roll appends `.<yyyy-MM-dd>.<n>.log`.
 */
export function channelBaseName(channel: string): string {
  return channel.startsWith('mod:') ? channel.slice(4) : channel;
}
