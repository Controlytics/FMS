import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockRoleRepo, mockAuditLog } = vi.hoisted(() => ({
  mockRoleRepo: {
    findAll: vi.fn(),
    findActive: vi.fn(),
    findByName: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    countUsersByRole: vi.fn(),
    findCreatableRoles: vi.fn(),
  },
  mockAuditLog: vi.fn(),
}));

vi.mock('../role.repository.js', () => ({ roleRepository: mockRoleRepo }));
vi.mock('../../../lib/audit.js', () => ({ auditLog: mockAuditLog }));

import { roleService } from '../role.service.js';

const ctx = { userId: 'admin', userSub: 'sub-1', userRole: 'SUPER_ADMIN', ipAddress: '127.0.0.1', userAgent: 'test', sessionId: 'sess-1' };

describe('roleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditLog.mockResolvedValue(undefined);
  });

  describe('listAll', () => {
    it('returns all roles', async () => {
      mockRoleRepo.findAll.mockResolvedValue([{ name: 'ADMIN' }, { name: 'VIEWER' }]);
      const result = await roleService.listAll();
      expect(result).toHaveLength(2);
    });
  });

  describe('listActive', () => {
    it('returns active roles', async () => {
      mockRoleRepo.findActive.mockResolvedValue([{ name: 'ADMIN' }]);
      const result = await roleService.listActive();
      expect(result).toHaveLength(1);
    });
  });

  describe('getByName', () => {
    it('returns role by name', async () => {
      mockRoleRepo.findByName.mockResolvedValue({ name: 'ADMIN', displayName: 'Administrator' });
      const result = await roleService.getByName('ADMIN');
      expect(result.displayName).toBe('Administrator');
    });

    it('throws NotFoundError', async () => {
      mockRoleRepo.findByName.mockResolvedValue(null);
      await expect(roleService.getByName('MISSING')).rejects.toThrow('not found');
    });
  });

  describe('create', () => {
    it('creates a new role', async () => {
      mockRoleRepo.findByName.mockResolvedValue(null);
      mockRoleRepo.create.mockResolvedValue({ name: 'CUSTOM_ROLE', displayName: 'Custom' });

      const result = await roleService.create({
        name: 'CUSTOM_ROLE', displayName: 'Custom', hierarchyLevel: 3, permissions: [], color: '#ff0000',
      }, ctx);

      expect(result.success).toBe(true);
      expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'ROLE_CREATED' }));
    });

    it('rejects duplicate role name', async () => {
      mockRoleRepo.findByName.mockResolvedValue({ name: 'EXISTS' });

      await expect(roleService.create({
        name: 'EXISTS', displayName: 'Dup', hierarchyLevel: 1,
      }, ctx)).rejects.toThrow('already exists');
    });

    it('rejects invalid name format', async () => {
      await expect(roleService.create({
        name: 'lowercase', displayName: 'Bad', hierarchyLevel: 1,
      }, ctx)).rejects.toThrow();
    });
  });

  describe('update', () => {
    it('updates non-system role fully', async () => {
      mockRoleRepo.findByName.mockResolvedValue({ name: 'CUSTOM', isSystem: false });
      mockRoleRepo.update.mockResolvedValue({ name: 'CUSTOM', displayName: 'Updated' });

      const result = await roleService.update('CUSTOM', { displayName: 'Updated', hierarchyLevel: 4 }, ctx);
      expect(result.success).toBe(true);
    });

    it('restricts system role updates to allowed fields', async () => {
      mockRoleRepo.findByName.mockResolvedValue({ name: 'ADMIN', isSystem: true });
      mockRoleRepo.update.mockResolvedValue({ name: 'ADMIN', color: '#000' });

      await roleService.update('ADMIN', { color: '#000', hierarchyLevel: 10 }, ctx);

      // hierarchyLevel should NOT be in the update call for system roles
      const updateCall = mockRoleRepo.update.mock.calls[0];
      expect(updateCall[1]).not.toHaveProperty('hierarchyLevel');
    });

    it('throws NotFoundError', async () => {
      mockRoleRepo.findByName.mockResolvedValue(null);
      await expect(roleService.update('MISSING', {}, ctx)).rejects.toThrow('not found');
    });
  });

  describe('delete', () => {
    it('deletes role with no assigned users', async () => {
      mockRoleRepo.findByName.mockResolvedValue({ name: 'OLD_ROLE', displayName: 'Old', hierarchyLevel: 1, permissions: [] });
      mockRoleRepo.countUsersByRole.mockResolvedValue(0);
      mockRoleRepo.delete.mockResolvedValue({});

      const result = await roleService.delete('OLD_ROLE', ctx);
      expect(result.success).toBe(true);
    });

    it('rejects deletion when role has users', async () => {
      mockRoleRepo.findByName.mockResolvedValue({ name: 'BUSY_ROLE' });
      mockRoleRepo.countUsersByRole.mockResolvedValue(5);

      await expect(roleService.delete('BUSY_ROLE', ctx)).rejects.toThrow('assigned users');
    });

    it('throws NotFoundError', async () => {
      mockRoleRepo.findByName.mockResolvedValue(null);
      await expect(roleService.delete('NOPE', ctx)).rejects.toThrow('not found');
    });
  });

  describe('getAllPermissions', () => {
    it('returns permissions list', async () => {
      const result = await roleService.getAllPermissions();
      expect(result.permissions).toBeInstanceOf(Array);
      expect(result.permissions.length).toBeGreaterThan(0);
      expect(result.permissions[0]).toHaveProperty('key');
      expect(result.permissions[0]).toHaveProperty('category');
    });
  });

  describe('getCreatableRoles', () => {
    it('returns roles at or below hierarchy level', async () => {
      mockRoleRepo.findByName.mockResolvedValue({ name: 'ADMIN', hierarchyLevel: 5 });
      mockRoleRepo.findCreatableRoles.mockResolvedValue([{ name: 'OPERATOR' }, { name: 'VIEWER' }]);

      const result = await roleService.getCreatableRoles('ADMIN');
      expect(result).toHaveLength(2);
      expect(mockRoleRepo.findCreatableRoles).toHaveBeenCalledWith(5);
    });

    it('throws NotFoundError for unknown role', async () => {
      mockRoleRepo.findByName.mockResolvedValue(null);
      await expect(roleService.getCreatableRoles('MISSING')).rejects.toThrow('not found');
    });
  });
});
