import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

export async function registerSwagger(app: FastifyInstance) {
  const port = process.env.PORT ?? process.env.API_PORT ?? '3000';
  const host = process.env.API_HOST === '0.0.0.0' ? 'localhost' : (process.env.API_HOST ?? 'localhost');

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'DigiLog API',
        description: `# 21 CFR Part 11 Compliant Digital Logbook — REST API

## Authentication
1. Use **POST /api/auth/login** to obtain a JWT token
2. Click **Authorize** (lock icon) and enter: \`Bearer <your-token>\`
3. All subsequent requests will include the token

## Default Credentials
- **Username:** \`admin\`
- **Password:** \`Admin@123\`
- First login will require password change

## Roles & Permissions
| Role | Level | Description |
|------|-------|-------------|
| SUPER_ADMIN | 6 | Full access, actions not audited |
| ADMIN | 5 | User & config management |
| SUPERVISOR | 4 | Approval workflows |
| MAINTENANCE | 3 | Entity management |
| OPERATOR | 2 | Data entry |
| VIEWER | 1 | Read-only access |`,
        version: '1.0.0',
        contact: {
          name: 'DigiLog Support',
        },
      },
      servers: [
        {
          url: process.env.CORS_ORIGIN || 'http://localhost:3000',
          description: 'Server',
        },
        {
          url: `http://${host}:${port}`,
          description: 'Local Development',
        },
      ],
      tags: [
        { name: 'Health', description: 'Health check endpoint' },
        { name: 'Auth', description: 'Authentication — login, logout, password management, re-verification' },
        { name: 'Users', description: 'User management — CRUD, stats, enable/disable, unlock, password reset requests' },
        { name: 'Roles', description: 'Role management — CRUD, permissions, hierarchy' },
        { name: 'Config', description: 'System configuration — password policy, login security, session, datetime, branding, user ID, field IDs, action re-authentication, alarm columns, audit templates, pagination' },
        { name: 'Audit', description: 'Audit trail — immutable SHA-256 checksummed logs with filtering and integrity verification' },
        { name: 'Notifications', description: 'Notifications — role-based user alerts and badges' },
        { name: 'Notification Settings', description: 'Notification delivery settings — email (SMTP/OAuth2), SMS (AWS SNS/Twilio/Vonage), templates, delivery logs' },
        { name: 'Notification Rules', description: 'Notification rules — event-based routing with multi-channel delivery (email, SMS, in-app), recipient targeting, cooldown' },
        { name: 'Uploads', description: 'File uploads — profile photos (JPEG, PNG, GIF, WebP, max 5MB)' },
        { name: 'Backup', description: 'Database backup & restore — export (JSON, SQL, CSV, BAK), validate, and restore with SHA-256 checksum integrity' },
        { name: 'Entity Templates', description: 'Entity template management — reusable blueprints for entity types with alarm rules and checklist schemas' },
        { name: 'Entities', description: 'Entity instance management — create, configure, and operate entity instances in parent-child hierarchies' },
        { name: 'Entity Relationships', description: 'Entity relationships — bidirectional connections between entities (12 types with auto-inverse)' },
        { name: 'Entity Identifiers', description: 'Entity identifiers — QR, RFID, NFC, Barcode, Manual identifiers' },
        { name: 'Data Ingestion', description: 'Data ingestion — HTTP telemetry, batch ingestion, data streams, device credentials' },
        { name: 'Rule Chains', description: 'Rule chain engine — visual DAG-based data processing with 77 node types, sandboxed execution, sub-chain delegation' },
        { name: 'UNS', description: 'Unified Namespace — ISA-95 hierarchical namespace mappings and auto-mapping' },
        { name: 'Telemetry', description: 'Telemetry queries — latest values, history, aggregated, compare, delta, stats' },
        { name: 'Alarms', description: 'Alarm management — lifecycle tracking (ACTIVE → ACKNOWLEDGED → CLEARED), acknowledge, clear with electronic signatures' },
        { name: 'Export', description: 'Data export — telemetry, alarms, audit trail export to CSV/JSON with background job processing' },
        { name: 'Retention', description: 'Data retention — configurable retention policies per data type' },
        { name: 'Connectivity', description: 'Connectivity tracking — real-time device online/offline status, history, and statistics' },
        { name: 'QR Codes', description: 'QR code management — generate, scan, and manage entity QR codes' },
        { name: 'Help', description: 'Help articles — versioned documentation with CRUD and version history' },
        { name: 'Debug Traces', description: 'Debug traces — pipeline execution traces for troubleshooting data ingestion' },
        { name: 'System Health', description: 'System health — request tracking, throughput stats, and system metrics' },
        { name: 'MQTT Internal', description: 'MQTT broker integration — EMQX authentication, ACL, and superuser callbacks (internal use only)' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT token obtained from POST /api/auth/login. Format: Bearer <token>',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
      syntaxHighlight: { theme: 'monokai' },
    },
    staticCSP: false,
  });
}
