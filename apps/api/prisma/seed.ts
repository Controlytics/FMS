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
        'AUDIT_READ', 'ROLE_MANAGE',
        'ASSET_TEMPLATE_CREATE', 'ASSET_TEMPLATE_UPDATE', 'ASSET_TEMPLATE_DELETE', 'ASSET_CREATE', 'ASSET_UPDATE', 'ASSET_DELETE',
        'ASSET_RELATIONSHIP_CREATE', 'ASSET_RELATIONSHIP_DELETE', 'ASSET_IDENTIFIER_CREATE', 'ASSET_IDENTIFIER_DELETE', 'ASSET_VIEW',
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
        'ASSET_TEMPLATE_CREATE', 'ASSET_TEMPLATE_UPDATE', 'ASSET_TEMPLATE_DELETE', 'ASSET_CREATE', 'ASSET_UPDATE', 'ASSET_DELETE',
        'ASSET_RELATIONSHIP_CREATE', 'ASSET_RELATIONSHIP_DELETE', 'ASSET_IDENTIFIER_CREATE', 'ASSET_IDENTIFIER_DELETE', 'ASSET_VIEW',
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
        'AUDIT_READ',
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
        'AUDIT_READ',
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
    where: { username: 'superadmin' },
    update: {},
    create: {
      username: 'superadmin',
      fullName: 'System Administrator',
      email: 'admin@digilog.local',
      passwordHash,
      role: 'SUPER_ADMIN',
      status: 'ENABLED',
      forcePasswordChange: false,
      isTemporaryPassword: false,
      createdBy: 'system',
    },
  });

  // Add to password history
  const admin = await prisma.user.findUnique({ where: { username: 'superadmin' } });
  if (admin) {
    const existingHistory = await prisma.passwordHistory.findFirst({ where: { userId: admin.id } });
    if (!existingHistory) {
      await prisma.passwordHistory.create({
        data: { userId: admin.id, passwordHash },
      });
    }
  }

  console.log('  Created default admin user (superadmin / Admin@123)');

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
    { fieldId: 'FLD_USER_001', defaultName: 'User ID', displayName: 'User ID', module: 'User Management', description: 'Unique user identifier' },
    { fieldId: 'FLD_USER_002', defaultName: 'Full Name', displayName: 'Full Name', module: 'User Management', description: 'User full name' },
    { fieldId: 'FLD_USER_003', defaultName: 'Email', displayName: 'Email', module: 'User Management', description: 'User email address' },
    { fieldId: 'FLD_USER_004', defaultName: 'Department', displayName: 'Department', module: 'User Management', description: 'User department' },
    { fieldId: 'FLD_USER_005', defaultName: 'Role', displayName: 'Role', module: 'User Management', description: 'User role assignment' },
    { fieldId: 'FLD_USER_006', defaultName: 'Status', displayName: 'Status', module: 'User Management', description: 'User account status' },
    // Audit Trail
    { fieldId: 'FLD_AUDIT_001', defaultName: 'Timestamp', displayName: 'Timestamp', module: 'Audit Trail', description: 'When the action occurred' },
    { fieldId: 'FLD_AUDIT_002', defaultName: 'Description', displayName: 'Description', module: 'Audit Trail', description: 'Summary of the audit event' },
    { fieldId: 'FLD_AUDIT_003', defaultName: 'Action', displayName: 'Action', module: 'Audit Trail', description: 'Type of action performed' },
    { fieldId: 'FLD_AUDIT_004', defaultName: 'Performed By', displayName: 'Performed By', module: 'Audit Trail', description: 'User who performed the action' },
    { fieldId: 'FLD_AUDIT_005', defaultName: 'Status', displayName: 'Status', module: 'Audit Trail', description: 'Integrity verification status' },
    // Alarms
    { fieldId: 'FLD_ALARM_001', defaultName: 'Severity', displayName: 'Severity', module: 'Alarms', description: 'Alarm severity level' },
    { fieldId: 'FLD_ALARM_002', defaultName: 'Alarm Type', displayName: 'Alarm Type', module: 'Alarms', description: 'Type of alarm triggered' },
    { fieldId: 'FLD_ALARM_003', defaultName: 'Entity', displayName: 'Entity', module: 'Alarms', description: 'Associated entity name' },
    { fieldId: 'FLD_ALARM_004', defaultName: 'High Limit', displayName: 'High Limit', module: 'Alarms', description: 'Upper threshold value' },
    { fieldId: 'FLD_ALARM_005', defaultName: 'Low Limit', displayName: 'Low Limit', module: 'Alarms', description: 'Lower threshold value' },
    { fieldId: 'FLD_ALARM_006', defaultName: 'Generated Value', displayName: 'Generated Value', module: 'Alarms', description: 'Value when alarm was generated' },
    { fieldId: 'FLD_ALARM_007', defaultName: 'Cleared Value', displayName: 'Cleared Value', module: 'Alarms', description: 'Value when alarm was cleared' },
    { fieldId: 'FLD_ALARM_008', defaultName: 'Status', displayName: 'Status', module: 'Alarms', description: 'Current alarm status' },
    { fieldId: 'FLD_ALARM_009', defaultName: 'Generated At', displayName: 'Generated At', module: 'Alarms', description: 'Alarm generation timestamp' },
    { fieldId: 'FLD_ALARM_010', defaultName: 'Cleared At', displayName: 'Cleared At', module: 'Alarms', description: 'Alarm cleared timestamp' },
    { fieldId: 'FLD_ALARM_011', defaultName: 'Actions', displayName: 'Actions', module: 'Alarms', description: 'Acknowledge and clear buttons' },
    // Asset Management
    { fieldId: 'FLD_ASSET_001', defaultName: 'Name', displayName: 'Name', module: 'Asset Management', description: 'Asset instance name' },
    { fieldId: 'FLD_ASSET_002', defaultName: 'Template', displayName: 'Template', module: 'Asset Management', description: 'Associated template' },
    { fieldId: 'FLD_ASSET_003', defaultName: 'Parent', displayName: 'Parent', module: 'Asset Management', description: 'Parent asset in hierarchy' },
    { fieldId: 'FLD_ASSET_004', defaultName: 'Children', displayName: 'Children', module: 'Asset Management', description: 'Number of child assets' },
    { fieldId: 'FLD_ASSET_005', defaultName: 'Created', displayName: 'Created', module: 'Asset Management', description: 'Creation timestamp' },
    // Notifications
    { fieldId: 'FLD_NOTIF_001', defaultName: 'Rule Name', displayName: 'Rule Name', module: 'Notifications', description: 'Notification rule name' },
    { fieldId: 'FLD_NOTIF_002', defaultName: 'Event Type', displayName: 'Event Type', module: 'Notifications', description: 'Triggering event type' },
    { fieldId: 'FLD_NOTIF_003', defaultName: 'Channels', displayName: 'Channels', module: 'Notifications', description: 'Delivery channels (email, SMS, in-app)' },
    { fieldId: 'FLD_NOTIF_004', defaultName: 'Priority', displayName: 'Priority', module: 'Notifications', description: 'Rule priority order' },
    { fieldId: 'FLD_NOTIF_005', defaultName: 'Status', displayName: 'Status', module: 'Notifications', description: 'Active or inactive' },
    { fieldId: 'FLD_NOTIF_006', defaultName: 'Cooldown', displayName: 'Cooldown', module: 'Notifications', description: 'Cooldown period in minutes' },
    // Telemetry
    { fieldId: 'FLD_TELEM_001', defaultName: 'Key', displayName: 'Key', module: 'Telemetry', description: 'Telemetry data key' },
    { fieldId: 'FLD_TELEM_002', defaultName: 'Value', displayName: 'Value', module: 'Telemetry', description: 'Telemetry data value' },
    { fieldId: 'FLD_TELEM_003', defaultName: 'Timestamp', displayName: 'Timestamp', module: 'Telemetry', description: 'Data collection timestamp' },
    // Attributes
    { fieldId: 'FLD_ATTR_001', defaultName: 'Key', displayName: 'Key', module: 'Attributes', description: 'Attribute key name' },
    { fieldId: 'FLD_ATTR_002', defaultName: 'Value', displayName: 'Value', module: 'Attributes', description: 'Attribute value' },
    { fieldId: 'FLD_ATTR_003', defaultName: 'Last Updated', displayName: 'Last Updated', module: 'Attributes', description: 'Last update timestamp' },
  ];

  for (const field of fieldIds) {
    await prisma.fieldIdConfig.upsert({
      where: { fieldId: field.fieldId },
      update: {},
      create: field,
    });
  }
  console.log('  Created default field ID configurations');

  // 5. Ingestion System Configuration (30+ hot-reload settings from Section 20.3)
  const ingestionConfigs = [
    // Rule Engine
    { key: 'rule_engine.script_timeout_ms', value: '5000', dataType: 'INTEGER', category: 'rule_engine', label: 'Script Execution Timeout', description: 'Maximum time a rule chain script can run', defaultValue: '5000', minValue: '1000', maxValue: '30000', unit: 'ms' },
    { key: 'rule_engine.script_memory_mb', value: '16', dataType: 'INTEGER', category: 'rule_engine', label: 'Script Memory Limit', description: 'Maximum memory allocated to script sandbox', defaultValue: '16', minValue: '4', maxValue: '64', unit: 'MB' },
    { key: 'rule_engine.debug_buffer_size', value: '100', dataType: 'INTEGER', category: 'rule_engine', label: 'Debug Events Per Node', description: 'Number of debug events kept in buffer per node', defaultValue: '100', minValue: '10', maxValue: '1000', unit: 'events' },
    { key: 'rule_engine.debug_ttl_hours', value: '24', dataType: 'INTEGER', category: 'rule_engine', label: 'Debug Event Retention', description: 'How long debug events are retained', defaultValue: '24', minValue: '1', maxValue: '168', unit: 'hours' },
    { key: 'rule_engine.max_chain_depth', value: '10', dataType: 'INTEGER', category: 'rule_engine', label: 'Max Rule Chain Depth', description: 'Maximum depth for nested rule chain calls', defaultValue: '10', minValue: '3', maxValue: '50', unit: 'chains' },

    // Device
    { key: 'device.default_inactivity_timeout_sec', value: '60', dataType: 'INTEGER', category: 'device', label: 'Default Inactivity Timeout', description: 'Seconds of inactivity before device marked offline', defaultValue: '60', minValue: '10', maxValue: '3600', unit: 'seconds' },
    { key: 'device.ip_validation_enabled', value: 'true', dataType: 'BOOLEAN', category: 'device', label: 'IP Allowlist Enforcement', description: 'Enforce IP allowlist on device connections', defaultValue: 'true' },
    { key: 'device.rate_limit_enabled', value: 'true', dataType: 'BOOLEAN', category: 'device', label: 'Per-Device Rate Limiting', description: 'Enable per-device message rate limiting', defaultValue: 'true' },
    { key: 'device.default_max_data_rate_per_min', value: '600', dataType: 'INTEGER', category: 'device', label: 'Default Rate Limit', description: 'Default max messages per minute per device', defaultValue: '600', minValue: '10', maxValue: '10000', unit: 'msg/min' },

    // Pipeline
    { key: 'pipeline.timestamp_max_drift_hours', value: '24', dataType: 'INTEGER', category: 'pipeline', label: 'Max Clock Drift Tolerance', description: 'Maximum allowed clock drift between client and server', defaultValue: '24', minValue: '1', maxValue: '168', unit: 'hours' },
    { key: 'pipeline.dlq_alarm_threshold', value: '100', dataType: 'INTEGER', category: 'pipeline', label: 'DLQ Depth Alert Threshold', description: 'Dead Letter Queue depth that triggers alarm', defaultValue: '100', minValue: '10', maxValue: '10000', unit: 'messages' },
    { key: 'pipeline.telemetry_batch_size', value: '100', dataType: 'INTEGER', category: 'pipeline', label: 'Telemetry Write Batch Size', description: 'Number of rows to batch before writing to TSDB', defaultValue: '100', minValue: '1', maxValue: '1000', unit: 'rows' },
    { key: 'pipeline.telemetry_batch_flush_ms', value: '500', dataType: 'INTEGER', category: 'pipeline', label: 'Telemetry Batch Flush Interval', description: 'Maximum time to hold batch before flushing', defaultValue: '500', minValue: '100', maxValue: '5000', unit: 'ms' },
    { key: 'pipeline.trace_enabled', value: 'false', dataType: 'BOOLEAN', category: 'pipeline', label: 'Global Pipeline Trace', description: 'Trace ALL messages from ALL entities (high overhead)', defaultValue: 'false' },
    { key: 'pipeline.trace_max_per_entity', value: '10000', dataType: 'INTEGER', category: 'pipeline', label: 'Max Traces Per Entity', description: 'Maximum trace records kept per entity', defaultValue: '10000', minValue: '1000', maxValue: '100000', unit: 'traces' },

    // RPC
    { key: 'rpc.timeout_ms', value: '30000', dataType: 'INTEGER', category: 'rpc', label: 'RPC Response Timeout', description: 'Maximum time to wait for device RPC response', defaultValue: '30000', minValue: '5000', maxValue: '120000', unit: 'ms' },
    { key: 'rpc.response_cache_ttl_ms', value: '300000', dataType: 'INTEGER', category: 'rpc', label: 'RPC Response Cache TTL', description: 'How long to cache RPC responses', defaultValue: '300000', minValue: '60000', maxValue: '900000', unit: 'ms' },

    // Export
    { key: 'export.max_range_days', value: '90', dataType: 'INTEGER', category: 'export', label: 'Max Export Date Range', description: 'Maximum date range for data export', defaultValue: '90', minValue: '7', maxValue: '365', unit: 'days' },
    { key: 'export.max_rows', value: '1000000', dataType: 'INTEGER', category: 'export', label: 'Max Export Row Count', description: 'Maximum rows in a single export', defaultValue: '1000000', minValue: '10000', maxValue: '10000000', unit: 'rows' },
    { key: 'export.pdf_max_rows', value: '10000', dataType: 'INTEGER', category: 'export', label: 'Max PDF Export Rows', description: 'Maximum rows in PDF export', defaultValue: '10000', minValue: '1000', maxValue: '100000', unit: 'rows' },
    { key: 'export.rate_limit_per_min', value: '5', dataType: 'INTEGER', category: 'export', label: 'Export Requests Per Minute', description: 'Rate limit for export requests', defaultValue: '5', minValue: '1', maxValue: '20', unit: 'requests' },
    { key: 'export.async_threshold_rows', value: '10000', dataType: 'INTEGER', category: 'export', label: 'Async Export Threshold', description: 'Row count above which export runs async', defaultValue: '10000', minValue: '1000', maxValue: '100000', unit: 'rows' },

    // WebSocket
    { key: 'websocket.max_connections_per_user', value: '10', dataType: 'INTEGER', category: 'websocket', label: 'Max WebSocket Connections', description: 'Maximum WebSocket connections per user', defaultValue: '10', minValue: '1', maxValue: '50', unit: 'connections' },

    // Retention
    { key: 'retention.auto_enabled', value: 'false', dataType: 'BOOLEAN', category: 'retention', label: 'Auto-Retention Enabled', description: 'Enable automatic data retention policies', defaultValue: 'false' },
    { key: 'retention.requires_archive', value: 'true', dataType: 'BOOLEAN', category: 'retention', label: 'Require Archive Before Delete', description: 'Require data archive before retention deletion', defaultValue: 'true' },
    { key: 'retention.compression_after_days', value: '7', dataType: 'INTEGER', category: 'retention', label: 'Compress Data After', description: 'Days after which data is compressed', defaultValue: '7', minValue: '1', maxValue: '90', unit: 'days' },

    // MQTT
    { key: 'mqtt.max_payload_bytes', value: '1048576', dataType: 'INTEGER', category: 'mqtt', label: 'MQTT Max Payload Size', description: 'Maximum MQTT message payload size', defaultValue: '1048576', minValue: '1024', maxValue: '10485760', unit: 'bytes' },

    // Binary uploads
    { key: 'binary.max_image_size_mb', value: '10', dataType: 'INTEGER', category: 'binary', label: 'Max Image Upload Size', description: 'Maximum image file upload size', defaultValue: '10', minValue: '1', maxValue: '50', unit: 'MB' },
    { key: 'binary.max_audio_size_mb', value: '50', dataType: 'INTEGER', category: 'binary', label: 'Max Audio Upload Size', description: 'Maximum audio file upload size', defaultValue: '50', minValue: '5', maxValue: '200', unit: 'MB' },
    { key: 'binary.max_vibration_size_mb', value: '100', dataType: 'INTEGER', category: 'binary', label: 'Max Vibration Upload Size', description: 'Maximum vibration data file size', defaultValue: '100', minValue: '10', maxValue: '500', unit: 'MB' },

    // Ingestion Worker (requiresRestart: true)
    { key: 'ingestion.worker_concurrency', value: '10', dataType: 'INTEGER', category: 'ingestion', label: 'Ingestion Worker Concurrency', description: 'Number of concurrent ingestion jobs', defaultValue: '10', minValue: '1', maxValue: '50', unit: 'jobs', requiresRestart: true },
    { key: 'ingestion.worker_rate_limit', value: '1000', dataType: 'INTEGER', category: 'ingestion', label: 'Ingestion Worker Rate Limit', description: 'Maximum ingestion jobs per second', defaultValue: '1000', minValue: '100', maxValue: '10000', unit: 'jobs/sec', requiresRestart: true },
    { key: 'pipeline.trace_ttl_hours', value: '48', dataType: 'INTEGER', category: 'pipeline', label: 'Trace Retention Period', description: 'How long pipeline traces are kept before auto-purge', defaultValue: '48', minValue: '1', maxValue: '168', unit: 'hours', requiresRestart: true },
  ];

  for (const config of ingestionConfigs) {
    await prisma.ingestionSystemConfig.upsert({
      where: { key: config.key },
      update: {},
      create: {
        key: config.key,
        value: config.value,
        dataType: config.dataType,
        category: config.category,
        label: config.label,
        description: config.description ?? null,
        defaultValue: config.defaultValue,
        minValue: config.minValue ?? null,
        maxValue: config.maxValue ?? null,
        unit: config.unit ?? null,
        requiresRestart: config.requiresRestart ?? false,
      },
    });
  }
  console.log('  Created ingestion system configuration (33 settings)');

  // 6. Default Help Articles (from Appendix B)
  const helpArticles = [
    { key: 'entity.overview', title: 'Entity Management Overview', category: 'entity', sortOrder: 1 },
    { key: 'entity.templates', title: 'Working with Entity Templates', category: 'entity', sortOrder: 2 },
    { key: 'entity.tree', title: 'Navigating the Entity Tree', category: 'entity', sortOrder: 3 },
    { key: 'entity.relationships', title: 'Entity Relationships Guide', category: 'entity', sortOrder: 4 },
    { key: 'entity.identifiers', title: 'Entity Identifiers (QR, RFID, NFC)', category: 'entity', sortOrder: 5 },
    { key: 'rule-chain.overview', title: 'Rule Chain Engine Overview', category: 'rule-chain', sortOrder: 1 },
    { key: 'rule-chain.nodes', title: 'Rule Node Types Reference', category: 'rule-chain', sortOrder: 2 },
    { key: 'rule-chain.scripting', title: 'Writing Rule Chain Scripts', category: 'rule-chain', sortOrder: 3 },
    { key: 'rule-chain.debug', title: 'Debugging Rule Chains', category: 'rule-chain', sortOrder: 4 },
    { key: 'rule-chain.default', title: 'Understanding the Default Rule Chain', category: 'rule-chain', sortOrder: 5 },
    { key: 'connectivity.overview', title: 'Device Connectivity Guide', category: 'connectivity', sortOrder: 1 },
    { key: 'connectivity.mqtt', title: 'MQTT Protocol Setup', category: 'connectivity', sortOrder: 2 },
    { key: 'connectivity.http', title: 'HTTP API Integration', category: 'connectivity', sortOrder: 3 },
    { key: 'connectivity.testing', title: 'Testing Device Connectivity', category: 'connectivity', sortOrder: 4 },
    { key: 'data.telemetry', title: 'Telemetry Data Guide', category: 'data', sortOrder: 1 },
    { key: 'data.attributes', title: 'Entity Attributes (Client/Server/Shared)', category: 'data', sortOrder: 2 },
    { key: 'data.binary', title: 'Binary Data (Images, Audio, Vibration)', category: 'data', sortOrder: 3 },
    { key: 'checklist.overview', title: 'Checklist System Overview', category: 'checklist', sortOrder: 1 },
    { key: 'checklist.mobile', title: 'Filling Checklists on Mobile', category: 'checklist', sortOrder: 2 },
    { key: 'checklist.qr-code', title: 'QR Code Scanning Guide', category: 'checklist', sortOrder: 3 },
    { key: 'checklist.approval', title: 'Checklist Approval Workflow', category: 'checklist', sortOrder: 4 },
    { key: 'uns.overview', title: 'Unified Namespace (UNS) Concepts', category: 'uns', sortOrder: 1 },
    { key: 'uns.isa95', title: 'ISA-95 Hierarchy Mapping', category: 'uns', sortOrder: 2 },
    { key: 'uns.wildcards', title: 'UNS Wildcard Patterns', category: 'uns', sortOrder: 3 },
    { key: 'alarms.overview', title: 'Alarm System Overview', category: 'alarms', sortOrder: 1 },
    { key: 'alarms.management', title: 'Managing and Acknowledging Alarms', category: 'alarms', sortOrder: 2 },
    { key: 'audit.overview', title: 'Audit Trail & Compliance', category: 'audit', sortOrder: 1 },
    { key: 'users.roles', title: 'User Roles & Permissions', category: 'users', sortOrder: 1 },
  ];

  for (const article of helpArticles) {
    await prisma.helpArticle.upsert({
      where: { key: article.key },
      update: {},
      create: {
        key: article.key,
        title: article.title,
        content: `# ${article.title}\n\nContent for this help article will be added during implementation.`,
        category: article.category,
        sortOrder: article.sortOrder,
      },
    });
  }
  console.log('  Created default help articles (28 articles)');

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
