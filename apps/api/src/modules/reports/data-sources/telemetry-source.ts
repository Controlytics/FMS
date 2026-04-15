import { getTsdbPool } from '@digilog/db';
import type { ResolutionContext, ResolvedValue } from './timestamp-source.js';

const WINDOW_MS: Record<string, number> = {
  '1h': 3600_000,
  '6h': 21600_000,
  '24h': 86400_000,
  '7d': 604800_000,
  '30d': 2592000_000,
};

function parseWindow(window: string): number {
  return WINDOW_MS[window] ?? 86400_000;
}

export async function resolveTelemetry(
  slotRef: string,
  key: string,
  modifier: string,
  ctx: ResolutionContext,
): Promise<ResolvedValue> {
  const slotName = slotRef.startsWith('$') ? slotRef.slice(1) : slotRef;
  const entityId = ctx.entitySlots[slotName];
  if (!entityId) {
    return { value: null, error: `Entity slot "${slotName}" not found` };
  }

  const pool = getTsdbPool();

  if (modifier === 'last') {
    const result = await pool.query(
      `SELECT value_num, value_str FROM ts_telemetry
       WHERE entity_id = $1 AND key = $2
       ORDER BY time DESC LIMIT 1`,
      [entityId, key],
    );
    const row = result.rows[0];
    if (!row) return { value: null };
    return { value: row.value_num ?? row.value_str };
  }

  if (modifier === 'first') {
    const result = await pool.query(
      `SELECT value_num, value_str FROM ts_telemetry
       WHERE entity_id = $1 AND key = $2 AND time >= $3 AND time <= $4
       ORDER BY time ASC LIMIT 1`,
      [entityId, key, ctx.timeRange.start, ctx.timeRange.end],
    );
    const row = result.rows[0];
    if (!row) return { value: null };
    return { value: row.value_num ?? row.value_str };
  }

  if (modifier === 'range') {
    const result = await pool.query(
      `SELECT time AS timestamp, value_num AS value, value_str
       FROM ts_telemetry
       WHERE entity_id = $1 AND key = $2 AND time >= $3 AND time <= $4
       ORDER BY time ASC`,
      [entityId, key, ctx.timeRange.start, ctx.timeRange.end],
    );
    return { value: result.rows };
  }

  const aggMatch = modifier.match(/^(avg|min|max|sum|count):(.+)$/);
  if (aggMatch) {
    const [, aggFn, window] = aggMatch;
    const windowMs = parseWindow(window);
    const since = new Date(Date.now() - windowMs);
    const sqlFn = aggFn.toUpperCase();

    const result = await pool.query(
      `SELECT ${sqlFn}(value_num) AS result FROM ts_telemetry
       WHERE entity_id = $1 AND key = $2 AND time >= $3`,
      [entityId, key, since],
    );
    const val = result.rows[0]?.result;
    return { value: val !== null && val !== undefined ? Number(val) : null };
  }

  return { value: null, error: `Unknown telemetry modifier: ${modifier}` };
}
