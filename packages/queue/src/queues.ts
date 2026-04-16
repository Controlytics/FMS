/**
 * Queue Definitions — pgboss queue names and options.
 * Only INGESTION is actively used. Others defined for future scope.
 */

export const QUEUES = {
  INGESTION: 'ingestion',
  NOTIFICATION: 'notification',
  EXPORT: 'export',
  REPORTS: 'reports',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Default send options per queue */
export const QUEUE_OPTIONS: Record<string, Record<string, unknown>> = {
  [QUEUES.INGESTION]: { retryLimit: 3, retryBackoff: true, retryDelay: 1 },
  [QUEUES.NOTIFICATION]: { retryLimit: 3, retryDelay: 5 },
  [QUEUES.EXPORT]: { retryLimit: 2, expireInSeconds: 300 },
  [QUEUES.REPORTS]: { retryLimit: 2, expireInSeconds: 600 },
};
