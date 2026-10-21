/**
 * A-15 (2026-10-21): the dispatcher's in-app insert must only ever write a
 * NotificationType enum value. It used to insert `type: eventType as any` with
 * `eventType: string`; an event outside the enum reached Postgres, failed the
 * enum check and the row was lost (QA-D005 is the same failure, five months
 * long). Prisma is mocked here — a plain object, so the insert can be watched.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const m = vi.hoisted(() => ({
  prisma: {
    notificationRule: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    userGroupMember: { findMany: vi.fn(async () => []) },
    notificationTemplate: { findUnique: vi.fn(async () => null) },
    systemConfig: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    notification: { create: vi.fn(async () => ({ id: 'n1' })) },
  },
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: m.prisma }));

import { dispatchNotification } from '../notification-dispatcher.js';

const rule = {
  id: 'r1', name: 'cov guard rule', eventType: 'DEVICE_OFFLINE', eventTypes: ['DEVICE_OFFLINE'], conditions: {},
  emailEnabled: false, smsEnabled: false, inAppEnabled: true, emailTemplateId: null, smsTemplateId: null,
  cooldownMinutes: 0, priority: 0, isActive: true,
  recipients: [{ recipientType: 'USER', userId: 'u1', roleValue: null, groupId: null }],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.notificationRule.findMany.mockResolvedValue([rule]);
  m.prisma.user.findMany.mockResolvedValue([{ id: 'u1', username: 'alice', email: null, fullName: 'Alice' }]);
});

describe('dispatcher in-app insert — NotificationType only', () => {
  it('writes a valid event type through, addressed by username', async () => {
    await dispatchNotification({ eventType: 'DEVICE_OFFLINE', context: {}, variables: { deviceName: 'Pump' } });
    expect(m.prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(m.prisma.notification.create.mock.calls[0][0]).toMatchObject({
      data: { type: 'DEVICE_OFFLINE', forUserId: 'alice', title: 'cov guard rule', message: 'Device Pump went offline' },
    });
  });

  it('never attempts the insert for a type outside the enum (logged and skipped)', async () => {
    // only reachable through an untyped caller (or a test fire with a cast)
    await expect(dispatchNotification({ eventType: 'CUSTOM_EVT' as never, context: {}, variables: {}, forceRuleId: 'r1' })).resolves.toBeUndefined();
    expect(m.prisma.notification.create).not.toHaveBeenCalled();
  });
});
