/**
 * Feature flags for the Windows-friendly rewrite migration.
 *
 * Each flag gates a Phase 1–3 code path so old + new can run side by side
 * during cut-over. Default off; set to "true"/"yes"/"1" (case-insensitive,
 * whitespace-tolerant) to enable. Remove the flag from the corresponding
 * `.env` and the import sites once a phase has been merged and validated.
 *
 * See `docs/plans/2026-04-29-windows-friendly-rewrite.md` for the full plan.
 */
export const FEATURE_FLAGS = {
  USE_MOSQUITTO: 'USE_MOSQUITTO',
  USE_PG_QUEUE: 'USE_PG_QUEUE',
  USE_EDGE_PDF: 'USE_EDGE_PDF',
} as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  const raw = process.env[flag];
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}
