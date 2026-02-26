import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp, loginAs, authGet, authPost, authPut, authDelete, authPatch, ADMIN_PASSWORD } from './test-helper.js';

// Use unique suffixes to avoid collisions between test runs
const SUFFIX = Date.now().toString(36);

describe('Entity Management endpoints', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let templateId: string;
  let instanceId: string;

  beforeAll(async () => {
    app = await buildApp();
    adminToken = await loginAs(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // =============================================
  // Templates
  // =============================================
  describe('Entity Templates', () => {
    it('GET /api/assets/templates returns paginated list', async () => {
      const res = await authGet(app, '/api/assets/templates', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toBeDefined();
      expect(body.total).toBeDefined();
      expect(body.page).toBeDefined();
    });

    it('POST /api/assets/templates creates a new template', async () => {
      const res = await authPost(app, '/api/assets/templates', adminToken, {
        name: `Pump Template ${SUFFIX}`,
        description: 'A test pump template',
        category: 'Equipment',
        attributeSchema: [
          { fieldName: 'model', dataType: 'TEXT' },
          { fieldName: 'flowRate', dataType: 'FLOAT', unit: 'L/min' },
        ],
        telemetrySchema: [
          { fieldName: 'pressure', dataType: 'FLOAT', unit: 'bar' },
        ],
        expectedIdentifiers: [
          { identifierType: 'QR', required: true },
        ],
        maxParentConnections: 1,
        maxConnections: 5,
      }, ADMIN_PASSWORD);

      expect([200, 201]).toContain(res.statusCode);
      const body = JSON.parse(res.body);
      const data = body.data || body;
      expect(data.name).toBe(`Pump Template ${SUFFIX}`);
      expect(data.id).toBeTruthy();
      templateId = data.id;
    });

    it('GET /api/assets/templates/:id returns the template', async () => {
      expect(templateId).toBeTruthy();
      const res = await authGet(app, `/api/assets/templates/${templateId}`, adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.name).toBe(`Pump Template ${SUFFIX}`);
      expect(body.attributeSchema).toHaveLength(2);
    });

    it('PUT /api/assets/templates/:id updates the template', async () => {
      expect(templateId).toBeTruthy();
      const res = await authPut(app, `/api/assets/templates/${templateId}`, adminToken, {
        description: 'Updated description',
      }, ADMIN_PASSWORD);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const data = body.data || body;
      expect(data.description).toBe('Updated description');
    });

    it('GET /api/assets/templates/:id/versions returns version history', async () => {
      expect(templateId).toBeTruthy();
      const res = await authGet(app, `/api/assets/templates/${templateId}/versions`, adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
    });

    it('POST /api/assets/templates rejects empty name', async () => {
      const res = await authPost(app, '/api/assets/templates', adminToken, {
        name: '',
      }, ADMIN_PASSWORD);
      expect(res.statusCode).toBe(400);
    });
  });

  // =============================================
  // Instances
  // =============================================
  describe('Entity Instances', () => {
    it('POST /api/assets/instances creates an instance from template', async () => {
      expect(templateId).toBeTruthy();
      const res = await authPost(app, '/api/assets/instances', adminToken, {
        name: `Pump 001 ${SUFFIX}`,
        templateId,
        description: 'Test pump instance',
        attributes: { model: 'Centrifugal', flowRate: 150 },
      }, ADMIN_PASSWORD);

      expect([200, 201]).toContain(res.statusCode);
      const body = JSON.parse(res.body);
      const data = body.data || body;
      expect(data.name).toBe(`Pump 001 ${SUFFIX}`);
      expect(data.templateId).toBe(templateId);
      instanceId = data.id;
    });

    it('GET /api/assets/instances returns paginated list', async () => {
      const res = await authGet(app, '/api/assets/instances', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toBeDefined();
      expect(body.total).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/assets/instances/tree returns flat array', async () => {
      const res = await authGet(app, '/api/assets/instances/tree', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body)).toBe(true);
    });

    it('GET /api/assets/instances/:id returns the instance', async () => {
      expect(instanceId).toBeTruthy();
      const res = await authGet(app, `/api/assets/instances/${instanceId}`, adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.name).toBe(`Pump 001 ${SUFFIX}`);
    });

    it('PUT /api/assets/instances/:id updates the instance', async () => {
      expect(instanceId).toBeTruthy();
      const res = await authPut(app, `/api/assets/instances/${instanceId}`, adminToken, {
        name: `Pump Updated ${SUFFIX}`,
        status: 'Under Maintenance',
      }, ADMIN_PASSWORD);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const data = body.data || body;
      expect(data.name).toBe(`Pump Updated ${SUFFIX}`);
    });

    it('PATCH /api/assets/instances/:id/status updates just the status', async () => {
      expect(instanceId).toBeTruthy();
      const res = await authPatch(app, `/api/assets/instances/${instanceId}/status`, adminToken, {
        status: 'Active',
      }, ADMIN_PASSWORD);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.status).toBe('Active');
    });

    it('PATCH /api/assets/instances/:id/status rejects missing status', async () => {
      expect(instanceId).toBeTruthy();
      const res = await authPatch(app, `/api/assets/instances/${instanceId}/status`, adminToken, {}, ADMIN_PASSWORD);
      expect([400, 500]).toContain(res.statusCode);
    });

    it('GET /api/assets/instances/:id/children returns children', async () => {
      expect(instanceId).toBeTruthy();
      const res = await authGet(app, `/api/assets/instances/${instanceId}/children`, adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body)).toBe(true);
    });

    it('POST /api/assets/instances rejects invalid templateId', async () => {
      const res = await authPost(app, '/api/assets/instances', adminToken, {
        name: 'Bad Instance',
        templateId: '00000000-0000-0000-0000-000000000000',
      }, ADMIN_PASSWORD);
      expect([400, 404]).toContain(res.statusCode);
    });
  });

  // =============================================
  // Identifiers
  // =============================================
  describe('Entity Identifiers', () => {
    let identifierId: string;

    it('POST /api/assets/identifiers creates an identifier', async () => {
      expect(instanceId).toBeTruthy();
      const res = await authPost(app, '/api/assets/identifiers', adminToken, {
        assetId: instanceId,
        identifierType: 'QR',
        identifierValue: `QR-${SUFFIX}`,
        isPrimary: true,
      }, ADMIN_PASSWORD);

      expect([200, 201]).toContain(res.statusCode);
      const body = JSON.parse(res.body);
      const data = body.data || body;
      expect(data.identifierType).toBe('QR');
      identifierId = data.id;
    });

    it('GET /api/assets/identifiers returns list', async () => {
      const res = await authGet(app, '/api/assets/identifiers', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const data = body.data || body;
      expect(data).toBeDefined();
    });

    it('GET /api/assets/identifiers/lookup/:value looks up by value', async () => {
      const res = await authGet(app, `/api/assets/identifiers/lookup/QR-${SUFFIX}`, adminToken);
      expect(res.statusCode).toBe(200);
    });

    it('DELETE /api/assets/identifiers/:id deletes the identifier', async () => {
      expect(identifierId).toBeTruthy();
      const res = await authDelete(app, `/api/assets/identifiers/${identifierId}`, adminToken, ADMIN_PASSWORD);
      expect(res.statusCode).toBe(200);
    });
  });

  // =============================================
  // Relationships
  // =============================================
  describe('Entity Relationships', () => {
    let instance2Id: string;
    let relationshipId: string;

    it('creates a second instance for relationship testing', async () => {
      expect(templateId).toBeTruthy();
      const res = await authPost(app, '/api/assets/instances', adminToken, {
        name: `Valve ${SUFFIX}`,
        templateId,
        description: 'Test valve',
      }, ADMIN_PASSWORD);
      expect([200, 201]).toContain(res.statusCode);
      const body = JSON.parse(res.body);
      const data = body.data || body;
      instance2Id = data.id;
    });

    it('POST /api/assets/relationships creates a relationship', async () => {
      expect(instanceId).toBeTruthy();
      expect(instance2Id).toBeTruthy();
      const res = await authPost(app, '/api/assets/relationships', adminToken, {
        sourceAssetId: instanceId,
        targetAssetId: instance2Id,
        relationshipType: 'FEEDS',
      }, ADMIN_PASSWORD);

      expect([200, 201]).toContain(res.statusCode);
      const body = JSON.parse(res.body);
      const data = body.data || body;
      expect(data.relationshipType).toBe('FEEDS');
      relationshipId = data.id;
    });

    it('GET /api/assets/relationships returns relationships', async () => {
      const res = await authGet(app, '/api/assets/relationships', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const data = body.data || body;
      expect(Array.isArray(data)).toBe(true);
    });

    it('DELETE /api/assets/relationships/:id deletes relationship', async () => {
      expect(relationshipId).toBeTruthy();
      const res = await authDelete(app, `/api/assets/relationships/${relationshipId}`, adminToken, ADMIN_PASSWORD);
      expect(res.statusCode).toBe(200);
    });
  });

  // =============================================
  // Cleanup — Delete instances and template
  // =============================================
  describe('Cleanup', () => {
    it('DELETE /api/assets/instances/:id soft-deletes instance', async () => {
      expect(instanceId).toBeTruthy();
      const res = await authDelete(app, `/api/assets/instances/${instanceId}`, adminToken, ADMIN_PASSWORD);
      expect(res.statusCode).toBe(200);
    });

    it('DELETE /api/assets/templates/:id soft-deletes template', async () => {
      expect(templateId).toBeTruthy();
      const res = await authDelete(app, `/api/assets/templates/${templateId}`, adminToken, ADMIN_PASSWORD);
      expect(res.statusCode).toBe(200);
    });
  });
});
