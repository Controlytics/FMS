/**
 * PgBoss Connection — Singleton instance backed by PostgreSQL.
 * Replaces BullMQ + Redis with pg-boss for job queue management.
 */

import PgBoss from 'pg-boss';

let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (!boss) {
    boss = new PgBoss({
      connectionString: process.env.DATABASE_URL!,
      schema: 'pgboss',
      retryLimit: 3,
      retryDelay: 5,
      expireInHours: 24,
      archiveCompletedAfterSeconds: 86400,
      deleteAfterDays: 7,
    });
    await boss.start();
  }
  return boss;
}

export async function closePgBoss(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = null;
  }
}
