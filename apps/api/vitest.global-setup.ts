import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: join(here, '.env'), override: false });

// Tests run against the local digilog_db. e2e helpers default to user
// 'admin' with password 'Admin@123'; ensure that user exists with the ADMIN
// role before any test runs. Idempotent.
export default async function setup(): Promise<void> {
  const { PrismaClient } = await import('@prisma/client');
  const { hashPassword } = await import('./src/lib/password.js');
  const prisma = new PrismaClient();
  try {
    const adminRole = await prisma.role.findFirst({ where: { name: 'SUPER_ADMIN' } });
    if (!adminRole) {
      // Schema seed missing the SUPER_ADMIN role — bail noisily so it's obvious in CI.
      throw new Error(
        'vitest globalSetup: SUPER_ADMIN role missing from digilog_db. Run `npx tsx prisma/seed.ts` first.',
      );
    }

    const passwordHash = await hashPassword('Admin@123');

    const existing = await prisma.user.findUnique({ where: { username: 'admin' } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          role: 'SUPER_ADMIN',
          status: 'ENABLED',
          forcePasswordChange: false,
          isTemporaryPassword: false,
          failedLoginAttempts: 0,
          lockedAt: null,
          lockoutUntil: null,
          email: existing.email ?? 'admin-test@digilog.local',
          fullName: existing.fullName ?? 'Test Admin',
        },
      });
    } else {
      // Need a default org. Pick any existing one - matches the dev DB shape.
      const org = await prisma.organization.findFirst({ select: { id: true } });
      if (!org) {
        throw new Error(
          'vitest globalSetup: no Organization rows in digilog_db. Cannot create test admin.',
        );
      }
      await prisma.user.create({
        data: {
          username: 'admin',
          email: 'admin-test@digilog.local',
          fullName: 'Test Admin',
          role: 'SUPER_ADMIN',
          status: 'ENABLED',
          passwordHash,
          forcePasswordChange: false,
          isTemporaryPassword: false,
          organizationId: org.id,
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}
