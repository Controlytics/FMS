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
