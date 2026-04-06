export const QUEUES = {
  INGESTION: {
    name: 'ingestion',
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 500 },
      removeOnComplete: 100,
      removeOnFail: 1000,
    },
  },
  NOTIFICATION: {
    name: 'notification',
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5000 },
      removeOnComplete: 50,
      removeOnFail: 500,
    },
  },
  EXPORT: {
    name: 'export',
    defaultJobOptions: {
      attempts: 2,
      timeout: 300000, // 5 minute timeout
      removeOnComplete: 20,
      removeOnFail: 100,
    },
  },
  REPORTS: {
    // FUTURE SCOPE — queue defined now, worker built later
    name: 'reports',
    defaultJobOptions: {
      attempts: 2,
      timeout: 600000, // 10 minute timeout
      removeOnComplete: 20,
      removeOnFail: 100,
    },
  },
  MAINTENANCE: {
    name: 'maintenance',
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 10,
      removeOnFail: 100,
    },
  },
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]['name'];
