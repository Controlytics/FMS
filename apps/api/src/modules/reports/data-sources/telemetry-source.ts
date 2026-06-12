// Telemetry source removed with data-ingestion removal.
// All {{ts.<slot>.<key>}} tags in report templates now resolve to null with
// an explanatory error. The function signature is preserved so the variable
// resolver doesn't need to know telemetry is gone.
import type { ResolutionContext, ResolvedValue } from './timestamp-source.js';

export async function resolveTelemetry(
  _slotRef: string,
  _key: string,
  _modifier: string,
  _ctx: ResolutionContext,
): Promise<ResolvedValue> {
  return {
    value: null,
    error: 'Telemetry data source has been removed.',
  };
}
