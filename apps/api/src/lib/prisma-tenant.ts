import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';

/**
 * Creates a tenant-scoped Prisma client using Prisma Client Extensions.
 * Automatically injects `tenantId` filter on all read queries
 * and sets `tenantId` on all create operations.
 *
 * SUPER_ADMIN (tenantId = null) gets an unscoped client.
 */
export function createTenantPrisma(tenantId: string | null): PrismaClient {
  // SUPER_ADMIN without tenant impersonation — return unscoped client
  if (!tenantId) {
    return prisma;
  }

  return prisma.$extends({
    query: {
      $allModels: {
        async findMany({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async findUnique({ args, query }) {
          // findUnique uses unique fields, so we can't always inject tenantId
          // Instead, we run the query and verify tenant ownership after
          const result = await query(args);
          if (result && 'tenantId' in result && (result as any).tenantId !== tenantId) {
            return null; // Cross-tenant access denied
          }
          return result;
        },
        async create({ args, query }) {
          if (args.data && typeof args.data === 'object' && !Array.isArray(args.data)) {
            (args.data as any).tenantId = tenantId;
          }
          return query(args);
        },
        async createMany({ args, query }) {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((d: any) => ({ ...d, tenantId }));
          } else if (args.data && typeof args.data === 'object') {
            (args.data as any).tenantId = tenantId;
          }
          return query(args);
        },
        async update({ args, query }) {
          // Scope the where clause to tenant
          if (args.where && typeof args.where === 'object') {
            (args.where as any).tenantId = tenantId;
          }
          return query(args);
        },
        async updateMany({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async delete({ args, query }) {
          if (args.where && typeof args.where === 'object') {
            (args.where as any).tenantId = tenantId;
          }
          return query(args);
        },
        async deleteMany({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async count({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
        async aggregate({ args, query }) {
          args.where = { ...args.where, tenantId };
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
}
