/**
 * Filenames for downloaded reports (2026-09-03).
 *
 * Eleven call sites were building these by hand, most as
 * `` `thing-${new Date().toISOString().slice(0, 10)}` ``, and three embedded raw
 * user data. Two things were wrong with that:
 *
 *  1. **Date only.** Two exports of the same report on the same day collided, so
 *     the browser silently appended " (1)" and the operator could not tell which
 *     file was which. The operator asked for the time as well.
 *  2. **UTC.** `toISOString()` is UTC, and this deployment runs at UTC+5:30, so
 *     anything exported between 00:00 and 05:30 local was stamped with the
 *     PREVIOUS day. Adding a UTC time would have compounded it — a 09:00 export
 *     reading `03-30-00`. These stamps are LOCAL now, matching both the wall
 *     clock and the configured `Asia/Kolkata` display timezone.
 */

/** Windows forbids `\ / : * ? " < > |`; `:` also breaks the time, hence `-`. */
const UNSAFE = /[\\/:*?"<>|]+/g;

/**
 * Make one path segment safe to put in a filename.
 *
 * This is not cosmetic. `cycle.filterName` is a hierarchy path like
 * `CWH/F1/AHU-0B/SA/05/06-01`, and `formatDate` returns `03/09/2026` under the
 * configured DD/MM/YYYY — both went into filenames verbatim. Browsers sanitise
 * a download name rather than fail, so the result was a mangled name that
 * differed by browser instead of an error anyone would notice.
 */
export function safeFilePart(value: string): string {
  return String(value ?? '')
    .replace(UNSAFE, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `YYYY-MM-DD_HH-mm-ss` in LOCAL time — sortable, and unique per second so
 * repeated exports of the same report no longer collide.
 */
export function downloadStamp(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
    + `_${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`;
}

/**
 * Full download filename, WITHOUT the extension.
 *
 * `downloadName('audit-trail')` -> `audit-trail_2026-09-03_15-42-10`
 * `downloadName('cycle', 'CWH/F1/AHU-0B')` -> `cycle-CWH-F1-AHU-0B_2026-…`
 *
 * Extra parts are sanitised and joined with `-`; empty ones are dropped so a
 * missing filter name cannot leave a dangling separator.
 */
export function downloadName(...parts: (string | null | undefined)[]): string {
  const base = parts.map((p) => safeFilePart(p ?? '')).filter(Boolean).join('-');
  return `${base || 'export'}_${downloadStamp()}`;
}
