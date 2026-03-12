import { prisma } from '../../../lib/prisma.js';

export const templateRepository = {
  async findMany(where: Record<string, unknown>, page: number, limit?: number) {
    const [templates, total] = await Promise.all([
      prisma.assetTemplate.findMany({
        where: where as any,
        include: { _count: { select: { instances: true } } },
        orderBy: { createdAt: 'desc' },
        ...(limit ? { skip: (page - 1) * limit, take: limit } : {}),
      }),
      prisma.assetTemplate.count({ where: where as any }),
    ]);
    return { templates, total };
  },

  async findById(id: string) {
    return prisma.assetTemplate.findUnique({
      where: { id },
      include: { _count: { select: { instances: true } } },
    });
  },

  async findByName(name: string) {
    return prisma.assetTemplate.findUnique({ where: { name } });
  },

  async create(data: {
    name: string;
    description?: string;
    category?: string;
    icon?: string;
    attributeSchema?: any;
    telemetrySchema?: any;
    expectedIdentifiers?: any;
    expectedRelationships?: any;
    statusLifecycle?: any;
    alarmRules?: any;
    checklistSchema?: any;
    maxParentConnections?: number;
    maxConnections?: number;
    dataIngestionEnabled?: boolean;
    transportType?: string | null;
    credentialType?: string;
    inactivityTimeout?: number;
    defaultMaxDataRate?: number;
    autoProvision?: boolean;
    defaultRuleChainId?: string | null;
    createdBy: string;
  }) {
    return prisma.assetTemplate.create({
      data: {
        name: data.name,
        description: data.description,
        category: data.category,
        icon: data.icon,
        version: 1,
        attributeSchema: data.attributeSchema as any,
        telemetrySchema: data.telemetrySchema as any,
        expectedIdentifiers: data.expectedIdentifiers as any,
        expectedRelationships: data.expectedRelationships as any,
        statusLifecycle: data.statusLifecycle as any,
        alarmRules: data.alarmRules as any,
        checklistSchema: data.checklistSchema as any,
        maxParentConnections: data.maxParentConnections ?? 1,
        maxConnections: data.maxConnections ?? 10,
        dataIngestionEnabled: data.dataIngestionEnabled ?? false,
        transportType: data.transportType,
        credentialType: data.credentialType ?? 'TOKEN',
        inactivityTimeout: data.inactivityTimeout ?? 60,
        defaultMaxDataRate: data.defaultMaxDataRate ?? 600,
        autoProvision: data.autoProvision ?? true,
        defaultRuleChainId: data.defaultRuleChainId,
        createdBy: data.createdBy,
      },
    });
  },

  async update(id: string, data: Record<string, unknown>) {
    return prisma.assetTemplate.update({ where: { id }, data: data as any });
  },

  async softDelete(id: string, username: string) {
    return prisma.assetTemplate.update({
      where: { id },
      data: { isActive: false, updatedBy: username },
    });
  },

  async createVersion(data: {
    templateId: string;
    versionNumber: number;
    snapshot: any;
    changeNotes: string;
    createdBy: string;
  }) {
    return prisma.assetTemplateVersion.create({ data });
  },

  async findVersions(templateId: string) {
    return prisma.assetTemplateVersion.findMany({
      where: { templateId },
      orderBy: { versionNumber: 'desc' },
    });
  },
};
