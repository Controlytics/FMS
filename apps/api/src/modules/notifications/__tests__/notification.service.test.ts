import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockNotifRepo } = vi.hoisted(() => ({
  mockNotifRepo: {
    findMany: vi.fn(),
    count: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    markRead: vi.fn(),
    markUnread: vi.fn(),
    markAllRead: vi.fn(),
    bulkMarkRead: vi.fn(),
    bulkMarkUnread: vi.fn(),
    delete: vi.fn(),
    bulkDelete: vi.fn(),
  },
}));

vi.mock('../notification.repository.js', () => ({ notificationRepository: mockNotifRepo }));

import { notificationService, createNotification } from '../notification.service.js';

describe('notificationService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('createNotification', () => {
    it('creates notification via repository', async () => {
      mockNotifRepo.create.mockResolvedValue({ id: 'n1', title: 'Test' });

      const result = await createNotification({
        type: 'USER_CREATED', title: 'Test', message: 'Msg',
        targetUserId: 'u1', forRole: 'ADMIN',
      });

      expect(mockNotifRepo.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Test' }));
      expect(result.title).toBe('Test');
    });
  });

  describe('list', () => {
    it('returns paginated notifications for role', async () => {
      mockNotifRepo.findMany.mockResolvedValue([{ id: 'n1' }]);
      mockNotifRepo.count.mockResolvedValue(1);

      const result = await notificationService.list({ page: 1, limit: 20 }, 'ADMIN', 'user-1');
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    /**
     * Enterprise-audit finding (2026-07-13): the ADMIN visibility filter used a
     * top-level `NOT: { forRole: 'SUPER_ADMIN' }`, which compiles to
     * `NOT (for_role = 'SUPER_ADMIN')`. For a row with for_role IS NULL that
     * evaluates to NULL — not TRUE — so Postgres excluded it. Since the NOT was
     * ANDed over the whole OR, it silently killed two of the three branches:
     * ADMINs saw neither their own personally-addressed notifications nor any
     * general ones. Assert the exclusion is null-safe.
     */
    it('does not exclude null-forRole rows from an ADMIN (null-safe SUPER_ADMIN filter)', async () => {
      mockNotifRepo.findMany.mockResolvedValue([]);
      mockNotifRepo.count.mockResolvedValue(0);

      await notificationService.list({ page: 1, limit: 20 }, 'ADMIN', 'someadmin');
      const where = mockNotifRepo.findMany.mock.calls[0][0];
      const normal = (where.OR as any[])[0].AND[1];

      // The three visibility branches survive...
      expect(normal.OR).toEqual([
        { forUserId: 'someadmin' },
        { forRole: 'ADMIN' },
        { forRole: null, forUserId: null },
      ]);
      // ...and SUPER_ADMIN is excluded without swallowing forRole IS NULL rows.
      expect(normal.NOT).toBeUndefined();
      expect(normal.AND).toEqual([{ OR: [{ forRole: null }, { forRole: { not: 'SUPER_ADMIN' } }] }]);
    });
  });

  describe('getUnreadCount', () => {
    it('returns count of unread notifications', async () => {
      mockNotifRepo.count.mockResolvedValue(5);

      const result = await notificationService.getUnreadCount('u1', 'ADMIN');
      expect(result.count).toBe(5);
    });
  });

  describe('markRead', () => {
    it('marks notification as read', async () => {
      mockNotifRepo.findById.mockResolvedValue({ id: 'n1' });
      mockNotifRepo.markRead.mockResolvedValue({});

      const result = await notificationService.markRead('n1');
      expect(result.success).toBe(true);
      expect(mockNotifRepo.markRead).toHaveBeenCalledWith('n1');
    });

    it('throws NotFoundError', async () => {
      mockNotifRepo.findById.mockResolvedValue(null);
      await expect(notificationService.markRead('bad')).rejects.toThrow('not found');
    });
  });

  describe('markUnread', () => {
    it('marks notification as unread', async () => {
      mockNotifRepo.findById.mockResolvedValue({ id: 'n1' });
      mockNotifRepo.markUnread.mockResolvedValue({});

      const result = await notificationService.markUnread('n1');
      expect(result.success).toBe(true);
      expect(mockNotifRepo.markUnread).toHaveBeenCalledWith('n1');
    });
  });

  describe('markAllRead', () => {
    it('marks all notifications as read', async () => {
      mockNotifRepo.markAllRead.mockResolvedValue({ count: 10 });

      await notificationService.markAllRead('u1', 'ADMIN');
      expect(mockNotifRepo.markAllRead).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes notification', async () => {
      mockNotifRepo.findById.mockResolvedValue({ id: 'n1' });
      mockNotifRepo.delete.mockResolvedValue({});

      await notificationService.delete('n1');
      expect(mockNotifRepo.delete).toHaveBeenCalledWith('n1');
    });
  });
});
