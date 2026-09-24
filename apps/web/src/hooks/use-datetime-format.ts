import useSWR from 'swr';

interface DatetimeConfig {
  dateFormat: string;
  timeFormat: string;
  timezone: string;
}

// Matches datetime.def.ts (and the API's format-datetime.ts) defaults. Only
// used for the first paint before /api/config/datetime/current arrives.
const defaultConfig: DatetimeConfig = {
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '12-hour',
  timezone: 'Asia/Kolkata',
};

// Drop the year from a date already rendered by formatDateValue, keeping the
// configured day/month ORDER and separator. Used where a line cannot afford
// the year (chart axes, the tablet header, a "15/06-25/06" window range).
export function stripYear(formatted: string, dateFormat: string): string {
  switch (dateFormat) {
    case 'YYYY-MM-DD': return formatted.replace(/^\d{4}-/, '');
    case 'DD-MMM-YYYY': return formatted.replace(/-\d{4}$/, '');
    case 'MMM DD, YYYY': return formatted.replace(/,\s*\d{4}$/, '');
    case 'MM/DD/YYYY':
    case 'DD/MM/YYYY':
    default: return formatted.replace(/\/\d{4}$/, '');
  }
}

function formatDateValue(date: Date, dateFormat: string, timezone: string): string {
  try {
    const opts: Intl.DateTimeFormatOptions = { timeZone: timezone };

    switch (dateFormat) {
      case 'DD/MM/YYYY':
        return date.toLocaleDateString('en-GB', { ...opts });
      case 'MM/DD/YYYY':
        return date.toLocaleDateString('en-US', { ...opts });
      case 'YYYY-MM-DD': {
        const y = date.toLocaleString('en-US', { year: 'numeric', timeZone: timezone });
        const m = date.toLocaleString('en-US', { month: '2-digit', timeZone: timezone });
        const d = date.toLocaleString('en-US', { day: '2-digit', timeZone: timezone });
        return `${y}-${m}-${d}`;
      }
      case 'DD-MMM-YYYY':
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', ...opts }).replace(/ /g, '-');
      case 'MMM DD, YYYY':
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...opts });
      default:
        return date.toLocaleDateString('en-GB', { ...opts });
    }
  } catch {
    // Fallback to UTC if timezone is invalid
    return formatDateValue(date, dateFormat, 'UTC');
  }
}

function formatTimeValue(date: Date, timeFormat: string, timezone: string): string {
  try {
    if (timeFormat === '12-hour') {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: timezone });
    }
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone });
  } catch {
    // Fallback to UTC if timezone is invalid
    return formatTimeValue(date, timeFormat, 'UTC');
  }
}

export function useDatetimeFormat() {
  const { data } = useSWR<DatetimeConfig>('/api/config/datetime/current', {
    revalidateOnFocus: false,
    revalidateOnMount: true, dedupingInterval: 5000,
  });

  const config = data ?? defaultConfig;

  const formatDate = (value: string | Date): string => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return '';
    return formatDateValue(date, config.dateFormat, config.timezone);
  };

  const formatTime = (value: string | Date): string => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return '';
    return formatTimeValue(date, config.timeFormat, config.timezone);
  };

  const formatDateTime = (value: string | Date): string => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return '';
    return `${formatDateValue(date, config.dateFormat, config.timezone)} ${formatTimeValue(date, config.timeFormat, config.timezone)}`;
  };

  // Format a value ONLY if it is an ISO-8601 date/date-time STRING, else return
  // null so callers can fall back to their own rendering. Used to format the
  // date-like values that show up inside opaque JSON payloads (e.g. an audit
  // row's before/after `createdAt`/`updatedAt`) without needing to know the key
  // names. Value-based (not key-name) detection: a string starting with
  // YYYY-MM-DDThh:mm is unambiguously a datetime; YYYY-MM-DD (no time) is a date.
  const formatIfDate = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return formatDateTime(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
    return null;
  };

  // Day + month only, in the configured order/separator/timezone (no year).
  // Never hand-roll "DD/MM" at a call site: the operator may have picked
  // MM/DD/YYYY, and a hardcoded order silently disagrees with every other
  // screen. Returns '' for an invalid value, like the other formatters.
  const formatDayMonth = (value: string | Date): string => {
    const full = formatDate(value);
    return full ? stripYear(full, config.dateFormat) : '';
  };

  return { formatDate, formatTime, formatDateTime, formatIfDate, formatDayMonth, config };
}
