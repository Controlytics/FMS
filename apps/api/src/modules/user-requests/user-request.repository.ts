import { prisma } from '../../lib/prisma.js';

export const userRequestRepository = {
  async findMany(where: Record<string, unknown>, page: number, limit: number) {
    const [requests, total] = await Promise.all([
      prisma.userCreationRequest.findMany({
        where: where as any,
        include: {
          reviewer: { select: { username: true, fullName: true } },
        },
        orderBy: { requestedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.userCreationRequest.count({ where: where as any }),
    ]);
    return { requests, total };
  },

  async findById(id: string) {
    return prisma.userCreationRequest.findUnique({
      where: { id },
      include: {
        reviewer: { select: { username: true, fullName: true } },
      },
    });
  },

  async findPendingByUserIdOrEmail(userId: string, email: string) {
    return prisma.userCreationRequest.findFirst({
      where: {
        status: 'PENDING',
        OR: [{ requestedUserId: userId }, { email }],
      },
    });
  },

  async countPending() {
    return prisma.userCreationRequest.count({ where: { status: 'PENDING' } });
  },

  async create(data: {
    requestedUserId: string;
    fullName: string;
    department?: string;
    email: string;
    roleName: string;
    ipAddress?: string;
  }) {
    return prisma.userCreationRequest.create({ data });
  },

  async approve(id: string, reviewedBy: string, tempPasswordHash: string) {
    return prisma.userCreationRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewedBy,
        reviewedAt: new Date(),
        tempPasswordHash,
      },
    });
  },

  async reject(id: string, reviewedBy: string, rejectionReason: string) {
    return prisma.userCreationRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedBy,
        reviewedAt: new Date(),
        rejectionReason,
      },
    });
  },

  async markPasswordViewed(id: string) {
    return prisma.userCreationRequest.update({
      where: { id },
      data: { isPasswordViewed: true },
    });
  },

  async findActiveRoles() {
    return prisma.role.findMany({
      where: { isActive: true },
      select: { name: true, displayName: true, hierarchyLevel: true, color: true },
      orderBy: { hierarchyLevel: 'desc' },
    });
  },

  async findActiveRole(name: string) {
    return prisma.role.findFirst({
      where: { name, isActive: true },
    });
  },

  async getUserIdConfig() {
    const config = await prisma.systemConfig.findUnique({ where: { configKey: 'user-id' } });
    return config?.configValue ?? {};
  },
};
