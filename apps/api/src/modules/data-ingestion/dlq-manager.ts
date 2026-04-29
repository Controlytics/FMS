/**
 * Dead Letter Queue Manager — Stores failed pipeline messages and handles retries.
 * DLQ entries are stored in PostgreSQL (dead_letter_queue table).
 * Maintenance job re-enqueues PENDING entries older than 5 minutes.
 * After max retries → status = DEAD, creates CRITICAL alarm if depth > threshold.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { JOB_PRIORITY } from '@digilog/queue';
import type { IngestionMessage } from './message-normalizer.js';
import { getConfigOrDefault } from './ingestion-config.service.js';
import { enqueueIngestionJob } from './ingestion.service.js';

/** Add a failed message to the DLQ. */
export async function addToDLQ(
  message: IngestionMessage,
  errorMessage: string,
  errorStage: string,
): Promise<void> {
  await prisma.deadLetterQueue.create({
    data: {
      messageId: message.messageId,
      entityId: message.entityId || null,
      messageType: message.messageType,
      payload: JSON.parse(JSON.stringify(message)) as Prisma.InputJsonValue,
      errorMessage,
      errorStage,
      retryCount: 0,
      maxRetries: 3,
      status: 'PENDING',
    },
  });
}

/** Process DLQ: re-enqueue PENDING items older than 5 minutes, mark DEAD after max retries. */
export async function processDLQ(): Promise<{ requeued: number; dead: number }> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  let requeued = 0;
  let dead = 0;

  // Find PENDING entries older than 5 minutes
  const pendingEntries = await prisma.deadLetterQueue.findMany({
    where: {
      status: { in: ['PENDING', 'RETRYING'] },
      createdAt: { lt: fiveMinAgo },
    },
    orderBy: { createdAt: 'asc' },
    take: 50, // Process in batches
  });

  for (const entry of pendingEntries) {
    if (entry.retryCount >= entry.maxRetries) {
      // Max retries exceeded → mark as DEAD
      await prisma.deadLetterQueue.update({
        where: { id: entry.id },
        data: { status: 'DEAD' },
      });
      dead++;
      continue;
    }

    // Re-enqueue to ingestion queue
    try {
      const payload = entry.payload as unknown as IngestionMessage;
      await enqueueIngestionJob(payload.messageType, payload, {
        priority: JOB_PRIORITY.TELEMETRY,
        jobId: `dlq-retry-${entry.id}-${entry.retryCount + 1}`,
      });

      await prisma.deadLetterQueue.update({
        where: { id: entry.id },
        data: {
          status: 'RETRYING',
          retryCount: { increment: 1 },
        },
      });

      requeued++;
    } catch (err) {
      console.error(`[DLQ] Failed to re-enqueue ${entry.id}:`, err);
    }
  }

  // Check DLQ depth threshold for CRITICAL alarm
  const dlqThreshold = await getConfigOrDefault<number>('pipeline.dlq_alarm_threshold', 100);
  const dlqDepth = await prisma.deadLetterQueue.count({
    where: { status: { in: ['PENDING', 'RETRYING'] } },
  });

  if (dlqDepth > dlqThreshold) {
    // Create a critical alarm for DLQ overflow
    try {
      await prisma.alarm.create({
        data: {
          entityId: '00000000-0000-0000-0000-000000000000', // System entity
          alarmType: 'DLQ_OVERFLOW',
          severity: 'CRITICAL',
          status: 'ACTIVE',
          unsPath: 'system/dlq',
          triggerDetails: { dlqDepth, threshold: dlqThreshold } as Prisma.InputJsonValue,
        },
      });
    } catch {
      // Alarm creation failure is non-critical
    }
  }

  return { requeued, dead };
}

/** Mark a DLQ entry as resolved (successfully reprocessed). */
export async function resolveDLQEntry(messageId: string): Promise<void> {
  await prisma.deadLetterQueue.updateMany({
    where: { messageId, status: { in: ['PENDING', 'RETRYING'] } },
    data: { status: 'RESOLVED' },
  });
}

/** Get DLQ stats. */
export async function getDLQStats(): Promise<{
  pending: number;
  retrying: number;
  dead: number;
  resolved: number;
  total: number;
}> {
  const [pending, retrying, dead, resolved] = await Promise.all([
    prisma.deadLetterQueue.count({ where: { status: 'PENDING' } }),
    prisma.deadLetterQueue.count({ where: { status: 'RETRYING' } }),
    prisma.deadLetterQueue.count({ where: { status: 'DEAD' } }),
    prisma.deadLetterQueue.count({ where: { status: 'RESOLVED' } }),
  ]);

  return { pending, retrying, dead, resolved, total: pending + retrying + dead + resolved };
}
