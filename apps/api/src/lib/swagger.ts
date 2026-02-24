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
| MAINTENANCE | 3 | Maintenance operations |
| OPERATOR | 2 | Data entry |
| VIEWER | 1 | Read-only access |`,
        version: '1.0.0',
        contact: {
          name: 'DigiLog Support',
        },
      },
      servers: [
        {
          url: 'http://43.205.32.23',
          description: 'Production',
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
        { name: 'Config', description: 'System configuration — password policy, login security, session, datetime, branding, user ID, field IDs, action re-authentication' },
        { name: 'Audit', description: 'Audit trail — immutable SHA-256 checksummed logs with filtering' },
        { name: 'Notifications', description: 'Notifications — role-based user alerts and badges' },
        { name: 'Uploads', description: 'File uploads — profile photos (JPEG, PNG, GIF, WebP, max 5MB)' },
        { name: 'Backup', description: 'Database backup & restore — export (JSON, SQL, CSV, BAK), validate, and restore with SHA-256 checksum integrity' },
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
