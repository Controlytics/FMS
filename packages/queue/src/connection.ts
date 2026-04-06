import IORedis from 'ioredis';

// TODO: BullMQ recommends separate connections for workers vs queue producers.
// Consider providing getWorkerConnection() and getQueueConnection() factories.

let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      retryStrategy(times) {
        if (times > 10) {
          console.error('[Redis] Max retries exceeded, giving up');
          return null; // stop retrying
        }
        return Math.min(times * 200, 5000); // retry with backoff, max 5s
      },
    });

    connection.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });
  }
  return connection;
}

export async function closeRedisConnection(): Promise<void> {
  if (connection) {
    try {
      await connection.quit();
    } catch (err) {
      console.error('[Redis] Error closing connection:', err);
    } finally {
      connection = null;
    }
  }
}
