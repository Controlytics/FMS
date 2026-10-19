/**
 * Delivery Service — Core notification dispatching with logging and retry.
 * This is the main entry point for sending notifications.
 */

import { prisma } from '../../lib/prisma.js';
import { emailChannel } from './channels/email-channel.js';
import { smsChannel } from './channels/sms-channel.js';
import { resolveTemplate } from './template-engine.js';
import { formatConfiguredDateTime } from '../../lib/format-datetime.js';
import type { NotificationPayload, DeliveryResult, NotificationChannel } from './types.js';
import { getLogger } from '../../lib/logger.js';

/** Log type 6. NOTE: `log` is already a local variable in this file (a
 *  NotificationLog row), hence the distinct name. */
const deliveryLog = getLogger('notification-delivery', 'services');

const channels: Record<string, NotificationChannel> = {
  EMAIL: emailChannel,
  SMS: smsChannel,
};

const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 15000, 45000]; // exponential-ish backoff

/**
 * Send a notification through the specified channel with logging and retry.
 */
export async function sendNotification(payload: NotificationPayload): Promise<DeliveryResult> {
  const channel = channels[payload.channel];
  if (!channel) {
    return { success: false, error: `Unknown channel: ${payload.channel}` };
  }

  // Resolve template variables if provided
  let message = payload.message;
  let subject = payload.subject;
  if (payload.variables && Object.keys(payload.variables).length > 0) {
    message = resolveTemplate(message, payload.variables);
    if (subject) subject = resolveTemplate(subject, payload.variables);
  }

  // Create log entry
  const log = await prisma.notificationLog.create({
    data: {
      channel: payload.channel,
      recipient: payload.recipient,
      subject,
      message,
      templateId: payload.templateId,
      status: 'PENDING',
      maxRetries: MAX_RETRIES,
      triggeredBy: payload.triggeredBy,
      metadata: payload.metadata as any,
    },
  });

  // Attempt delivery
  const resolvedPayload = { ...payload, message, subject };
  const result = await channel.send(resolvedPayload);

  if (result.success) {
    await prisma.notificationLog.update({
      where: { id: log.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        metadata: { ...(payload.metadata as any ?? {}), messageId: result.messageId } as any,
      },
    });
  } else {
    // Schedule retry
    const nextRetryAt = new Date(Date.now() + RETRY_DELAYS[0]);
    await prisma.notificationLog.update({
      where: { id: log.id },
      data: {
        status: 'RETRYING',
        errorMessage: result.error,
        retryCount: 1,
        nextRetryAt,
      },
    });

    // Fire-and-forget retry (don't block the caller)
    // Fire-and-forget retry (don't block the caller) — but log failures so
    // a broken retry path doesn't silently drop notifications.
    scheduleRetry(log.id, resolvedPayload, 1).catch((schedErr) => {
      deliveryLog.error({ err: schedErr, logId: log.id, attempt: 1 }, 'scheduleRetry failed');
    });
  }

  return result;
}

/**
 * Retry a failed notification delivery.
 * Retries live in this process (setTimeout); a restart kills them. What a dead
 * process left RETRYING is closed at boot by failStrandedRetries() (C-11).
 */
async function scheduleRetry(logId: string, payload: NotificationPayload, attempt: number): Promise<void> {
  if (attempt >= MAX_RETRIES) {
    await prisma.notificationLog.update({
      where: { id: logId },
      data: { status: 'FAILED', nextRetryAt: null },
    });
    return;
  }

  // C-11 (QA 2026-10-19): attempt N waits RETRY_DELAYS[N-1]. It used to wait
  // RETRY_DELAYS[N], so the row said 'retry in 5 s' (nextRetryAt) while the code
  // slept 15 s, and the 5 s delay was never used.
  const delay = RETRY_DELAYS[attempt - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
  await new Promise((resolve) => setTimeout(resolve, delay));

  const channel = channels[payload.channel];
  if (!channel) return;

  const result = await channel.send(payload);

  if (result.success) {
    await prisma.notificationLog.update({
      where: { id: logId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        errorMessage: null,
        nextRetryAt: null,
        metadata: { ...(payload.metadata as any ?? {}), messageId: result.messageId } as any,
      },
    });
  } else {
    const nextAttempt = attempt + 1;
    if (nextAttempt >= MAX_RETRIES) {
      await prisma.notificationLog.update({
        where: { id: logId },
        data: {
          status: 'FAILED',
          errorMessage: result.error,
          retryCount: nextAttempt,
          nextRetryAt: null,
        },
      });
    } else {
      const nextRetryAt = new Date(Date.now() + (RETRY_DELAYS[nextAttempt - 1] ?? 60000));
      await prisma.notificationLog.update({
        where: { id: logId },
        data: {
          status: 'RETRYING',
          errorMessage: result.error,
          retryCount: nextAttempt,
          nextRetryAt,
        },
      });
      scheduleRetry(logId, payload, nextAttempt).catch((schedErr) => {
        deliveryLog.error({ err: schedErr, logId, attempt: nextAttempt }, 'scheduleRetry failed');
      });
    }
  }
}

/**
 * C-11 (QA 2026-10-19): a RETRYING row at boot was left by a process that died
 * with its retry timers (there is no durable queue since graphile-worker went,
 * 2026-08-26), so it would stay RETRYING forever and look in-flight on the
 * notification log page. Close it as FAILED with the reason, so an admin sees it
 * and can resend. Deliberately NOT re-sent automatically: a send that partly
 * succeeded before the crash would be delivered twice.
 * Call once at startup, before any new notification is sent.
 */
export async function failStrandedRetries(): Promise<{ failed: number }> {
  const r = await prisma.notificationLog.updateMany({
    where: { status: 'RETRYING' },
    data: { status: 'FAILED', nextRetryAt: null, errorMessage: 'Retry interrupted by a server restart; not re-sent automatically.' },
  });
  return { failed: r.count };
}

/**
 * Test a notification channel connection/configuration.
 */
export async function testChannel(channelName: 'EMAIL' | 'SMS'): Promise<DeliveryResult> {
  const channel = channels[channelName];
  if (!channel) return { success: false, error: `Unknown channel: ${channelName}` };
  return channel.testConnection();
}

/**
 * Send a test notification to verify end-to-end delivery.
 */
export async function sendTestNotification(
  channelName: 'EMAIL' | 'SMS',
  recipient: string,
): Promise<DeliveryResult> {
  // Timestamp honours the Date/Time config (IST by default), not UTC.
  const ts = await formatConfiguredDateTime(new Date());
  return sendNotification({
    channel: channelName,
    recipient,
    subject: 'DigiLog Test Notification',
    message: channelName === 'EMAIL'
      ? `<p>This is a <strong>test notification</strong> from DigiLog.</p><p>If you received this email, your email notification settings are configured correctly.</p><p>Timestamp: ${ts}</p>`
      : `DigiLog Test: Your SMS notification is configured correctly. Timestamp: ${ts}`,
    triggeredBy: 'manual',
    metadata: { test: true },
  });
}
