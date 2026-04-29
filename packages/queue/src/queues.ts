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
