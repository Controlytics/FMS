/**
 * Format a numeric value to the decimal precision of its least count.
 *
 * - leastCount = 1     → "25"
 * - leastCount = 0.5   → "25.0"
 * - leastCount = 0.1   → "25.0"
 * - leastCount = 0.01  → "25.00"
 *
 * Used for equipment-group instrument limits and readings so the displayed
 * precision always matches the instrument's least count — online and offline.
 */

export function getLeastCountDecimals(leastCount: number | null | undefined): number {
  const lc = Number(leastCount);
  if (!lc || lc <= 0 || !isFinite(lc)) return 0;
  const str = lc.toString();
  if (str.includes('e-')) {
    // e.g. 1e-3 → 3 decimals
    const exp = parseInt(str.split('e-')[1], 10);
    return isNaN(exp) ? 0 : exp;
  }
  if (!str.includes('.')) return 0;
  return str.split('.')[1].length;
}

export function formatByLeastCount(
  value: number | string | null | undefined,
  leastCount: number | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (!isFinite(num)) return String(value);
  return num.toFixed(getLeastCountDecimals(leastCount));
}

/**
 * A RECORDED reading, shown exactly as stored (operator decision 2026-10-22):
 * padded to the least count's precision, never rounded to it. An instrument
 * can report finer than its configured least count (an auto-fetched 60.04 °C
 * on a 0.1 dryer), and formatByLeastCount showed that as "60.0" while the
 * record held 60.04. formatByLeastCount stays right for configured limits and
 * dropdown options, which sit on the least-count grid.
 */
export function formatRecordedReading(
  value: number | string | null | undefined,
  leastCount: number | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (!isFinite(num)) return String(value);
  const shortest = String(num); // the shortest text that reads back as exactly this number
  if (shortest.includes('e')) return shortest;
  const ownDecimals = shortest.includes('.') ? shortest.split('.')[1].length : 0;
  return num.toFixed(Math.max(ownDecimals, getLeastCountDecimals(leastCount)));
}
