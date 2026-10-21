/**
 * Server-side date/time formatter that honours the admin "Date/Time Format"
 * config (system_config key `datetime`: dateFormat / timeFormat / timezone).
 *
 * Mirrors the frontend `useDatetimeFormat` hook so a value rendered in a
 * notification message (built server-side at emit time) matches what the UI
 * shows everywhere else. Default timezone is Asia/Kolkata (IST), NOT UTC.
 */
import { prisma } from './prisma.js';

interface DatetimeConfig {
  dateFormat: string;
  timeFormat: string;
  timezone: string;
}

// Matches datetime.def.ts defaults (stored config wins; this is only the
// fallback when the row is missing).
const DEFAULT_CONFIG: DatetimeConfig = {
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '12-hour',
  timezone: 'Asia/Kolkata',
};

// A fixed table, never ICU's `month: 'short'`: en-GB prints "Sept" on ICU 72+
// (Node 24) but "Sep" on older WebViews, so the server PDF and the tablet could
// disagree (2026-10-21). Kept identical to apps/web use-datetime-format.
const MONTHS_3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Day / month / year as numbers, in the configured zone. */
function zonedParts(date: Date, timezone: string): { day: number; month: number; year: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { day: get('day'), month: get('month'), year: get('year') };
}

function formatDateValue(date: Date, dateFormat: string, timezone: string): string {
  const opts: Intl.DateTimeFormatOptions = { timeZone: timezone };
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (dateFormat) {
    case 'DD/MM/YYYY':
      return date.toLocaleDateString('en-GB', { ...opts });
    case 'MM/DD/YYYY': {
      // Zero-padded like every other numeric format (en-US alone prints 6/15/2026).
      const { day, month, year } = zonedParts(date, timezone);
      return `${pad(month)}/${pad(day)}/${year}`;
    }
    case 'YYYY-MM-DD': {
      const y = date.toLocaleString('en-US', { year: 'numeric', timeZone: timezone });
      const m = date.toLocaleString('en-US', { month: '2-digit', timeZone: timezone });
      const d = date.toLocaleString('en-US', { day: '2-digit', timeZone: timezone });
      return `${y}-${m}-${d}`;
    }
    case 'DD-MMM-YYYY': {
      const { day, month, year } = zonedParts(date, timezone);
      return `${pad(day)}-${MONTHS_3[month - 1]}-${year}`;
    }
    case 'MMM DD, YYYY':
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...opts });
    default:
      return date.toLocaleDateString('en-GB', { ...opts });
  }
}

function formatTimeValue(date: Date, timeFormat: string, timezone: string): string {
  if (timeFormat === '12-hour') {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: timezone });
  }
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone });
}

/** Read the stored datetime config (flat shape), falling back to defaults. */
export async function getDatetimeConfig(): Promise<DatetimeConfig> {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'datetime' } });
    const v = (row?.configValue as Partial<DatetimeConfig> | null) ?? {};
    return {
      dateFormat: v.dateFormat || DEFAULT_CONFIG.dateFormat,
      timeFormat: v.timeFormat || DEFAULT_CONFIG.timeFormat,
      timezone: v.timezone || DEFAULT_CONFIG.timezone,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Synchronous variants for callers that format MANY values (Excel exports,
 * import result lists): read the config once with getDatetimeConfig(), then
 * format each row without a DB round-trip. Same output as the async pair.
 */
export function formatDateWith(cfg: DatetimeConfig, value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '';
  try { return formatDateValue(date, cfg.dateFormat, cfg.timezone); }
  catch { return formatDateValue(date, cfg.dateFormat, 'UTC'); }
}

export function formatDateTimeWith(cfg: DatetimeConfig, value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '';
  try { return `${formatDateValue(date, cfg.dateFormat, cfg.timezone)} ${formatTimeValue(date, cfg.timeFormat, cfg.timezone)}`; }
  catch { return `${formatDateValue(date, cfg.dateFormat, 'UTC')} ${formatTimeValue(date, cfg.timeFormat, 'UTC')}`; }
}

/** "DD/MM/YYYY hh:mm AM" in the configured timezone (IST by default). */
export async function formatConfiguredDateTime(value: Date | string): Promise<string> {
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '';
  const cfg = await getDatetimeConfig();
  try {
    return `${formatDateValue(date, cfg.dateFormat, cfg.timezone)} ${formatTimeValue(date, cfg.timeFormat, cfg.timezone)}`;
  } catch {
    // Invalid timezone string → fall back to UTC rather than throwing.
    return `${formatDateValue(date, cfg.dateFormat, 'UTC')} ${formatTimeValue(date, cfg.timeFormat, 'UTC')}`;
  }
}

/** Date only ("DD/MM/YYYY") in the configured timezone (IST by default). */
export async function formatConfiguredDate(value: Date | string): Promise<string> {
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '';
  const cfg = await getDatetimeConfig();
  try {
    return formatDateValue(date, cfg.dateFormat, cfg.timezone);
  } catch {
    return formatDateValue(date, cfg.dateFormat, 'UTC');
  }
}
