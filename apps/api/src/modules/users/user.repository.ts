import { prisma } from '../../lib/prisma.js';
import { invalidateUserAuthCache } from '../../plugins/auth.js';

export const userRepository = {
  async findMany(where: Record<string, unknown>, page: number, limit?: number) {
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: where as any,
        select: {
          id: true, username: true, fullName: true, email: true, department: true,
          role: true, status: true, lastLogin: true, createdAt: true, createdBy: true,
        },
        orderBy: { createdAt: 'desc' },
        ...(limit ? { skip: (page - 1) * limit, take: limit } : {}),
      }),
      prisma.user.count({ where: where as any }),
    ]);
    return { users, total };
  },

  async findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: {
        id: true, username: true, fullName: true, email: true, department: true,
        role: true, status: true, failedLoginAttempts: true, forcePasswordChange: true,
        isTemporaryPassword: true, lastLogin: true, passwordChangedAt: true,
        createdAt: true, updatedAt: true, createdBy: true, updatedBy: true,
      },
    });
  },

  async findByIdFull(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },

  async findByUsername(username: string) {
    return prisma.user.findUnique({ where: { username } });
  },

  async findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },

  async findByUsernameOrEmail(username: string, email: string) {
    return prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
    });
  },

  async create(data: {
    username: string;
    fullName: string;
    email: string;
    department?: string;
    role: string;
    passwordHash: string;
    status: string;
    forcePasswordChange: boolean;
    isTemporaryPassword: boolean;
    passwordExpiresAt: Date | null;
    createdBy: string;
  }) {
    return prisma.user.create({
      data: {
        username: data.username,
        fullName: data.fullName,
        email: data.email,
        department: data.department,
        role: data.role as any,
        passwordHash: data.passwordHash,
        status: data.status as any,
        forcePasswordChange: data.forcePasswordChange,
        isTemporaryPassword: data.isTemporaryPassword,
        passwordExpiresAt: data.passwordExpiresAt,
        createdBy: data.createdBy,
      },
    });
  },

  async update(id: string, data: Record<string, unknown>) {
    const updated = await prisma.user.update({ where: { id }, data: data as any });
    invalidateUserAuthCache(id);
    return updated;
  },

  async delete(id: string) {
    await prisma.userConfig.deleteMany({ where: { userId: id } });
    const result = await prisma.user.delete({ where: { id } });
    invalidateUserAuthCache(id);
    return result;
  },

  async deleteMany(ids: string[]) {
    await prisma.userConfig.deleteMany({ where: { userId: { in: ids } } });
    const result = await prisma.user.deleteMany({ where: { id: { in: ids } } });
    for (const id of ids) invalidateUserAuthCache(id);
    return result;
  },

  async findManyByIds(ids: string[]) {
    return prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true, fullName: true, role: true, status: true },
    });
  },

  async countByStatus(roleFilter: Record<string, unknown>) {
    const [total, enabled, disabled, locked, expired] = await Promise.all([
      prisma.user.count({ where: { ...roleFilter } }),
      prisma.user.count({ where: { status: 'ENABLED' as any, ...roleFilter } }),
      prisma.user.count({ where: { status: 'DISABLED' as any, ...roleFilter } }),
      prisma.user.count({ where: { status: 'LOCKED' as any, ...roleFilter } }),
      prisma.user.count({ where: { status: 'EXPIRED' as any, ...roleFilter } }),
    ]);
    return { total, enabled, disabled, locked, expired };
  },

  async addPasswordHistory(userId: string, passwordHash: string) {
    return prisma.passwordHistory.create({ data: { userId, passwordHash } });
  },

  async findRole(name: string) {
    return prisma.role.findUnique({ where: { name } });
  },

  async terminateSessions(userId: string, reason: string) {
    return prisma.session.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false, terminationReason: reason },
    });
  },

  async getPasswordExpiresAt(): Promise<Date | null> {
    const config = await prisma.systemConfig.findUnique({ where: { configKey: 'password-policy' } });
    const policy = config?.configValue as { passwordExpiryDays?: number } | null;
    const days = policy?.passwordExpiryDays ?? 90;
    if (days <= 0) return null;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  },

  async unlockUser(id: string, newHash: string, passwordExpiresAt: Date | null, updatedBy: string) {
    const result = await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: {
          status: 'ENABLED',
          failedLoginAttempts: 0,
          lockedAt: null,
          lockoutUntil: null,
          passwordHash: newHash,
          forcePasswordChange: true,
          isTemporaryPassword: true,
          passwordExpiresAt,
          updatedBy,
        },
      }),
      prisma.passwordHistory.create({ data: { userId: id, passwordHash: newHash } }),
    ]);
    invalidateUserAuthCache(id);
    return result;
  },

  async resetPassword(id: string, newHash: string, passwordExpiresAt: Date | null, updatedBy: string) {
    const result = await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: {
          passwordHash: newHash,
          forcePasswordChange: true,
          isTemporaryPassword: true,
          failedLoginAttempts: 0,
          lockedAt: null,
          lockoutUntil: null,
          status: 'ENABLED',
          passwordExpiresAt,
          updatedBy,
        },
      }),
      prisma.passwordHistory.create({ data: { userId: id, passwordHash: newHash } }),
    ]);
    invalidateUserAuthCache(id);
    return result;
  },

  // Password Reset Requests
  async findResetRequests() {
    return prisma.passwordResetRequest.findMany({ orderBy: { requestedAt: 'desc' } });
  },

  async countPendingResetRequests() {
    return prisma.passwordResetRequest.count({ where: { status: 'PENDING' } });
  },

  async findResetRequestById(id: string) {
    return prisma.passwordResetRequest.findUnique({ where: { id } });
  },

  async approveResetRequest(requestId: string, userId: string, newHash: string, passwordExpiresAt: Date | null, processedBy: string, notes?: string) {
    const result = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: newHash,
          forcePasswordChange: true,
          isTemporaryPassword: true,
          failedLoginAttempts: 0,
          lockedAt: null,
          lockoutUntil: null,
          status: 'ENABLED',
          passwordExpiresAt,
          updatedBy: processedBy,
        },
      }),
      prisma.passwordHistory.create({ data: { userId, passwordHash: newHash } }),
      prisma.passwordResetRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', processedAt: new Date(), processedBy, notes },
      }),
    ]);
    invalidateUserAuthCache(userId);
    return result;
  },

  async rejectResetRequest(requestId: string, processedBy: string, notes?: string) {
    return prisma.passwordResetRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', processedAt: new Date(), processedBy, notes },
    });
  },

  async findUsersByUsernames(usernames: string[]) {
    return prisma.user.findMany({
      where: { username: { in: usernames } },
      select: { username: true, fullName: true, email: true, department: true },
    });
  },

  async findUsersByIds(ids: string[]) {
    return prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true, fullName: true, email: true, department: true },
    });
  },
};
