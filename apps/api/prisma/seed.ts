import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // 1. Create default SUPER_ADMIN
  const passwordHash = await bcrypt.hash('Admin@123', 12);

  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      fullName: 'System Administrator',
      email: 'admin@digilog.local',
      passwordHash,
      role: 'SUPER_ADMIN',
      status: 'ENABLED',
      forcePasswordChange: true,
      isTemporaryPassword: true,
      createdBy: 'system',
    },
  });

  // Add to password history
  const admin = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (admin) {
    const existingHistory = await prisma.passwordHistory.findFirst({ where: { userId: admin.id } });
    if (!existingHistory) {
      await prisma.passwordHistory.create({
        data: { userId: admin.id, passwordHash },
      });
    }
  }

  console.log('  Created default admin user (admin / Admin@123)');

  // 2. System configurations
  const configs = [
    {
      configKey: 'password-policy',
      configValue: {
        minLength: 8, maxLength: 128,
        requireUppercase: true, requireLowercase: true,
        requireNumbers: true, requireSpecialChars: true,
        minUppercase: 1, minLowercase: 1, minNumbers: 1, minSpecialChars: 1,
        preventReuseCount: 12, cannotBeUserId: true, cannotContainUserId: true,
      },
      configType: 'security',
      requiresReauth: true,
    },
    {
      configKey: 'login-security',
      configValue: {
        maxFailedAttempts: 5,
        lockoutType: 'TEMPORARY',
        lockoutDurationMinutes: 30,
      },
      configType: 'security',
      requiresReauth: true,
    },
    {
      configKey: 'session',
      configValue: {
        autoLogoutEnabled: true,
        idleTimeoutMinutes: 15,
        warningMinutes: 2,
      },
      configType: 'security',
      requiresReauth: true,
    },
    {
      configKey: 'datetime',
      configValue: {
        dateFormat: 'DD/MM/YYYY',
        timeFormat: '24-hour',
        timezone: 'UTC',
      },
      configType: 'display',
      requiresReauth: false,
    },
  ];

  for (const config of configs) {
    await prisma.systemConfig.upsert({
      where: { configKey: config.configKey },
      update: {},
      create: config,
    });
  }
  console.log('  Created default system configurations');

  // 3. Field ID configurations
  const fieldIds = [
    { fieldId: 'FLD_USER_001', defaultName: 'User ID', displayName: 'User ID', module: 'User Management' },
    { fieldId: 'FLD_USER_002', defaultName: 'Full Name', displayName: 'Full Name', module: 'User Management' },
    { fieldId: 'FLD_USER_003', defaultName: 'Email', displayName: 'Email', module: 'User Management' },
    { fieldId: 'FLD_USER_004', defaultName: 'Department', displayName: 'Department', module: 'User Management' },
    { fieldId: 'FLD_USER_005', defaultName: 'Role', displayName: 'Role', module: 'User Management' },
    { fieldId: 'FLD_USER_006', defaultName: 'Status', displayName: 'Status', module: 'User Management' },
    { fieldId: 'FLD_ASSET_001', defaultName: 'Building Name', displayName: 'Building Name', module: 'Asset Management' },
    { fieldId: 'FLD_ASSET_002', defaultName: 'Block Name', displayName: 'Block Name', module: 'Asset Management' },
    { fieldId: 'FLD_ASSET_003', defaultName: 'Area Name', displayName: 'Area Name', module: 'Asset Management' },
    { fieldId: 'FLD_ASSET_004', defaultName: 'Device Name', displayName: 'Device Name', module: 'Asset Management' },
    { fieldId: 'FLD_ASSET_005', defaultName: 'Serial Number', displayName: 'Serial Number', module: 'Asset Management' },
    { fieldId: 'FLD_ATTR_001', defaultName: 'Attribute Name', displayName: 'Attribute Name', module: 'Attributes' },
    { fieldId: 'FLD_TELE_001', defaultName: 'Telemetry Name', displayName: 'Telemetry Name', module: 'Telemetry' },
  ];

  for (const field of fieldIds) {
    await prisma.fieldIdConfig.upsert({
      where: { fieldId: field.fieldId },
      update: {},
      create: field,
    });
  }
  console.log('  Created default field ID configurations');

  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
