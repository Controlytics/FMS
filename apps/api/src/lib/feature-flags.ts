export const FLAGS = {
  USE_MOSQUITTO: 'USE_MOSQUITTO',
  USE_PG_QUEUE: 'USE_PG_QUEUE',
  USE_EDGE_PDF: 'USE_EDGE_PDF',
} as const;

export type FeatureFlag = (typeof FLAGS)[keyof typeof FLAGS];

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  const raw = process.env[flag];
  if (!raw) return false;
  return raw === 'true' || raw === '1' || raw.toLowerCase() === 'yes';
}
