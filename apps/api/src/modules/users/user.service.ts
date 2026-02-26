import type { RequestContext } from '../../types/context.js';
import { auditLog } from '../../lib/audit.js';
import { hashPassword } from '../../lib/password.js';
import { validateUserId } from '../../lib/user-id-validator.js';
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from '../../lib/errors.js';
import { userRepository } from './user.repository.js';
import { createNotification } from '../notifications/notification.service.js';

export const userService = {
  async list(query: { page: number; limit: number; role?: string; status?: string; search?: string }) {
    const where: Record<string, unknown> = {};
    if (query.role) where.role = query.role;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { username: { contains: query.search, mode: 'insensitive' } },
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const { users, total } = await userRepository.findMany(where, query.page, query.limit);
    return { data: users, total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) };
  },

  async getStats(callerRole: string) {
    const roleFilter = callerRole === 'ADMIN' ? { role: { not: 'SUPER_ADMIN' as any } } : {};
    return userRepository.countByStatus(roleFilter);
  },

  async getById(id: string) {
    const user = await userRepository.findById(id);
    if (!user) throw new NotFoundError('User not found');
    return user;
  },

  async create(data: {
    username: string; fullName: string; email: string; department?: string;
    role: string; password: string; status?: string;
  }, ctx: RequestContext) {
    // Validate User ID against configuration
    const userIdValidation = await validateUserId(data.username);
    if (!userIdValidation.valid) {
      throw new ValidationError(userIdValidation.errors.join('. '));
    }

    // Check role hierarchy
    const creatorRole = await userRepository.findRole(ctx.userRole);
    if (!creatorRole) throw new ForbiddenError('Your role is not recognized');
    const targetRole = await userRepository.findRole(data.role);
    if (!targetRole || !targetRole.isActive) throw new ValidationError(`Role ${data.role} does not exist or is inactive`);
    if (targetRole.hierarchyLevel > creatorRole.hierarchyLevel) throw new ForbiddenError(`Cannot create users with role ${data.role}`);

    // Check uniqueness
    const existing = await userRepository.findByUsernameOrEmail(data.username, data.email);
    if (existing) {
      const field = existing.username === data.username ? 'username' : 'email';
      throw new ConflictError(`${field} already exists`);
    }

    const passwordHash = await hashPassword(data.password);
    const passwordExpiresAt = await userRepository.getPasswordExpiresAt();

    const user = await userRepository.create({
      username: data.username,
      fullName: data.fullName,
      email: data.email,
      department: data.department,
      role: data.role,
      passwordHash,
      status: data.status ?? 'ENABLED',
      forcePasswordChange: true,
      isTemporaryPassword: true,
      passwordExpiresAt,
      createdBy: ctx.userId,
    });

    await userRepository.addPasswordHistory(user.id, passwordHash);

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'USER_CREATED',
      targetType: 'user',
      targetId: user.id,
      afterValue: { username: data.username, fullName: data.fullName, email: data.email, role: data.role, status: data.status },
      signatureMeaning: 'New user account created by administrator',
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    await createNotification({
      type: 'USER_CREATED',
      title: 'New User Created',
      message: `User ${data.fullName} (${data.username}) has been created with role ${data.role}.`,
      targetUserId: data.username,
      forRole: 'ADMIN',
      metadata: { userId: user.id, role: data.role },
      createdBy: ctx.userId,
    });

    return {
      id: user.id, username: user.username, fullName: user.fullName,
      email: user.email, department: user.department, role: user.role,
      status: user.status, createdAt: user.createdAt,
    };
  },

  async update(id: string, data: Record<string, any>, ctx: RequestContext) {
    const existing = await userRepository.findByIdFull(id);
    if (!existing) throw new NotFoundError('User not found');

    if (data.role) {
      const creatorRole = await userRepository.findRole(ctx.userRole);
      const targetRole = await userRepository.findRole(data.role);
      if (!creatorRole || !targetRole || !targetRole.isActive || targetRole.hierarchyLevel > creatorRole.hierarchyLevel) {
        throw new ForbiddenError(`Cannot assign role ${data.role}`);
      }
    }

    if (data.email && data.email !== existing.email) {
      const dup = await userRepository.findByEmail(data.email);
      if (dup) throw new ConflictError('Email already exists');
    }

    const beforeValue = { fullName: existing.fullName, email: existing.email, department: existing.department, role: existing.role, status: existing.status };

    const user = await userRepository.update(id, {
      ...data,
      role: data.role as any,
      status: data.status as any,
      updatedBy: ctx.userId,
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'USER_UPDATED',
      targetType: 'user',
      targetId: id,
      beforeValue,
      afterValue: { ...data, username: user.username, fullName: user.fullName },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return { id: user.id, username: user.username, fullName: user.fullName, email: user.email, role: user.role, status: user.status };
  },

  async delete(id: string, callerSub: string, ctx: RequestContext) {
    const existing = await userRepository.findByIdFull(id);
    if (!existing) throw new NotFoundError('User not found');
    if (id === callerSub) throw new ValidationError('Cannot delete your own account');

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'USER_DELETED',
      targetType: 'user',
      targetId: id,
      beforeValue: { username: existing.username, fullName: existing.fullName, email: existing.email, role: existing.role, status: existing.status },
      afterValue: { deleted: true },
      signatureMeaning: 'User account permanently deleted by administrator',
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    await userRepository.delete(id);
  },

  async bulkDelete(userIds: string[], callerSub: string, ctx: RequestContext) {
    if (userIds.includes(callerSub)) throw new ValidationError('Cannot delete your own account');

    const users = await userRepository.findManyByIds(userIds);
    if (users.length === 0) throw new NotFoundError('No users found with the provided IDs');

    const superAdmins = users.filter((u: any) => u.role === 'SUPER_ADMIN');
    if (superAdmins.length > 0) {
      throw new ForbiddenError(`Cannot delete SUPER_ADMIN users: ${superAdmins.map((u: any) => u.username).join(', ')}`);
    }

    const validIds = users.map((u: any) => u.id);

    for (const user of users) {
      await auditLog({
        userId: ctx.userId, userRole: ctx.userRole,
        action: 'BULK_USER_DELETED',
        targetType: 'user',
        targetId: user.id,
        beforeValue: { username: user.username, fullName: user.fullName, role: user.role, status: user.status },
        afterValue: { deleted: true },
        signatureMeaning: 'User account permanently deleted via bulk delete by administrator',
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
      });
    }

    await userRepository.deleteMany(validIds);
    return { deletedCount: validIds.length, deletedUsers: users.map((u: any) => ({ id: u.id, username: u.username })) };
  },

  async enable(id: string, ctx: RequestContext) {
    const user = await userRepository.findByIdFull(id);
    if (!user) throw new NotFoundError('User not found');

    await userRepository.update(id, { status: 'ENABLED', updatedBy: ctx.userId });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'USER_ENABLED',
      targetType: 'user', targetId: id,
      beforeValue: { username: user.username, fullName: user.fullName, status: user.status },
      afterValue: { username: user.username, status: 'ENABLED' },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    await createNotification({
      type: 'ACCOUNT_ENABLED', title: 'Account Enabled',
      message: `User ${user.fullName} (${user.username}) has been enabled.`,
      targetUserId: user.username, forRole: 'ADMIN', createdBy: ctx.userId,
    });
    await createNotification({
      type: 'ACCOUNT_ENABLED', title: 'Your Account Has Been Enabled',
      message: `Your account has been enabled by ${ctx.userId}. You can now log in.`,
      targetUserId: user.username, forUserId: user.username, createdBy: ctx.userId,
    });
  },

  async disable(id: string, ctx: RequestContext) {
    const user = await userRepository.findByIdFull(id);
    if (!user) throw new NotFoundError('User not found');

    await userRepository.update(id, { status: 'DISABLED', updatedBy: ctx.userId });
    await userRepository.terminateSessions(id, 'account_disabled');

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'USER_DISABLED',
      targetType: 'user', targetId: id,
      beforeValue: { username: user.username, fullName: user.fullName, status: user.status },
      afterValue: { username: user.username, status: 'DISABLED' },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    await createNotification({
      type: 'ACCOUNT_DISABLED', title: 'Account Disabled',
      message: `User ${user.fullName} (${user.username}) has been disabled.`,
      targetUserId: user.username, forRole: 'ADMIN', createdBy: ctx.userId,
    });
    await createNotification({
      type: 'ACCOUNT_DISABLED', title: 'Your Account Has Been Disabled',
      message: `Your account has been disabled. Please contact an administrator.`,
      targetUserId: user.username, forUserId: user.username, createdBy: ctx.userId,
    });
  },

  async unlock(id: string, newPassword: string, ctx: RequestContext) {
    const user = await userRepository.findByIdFull(id);
    if (!user) throw new NotFoundError('User not found');

    const newHash = await hashPassword(newPassword);
    const passwordExpiresAt = await userRepository.getPasswordExpiresAt();

    await userRepository.unlockUser(id, newHash, passwordExpiresAt, ctx.userId);

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'ACCOUNT_UNLOCKED',
      targetType: 'user', targetId: id,
      beforeValue: { username: user.username, fullName: user.fullName, status: user.status, failedLoginAttempts: user.failedLoginAttempts },
      afterValue: { username: user.username, fullName: user.fullName, status: 'ENABLED', failedLoginAttempts: 0, forcePasswordChange: true, isTemporaryPassword: true },
      signatureMeaning: 'User account unlocked by administrator with temporary password',
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
  },

  async resetPassword(id: string, newPassword: string, ctx: RequestContext) {
    const user = await userRepository.findByIdFull(id);
    if (!user) throw new NotFoundError('User not found');

    const newHash = await hashPassword(newPassword);
    const passwordExpiresAt = await userRepository.getPasswordExpiresAt();

    await userRepository.resetPassword(id, newHash, passwordExpiresAt, ctx.userId);

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'PASSWORD_RESET',
      targetType: 'user', targetId: id,
      beforeValue: { username: user.username, fullName: user.fullName, status: user.status },
      afterValue: { status: 'ENABLED', forcePasswordChange: true, isTemporaryPassword: true },
      signatureMeaning: 'Administrator reset user password',
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
  },

  async listResetRequests() {
    const requests = await userRepository.findResetRequests();
    const userIds = [...new Set(requests.map((r: any) => r.userId))] as string[];
    const users = userIds.length > 0 ? await userRepository.findUsersByUsernames(userIds) : [];
    const userMap = new Map(users.map((u: any) => [u.username, u]));

    return {
      data: requests.map((request: any) => {
        const user = userMap.get(request.userId) as any;
        return {
          ...request,
          userFullName: user?.fullName ?? request.userId,
          userEmail: user?.email ?? '',
          userDepartment: user?.department ?? '',
        };
      }),
    };
  },

  async getPendingResetRequestCount() {
    return { count: await userRepository.countPendingResetRequests() };
  },

  async processResetRequest(id: string, action: 'approve' | 'reject', newPassword: string | undefined, notes: string | undefined, ctx: RequestContext) {
    const resetRequest = await userRepository.findResetRequestById(id);
    if (!resetRequest) throw new NotFoundError('Reset request not found');
    if (resetRequest.status !== 'PENDING') throw new ValidationError('Reset request has already been processed');

    if (action === 'approve') {
      if (!newPassword || newPassword.length < 8) throw new ValidationError('New password must be at least 8 characters');

      const user = await userRepository.findByUsername(resetRequest.userId);
      if (!user) throw new NotFoundError('User not found');

      const newHash = await hashPassword(newPassword);
      const passwordExpiresAt = await userRepository.getPasswordExpiresAt();

      await userRepository.approveResetRequest(id, user.id, newHash, passwordExpiresAt, ctx.userId, notes);

      await auditLog({
        userId: ctx.userId, userRole: ctx.userRole, action: 'PASSWORD_RESET_REQUEST_APPROVED',
        targetType: 'user', targetId: user.id,
        afterValue: { requestId: id, username: resetRequest.userId },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
      });

      await createNotification({
        type: 'PASSWORD_RESET_APPROVED', title: 'Password Reset Approved',
        message: `Password reset request for ${resetRequest.userId} has been approved.`,
        targetUserId: resetRequest.userId, forRole: 'ADMIN', createdBy: ctx.userId,
      });
      await createNotification({
        type: 'PASSWORD_RESET_APPROVED', title: 'Password Reset Approved',
        message: `Your password reset request has been approved. Please login with your new temporary password.`,
        targetUserId: resetRequest.userId, forUserId: resetRequest.userId, createdBy: ctx.userId,
      });

      return { message: 'Password reset approved and new password set.' };
    } else {
      await userRepository.rejectResetRequest(id, ctx.userId, notes);

      await auditLog({
        userId: ctx.userId, userRole: ctx.userRole, action: 'PASSWORD_RESET_REQUEST_REJECTED',
        targetType: 'password_reset_request', targetId: id,
        afterValue: { username: resetRequest.userId, notes },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
      });

      await createNotification({
        type: 'PASSWORD_RESET_REJECTED', title: 'Password Reset Rejected',
        message: `Your password reset request has been rejected. Please contact an administrator.`,
        targetUserId: resetRequest.userId, forUserId: resetRequest.userId, createdBy: ctx.userId,
      });

      return { message: 'Password reset request rejected.' };
    }
  },
};
