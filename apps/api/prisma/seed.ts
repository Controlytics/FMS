import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // 1. Create default roles
  const defaultRoles = [
    {
      name: 'SUPER_ADMIN',
      displayName: 'Super Admin',
      description: 'System owner with full access to all features',
      hierarchyLevel: 6,
      permissions: [
        'USER_CREATE', 'USER_READ', 'USER_UPDATE', 'USER_DELETE', 'USER_ENABLE_DISABLE', 'USER_UNLOCK', 'USER_RESET_PASSWORD',
        'CONFIG_READ', 'CONFIG_UPDATE', 'FIELD_ID_UPDATE',
        'AUDIT_READ', 'APPROVAL_REVIEW', 'APPROVAL_REQUEST', 'ROLE_MANAGE',
      ],
      color: 'bg-gradient-to-r from-red-500 to-pink-500',
      isSystem: true,
    },
    {
      name: 'ADMIN',
      displayName: 'Admin',
      description: 'Administrator with user and configuration management access',
      hierarchyLevel: 5,
      permissions: [
        'USER_CREATE', 'USER_READ', 'USER_UPDATE', 'USER_DELETE', 'USER_ENABLE_DISABLE', 'USER_UNLOCK', 'USER_RESET_PASSWORD',
        'CONFIG_READ', 'CONFIG_UPDATE',
        'AUDIT_READ',
      ],
      color: 'bg-gradient-to-r from-purple-500 to-indigo-500',
      isSystem: true,
    },
    {
      name: 'SUPERVISOR',
      displayName: 'Supervisor',
      description: 'Supervisor with approval and review capabilities',
      hierarchyLevel: 4,
      permissions: [
        'AUDIT_READ', 'APPROVAL_REVIEW',
      ],
      color: 'bg-gradient-to-r from-blue-500 to-cyan-500',
      isSystem: true,
    },
    {
      name: 'MAINTENANCE',
      displayName: 'Maintenance',
      description: 'Maintenance staff with operational access',
      hierarchyLevel: 3,
      permissions: [
        'AUDIT_READ', 'APPROVAL_REQUEST',
      ],
      color: 'bg-gradient-to-r from-amber-500 to-orange-500',
      isSystem: true,
    },
    {
      name: 'OPERATOR',
      displayName: 'Operator',
      description: 'Operator with read access',
      hierarchyLevel: 2,
      permissions: [
        'AUDIT_READ',
      ],
      color: 'bg-gradient-to-r from-emerald-500 to-green-500',
      isSystem: true,
    },
    {
      name: 'VIEWER',
      displayName: 'Viewer',
      description: 'View-only access',
      hierarchyLevel: 1,
      permissions: [
        'AUDIT_READ',
      ],
      color: 'bg-gradient-to-r from-slate-400 to-slate-500',
      isSystem: true,
    },
  ];

  for (const role of defaultRoles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {
        displayName: role.displayName,
        description: role.description,
        hierarchyLevel: role.hierarchyLevel,
        permissions: role.permissions,
        color: role.color,
        isSystem: role.isSystem,
      },
      create: {
        name: role.name,
        displayName: role.displayName,
        description: role.description,
        hierarchyLevel: role.hierarchyLevel,
        permissions: role.permissions,
        color: role.color,
        isSystem: role.isSystem,
        createdBy: 'system',
      },
    });
  }
  console.log('  Created default roles');

  // 2. Create default SUPER_ADMIN
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

  // 3. System configurations
  const configs = [
    {
      configKey: 'password-policy',
      configValue: {
        minLength: 8, maxLength: 128,
        requireUppercase: true, requireLowercase: true,
        requireNumbers: true, requireSpecialChars: true,
        minUppercase: 1, minLowercase: 1, minNumbers: 1, minSpecialChars: 1,
        preventReuseCount: 12, cannotBeUserId: true, cannotContainUserId: true,
        // Password expiry
        passwordExpiryDays: 90,
        // Login security settings
        maxFailedAttempts: 5,
        // Session settings
        autoLogoutEnabled: true, idleTimeoutMinutes: 15, warningMinutes: 2,
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

  // 4. Field ID configurations
  const fieldIds = [
    // User Management
    { fieldId: 'FLD_USER_001', defaultName: 'User ID', displayName: 'User ID', module: 'User Management' },
    { fieldId: 'FLD_USER_002', defaultName: 'Full Name', displayName: 'Full Name', module: 'User Management' },
    { fieldId: 'FLD_USER_003', defaultName: 'Email', displayName: 'Email', module: 'User Management' },
    { fieldId: 'FLD_USER_004', defaultName: 'Department', displayName: 'Department', module: 'User Management' },
    { fieldId: 'FLD_USER_005', defaultName: 'Role', displayName: 'Role', module: 'User Management' },
    { fieldId: 'FLD_USER_006', defaultName: 'Status', displayName: 'Status', module: 'User Management' },
    { fieldId: 'FLD_USER_007', defaultName: 'Last Login', displayName: 'Last Login', module: 'User Management' },
    { fieldId: 'FLD_USER_008', defaultName: 'Created', displayName: 'Created', module: 'User Management' },
    { fieldId: 'FLD_USER_009', defaultName: 'Actions', displayName: 'Actions', module: 'User Management' },
    // Audit Trail
    { fieldId: 'FLD_AUDIT_001', defaultName: 'Timestamp', displayName: 'Timestamp', module: 'Audit Trail' },
    { fieldId: 'FLD_AUDIT_002', defaultName: 'Action', displayName: 'Action', module: 'Audit Trail' },
    { fieldId: 'FLD_AUDIT_003', defaultName: 'Performed By', displayName: 'Performed By', module: 'Audit Trail' },
    { fieldId: 'FLD_AUDIT_004', defaultName: 'Description', displayName: 'Description', module: 'Audit Trail' },
    { fieldId: 'FLD_AUDIT_005', defaultName: 'IP Address', displayName: 'IP Address', module: 'Audit Trail' },
    { fieldId: 'FLD_AUDIT_006', defaultName: 'Status', displayName: 'Status', module: 'Audit Trail' },
    // Notifications
    { fieldId: 'FLD_NOTIF_001', defaultName: 'Title', displayName: 'Title', module: 'Notifications' },
    { fieldId: 'FLD_NOTIF_002', defaultName: 'Message', displayName: 'Message', module: 'Notifications' },
    { fieldId: 'FLD_NOTIF_003', defaultName: 'Type', displayName: 'Type', module: 'Notifications' },
    { fieldId: 'FLD_NOTIF_004', defaultName: 'Date', displayName: 'Date', module: 'Notifications' },
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
