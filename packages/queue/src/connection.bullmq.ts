import IORedis from 'ioredis';

// BullMQ recommends separate connections for workers vs queue producers, because
// workers use blocking commands (BRPOPLPUSH, etc.) that hold the connection.
//   - getQueueConnection() — shared singleton for producers (enqueue, add, etc.)
//   - getWorkerConnection() — new connection per call, for Worker instances

const redisOptions = () => ({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
  retryStrategy(times: number) {
    if (times > 10) {
      console.error('[Redis] Max retries exceeded, giving up');
      return null;
    }
    return Math.min(times * 200, 5000);
  },
});

let queueConnection: IORedis | null = null;
const workerConnections = new Set<IORedis>();

export function getQueueConnection(): IORedis {
  if (!queueConnection) {
    queueConnection = new IORedis(redisOptions());
    queueConnection.on('error', (err) => {
      console.error('[Redis queue] Connection error:', err.message);
    });
  }
  return queueConnection;
}

export function getWorkerConnection(): IORedis {
  const c = new IORedis(redisOptions());
  c.on('error', (err) => {
    console.error('[Redis worker] Connection error:', err.message);
  });
  workerConnections.add(c);
  c.on('end', () => workerConnections.delete(c));
  return c;
}

// Backward-compatible alias — points to the queue (producer) connection.
// Existing callers keep working; new code should pick the explicit factory.
export const getRedisConnection = getQueueConnection;

export async function closeRedisConnection(): Promise<void> {
  const closers: Promise<unknown>[] = [];
  if (queueConnection) {
    closers.push(queueConnection.quit().catch((err) => console.error('[Redis queue] close error:', err)));
    queueConnection = null;
  }
  for (const c of workerConnections) {
    closers.push(c.quit().catch((err) => console.error('[Redis worker] close error:', err)));
  }
  workerConnections.clear();
  await Promise.all(closers);
}
