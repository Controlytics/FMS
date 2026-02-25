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
        'ASSET_TEMPLATE_MANAGE', 'ASSET_CREATE', 'ASSET_UPDATE', 'ASSET_DELETE',
        'ASSET_RELATIONSHIP_MANAGE', 'ASSET_IDENTIFIER_MANAGE', 'ASSET_VIEW',
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
        'ASSET_TEMPLATE_MANAGE', 'ASSET_CREATE', 'ASSET_UPDATE', 'ASSET_DELETE',
        'ASSET_RELATIONSHIP_MANAGE', 'ASSET_IDENTIFIER_MANAGE', 'ASSET_VIEW',
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
        'ASSET_VIEW', 'ASSET_CREATE',
      ],
      color: 'bg-gradient-to-r from-blue-500 to-cyan-500',
      isSystem: true,
    },
    {
      name: 'MAINTENANCE',
      displayName: 'Maintenance',
      description: 'Maintenance staff with entity and template management',
      hierarchyLevel: 3,
      permissions: [
        'AUDIT_READ', 'APPROVAL_REQUEST',
        'ASSET_VIEW', 'ASSET_CREATE', 'ASSET_UPDATE',
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
        'ASSET_VIEW',
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
        'ASSET_VIEW',
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
    // Entity Templates
    { fieldId: 'FLD_TMPL_001', defaultName: 'Template Name', displayName: 'Template Name', module: 'Entity Templates' },
    { fieldId: 'FLD_TMPL_002', defaultName: 'Description', displayName: 'Description', module: 'Entity Templates' },
    { fieldId: 'FLD_TMPL_003', defaultName: 'Category', displayName: 'Category', module: 'Entity Templates' },
    { fieldId: 'FLD_TMPL_004', defaultName: 'Attributes', displayName: 'Attributes', module: 'Entity Templates' },
    { fieldId: 'FLD_TMPL_005', defaultName: 'Instances', displayName: 'Instances', module: 'Entity Templates' },
    { fieldId: 'FLD_TMPL_006', defaultName: 'Actions', displayName: 'Actions', module: 'Entity Templates' },
    // Entity Instances
    { fieldId: 'FLD_INST_001', defaultName: 'Entity Name', displayName: 'Entity Name', module: 'Entity Instances' },
    { fieldId: 'FLD_INST_002', defaultName: 'Description', displayName: 'Description', module: 'Entity Instances' },
    { fieldId: 'FLD_INST_003', defaultName: 'Template', displayName: 'Template', module: 'Entity Instances' },
    { fieldId: 'FLD_INST_004', defaultName: 'Parent Entity', displayName: 'Parent Entity', module: 'Entity Instances' },
    { fieldId: 'FLD_INST_005', defaultName: 'Status', displayName: 'Status', module: 'Entity Instances' },
    { fieldId: 'FLD_INST_006', defaultName: 'Created', displayName: 'Created', module: 'Entity Instances' },
    { fieldId: 'FLD_INST_007', defaultName: 'Last Modified', displayName: 'Last Modified', module: 'Entity Instances' },
    { fieldId: 'FLD_INST_008', defaultName: 'Children', displayName: 'Children', module: 'Entity Instances' },
    { fieldId: 'FLD_INST_009', defaultName: 'Actions', displayName: 'Actions', module: 'Entity Instances' },
    // Entity Attributes
    { fieldId: 'FLD_ATTR_001', defaultName: 'Attribute Name', displayName: 'Attribute Name', module: 'Entity Attributes' },
    { fieldId: 'FLD_ATTR_002', defaultName: 'Data Type', displayName: 'Data Type', module: 'Entity Attributes' },
    { fieldId: 'FLD_ATTR_003', defaultName: 'Required', displayName: 'Required', module: 'Entity Attributes' },
    { fieldId: 'FLD_ATTR_004', defaultName: 'Default Value', displayName: 'Default Value', module: 'Entity Attributes' },
    // Entity Telemetry
    { fieldId: 'FLD_TELE_001', defaultName: 'Telemetry Name', displayName: 'Telemetry Name', module: 'Entity Telemetry' },
    { fieldId: 'FLD_TELE_002', defaultName: 'Unit', displayName: 'Unit', module: 'Entity Telemetry' },
    { fieldId: 'FLD_TELE_003', defaultName: 'Data Type', displayName: 'Data Type', module: 'Entity Telemetry' },
    // Entity Relationships
    { fieldId: 'FLD_REL_001', defaultName: 'Relationship Type', displayName: 'Relationship Type', module: 'Entity Relationships' },
    { fieldId: 'FLD_REL_002', defaultName: 'Source Entity', displayName: 'Source Entity', module: 'Entity Relationships' },
    { fieldId: 'FLD_REL_003', defaultName: 'Target Entity', displayName: 'Target Entity', module: 'Entity Relationships' },
    { fieldId: 'FLD_REL_004', defaultName: 'Notes', displayName: 'Notes', module: 'Entity Relationships' },
    // Entity Identifiers
    { fieldId: 'FLD_IDENT_001', defaultName: 'Identifier Type', displayName: 'Identifier Type', module: 'Entity Identifiers' },
    { fieldId: 'FLD_IDENT_002', defaultName: 'Identifier Value', displayName: 'Identifier Value', module: 'Entity Identifiers' },
    { fieldId: 'FLD_IDENT_003', defaultName: 'Label', displayName: 'Label', module: 'Entity Identifiers' },
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
    // Connection Status
    { fieldId: 'FLD_CONN_001', defaultName: 'Connections Allowed', displayName: 'Connections Allowed', module: 'Connection Status' },
    { fieldId: 'FLD_CONN_002', defaultName: 'Connections Used', displayName: 'Connections Used', module: 'Connection Status' },
    { fieldId: 'FLD_CONN_003', defaultName: 'Parent Connections Allowed', displayName: 'Parent Connections Allowed', module: 'Connection Status' },
    { fieldId: 'FLD_CONN_004', defaultName: 'Parent Connections Used', displayName: 'Parent Connections Used', module: 'Connection Status' },
    // Entity Hierarchy (legacy/asset labels)
    { fieldId: 'FLD_ASSET_001', defaultName: 'Building Name', displayName: 'Building Name', module: 'Entity Hierarchy' },
    { fieldId: 'FLD_ASSET_002', defaultName: 'Block Name', displayName: 'Block Name', module: 'Entity Hierarchy' },
    { fieldId: 'FLD_ASSET_003', defaultName: 'Area Name', displayName: 'Area Name', module: 'Entity Hierarchy' },
    { fieldId: 'FLD_ASSET_004', defaultName: 'Device Name', displayName: 'Device Name', module: 'Entity Hierarchy' },
    { fieldId: 'FLD_ASSET_005', defaultName: 'Serial Number', displayName: 'Serial Number', module: 'Entity Hierarchy' },
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
