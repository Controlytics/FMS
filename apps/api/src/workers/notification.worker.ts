/**
 * Notification task handler — drains the `notification` graphile-worker
 * queue and dispatches via `notification-dispatcher.dispatchNotification`.
 *
 * Wires up the consumer half of the producer/consumer pair flagged in the
 * 2026-05-12 deep-review audit. The `enqueueNotificationJob` producer in
 * `data-ingestion/ingestion.service.ts:65` enqueues to task name
 * `'notification'`, but `apps/api/src/app.ts` was previously registering a
 * `taskList` without that key (with a TODO comment admitting the gap).
 * Result: jobs accumulated in `graphile_worker.jobs` forever, with growth
 * rate = alarm/rule-chain notification volume.
 *
 * Producer enqueues two distinct task-name strings through this handler:
 *
 *   - `'alarm_notification'` (ingestion.service.ts:841, Stage 11):
 *     fires when an incoming MQTT message has `messageType === 'ALARM'`.
 *     Payload `type` is set to `'ALARM'` in the producer.
 *
 *   - `'rule_chain_notification'` (ingestion.service.ts:389, Stage 8):
 *     fires for the rule-chain `send_notification` action node. Payload
 *     carries `type`, `title`, `message`, `targetRole`, `metadata`.
 *
 * Both go through the same `'notification'` graphile-worker task name (set
 * by `enqueueNotificationJob`). This handler distinguishes them by the
 * payload shape and maps to the appropriate dispatcher `eventType` so the
 * dispatcher's template engine can render the right email/SMS body.
 *
 * Failure semantics: errors from `dispatchNotification` propagate to
 * graphile-worker which retries the job per
 * `QUEUES.NOTIFICATION.defaultJobOptions.attempts` (currently 3). After that
 * the job is moved to graphile-worker's failed-jobs table — operators can
 * inspect it manually. NEVER swallow the error here; that's the bug this
 * consumer exists to close.
 */
import type { Task } from 'graphile-worker';
import { dispatchNotification } from '../modules/notification-delivery/notification-dispatcher.js';
import { prisma } from '../lib/prisma.js';

/**
 * Producer's payload shape. Both `alarm_notification` and
 * `rule_chain_notification` enqueue this object (with task name being
 * descriptive only — graphile-worker dispatches by task name, not by
 * `payload.type`).
 */
export interface NotificationJobPayload {
  type: string;
  entityId: string;
  title: string;
  message: string;
  targetRole?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Map a queue payload to a dispatcher event. Choice of `eventType` controls
 * which template the dispatcher renders (see EVENT_FIELDS in
 * notification-dispatcher.ts).
 *
 *   payload.type === 'ALARM'  →  ALARM_CREATED  (Stage 11 alarm-message path)
 *   otherwise                 →  RULE_CHAIN_TRIGGERED  (rule-chain action)
 */
function selectEventType(payload: NotificationJobPayload): string {
  if (payload.type === 'ALARM') return 'ALARM_CREATED';
  return 'RULE_CHAIN_TRIGGERED';
}

/**
 * Flatten queue payload + metadata into the dispatcher's
 * `variables: Record<string, string>` contract. Templates render against
 * named keys, so we string-cast every metadata value.
 */
function buildVariables(payload: NotificationJobPayload, entityName: string | null): Record<string, string> {
  const variables: Record<string, string> = {
    entityId: payload.entityId,
    title: payload.title ?? '',
    message: payload.message ?? '',
    timestamp: new Date().toISOString(),
  };

  if (entityName) variables.entityName = entityName;
  if (payload.targetRole) variables.targetRole = payload.targetRole;

  if (payload.metadata && typeof payload.metadata === 'object') {
    for (const [k, v] of Object.entries(payload.metadata)) {
      variables[k] = String(v ?? '');
    }
  }

  return variables;
}

function isNotificationJobPayload(payload: unknown): payload is NotificationJobPayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return typeof p.type === 'string' && typeof p.entityId === 'string';
}

/**
 * The task handler. graphile-worker calls this for every job posted under
 * task name `'notification'`. Throws to retry; returns to mark complete.
 */
export const notificationTask: Task = async (rawPayload, helpers) => {
  // Defensive payload validation. graphile-worker's payloads are typed as
  // unknown — consumers downstream of an enqueue typo can fail in unhelpful
  // ways without an explicit shape check.
  if (!isNotificationJobPayload(rawPayload)) {
    helpers.logger.error(
      `[notification] Invalid payload — expected { type, entityId, ... }. Got: ${JSON.stringify(rawPayload).slice(0, 200)}`,
    );
    throw new Error('Invalid notification payload');
  }
  const payload = rawPayload;

  // Resolve entity name if we have an entityId. Best-effort: failure to
  // look up the entity should NOT block dispatch — the templates fall back
  // to entityId when entityName is absent. Do NOT swallow other errors.
  let entityName: string | null = null;
  if (payload.entityId) {
    try {
      const entity = await prisma.assetInstance.findUnique({
        where: { id: payload.entityId },
        select: { name: true },
      });
      entityName = entity?.name ?? null;
    } catch (err) {
      // Entity lookup failure is logged but not fatal — the entityName
      // fallback handles the missing-name case. Re-throwing here would
      // poison the entire notification dispatch over a name lookup.
      helpers.logger.warn(
        `[notification] entity lookup failed for ${payload.entityId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const eventType = selectEventType(payload);
  const variables = buildVariables(payload, entityName);

  // Dispatch — errors propagate to graphile-worker for retry per
  // QUEUES.NOTIFICATION.attempts (= 3).
  await dispatchNotification({
    eventType,
    context: {
      jobType: payload.type,
      ...(payload.targetRole ? { targetRole: payload.targetRole } : {}),
    },
    variables,
  });

  helpers.logger.info(`[notification] dispatched ${eventType} for entity ${payload.entityId}`);
};
