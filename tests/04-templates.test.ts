import { describe, it, expect, beforeAll } from 'vitest';
import { api, getAdminToken, createTestUser, loginTestUser, uid } from './helpers';

describe('ASSET TEMPLATE MODULE', () => {
  let adminToken: string;
  let maintToken: string;
  let createdTemplateId: string;

  beforeAll(async () => {
    adminToken = await getAdminToken();

    // MAINTENANCE role has TEMPLATE_CREATE/UPDATE/DELETE permissions
    const maint = await createTestUser(adminToken, { role: 'MAINTENANCE' });
    const loginRes = await loginTestUser(maint.username, maint.password, 'MaintTempl@Pass1');
    maintToken = loginRes.data.token;
  });

  // ─── CREATE TEMPLATE ────────────────────────────────────────
  describe('POST /templates (Create)', () => {
    it('should create a template with attribute and telemetry schemas', async () => {
      const name = `Reactor_${uid()}`;
      const res = await api('POST', '/templates', {
        name,
        nodeType: 'equipment',
        description: 'Test reactor template',
        attributeSchema: [
          { name: 'manufacturer', dataType: 'text', required: true },
          { name: 'capacity', dataType: 'number', unit: 'liters', required: true },
          { name: 'material', dataType: 'dropdown', options: ['SS316', 'Glass', 'Hastelloy'], defaultValue: 'SS316' },
        ],
        telemetrySchema: [
          { name: 'temperature', dataType: 'number', unit: 'C', minValue: 0, maxValue: 300, alertThreshold: 250 },
          { name: 'pressure', dataType: 'number', unit: 'bar', minValue: 0, maxValue: 10 },
          { name: 'running', dataType: 'boolean' },
        ],
      }, maintToken);

      expect(res.status).toBe(201);
      expect(res.data.id).toBeDefined();
      expect(res.data.name).toBe(name);
      expect(res.data.nodeType).toBe('equipment');
      expect(res.data.version).toBe(1);
      expect(res.data.status).toBe('active');
      createdTemplateId = res.data.id;
    });

    it('should create template with empty schemas', async () => {
      const res = await api('POST', '/templates', {
        name: `Minimal_${uid()}`,
        nodeType: 'area',
      }, maintToken);
      expect(res.status).toBe(201);
      expect(res.data.attributeSchema).toEqual([]);
      expect(res.data.telemetrySchema).toEqual([]);
    });

    it('should reject template without name', async () => {
      const res = await api('POST', '/templates', {
        name: '',
        nodeType: 'equipment',
      }, maintToken);
      expect(res.status).toBe(400);
    });

    it('should reject template without nodeType', async () => {
      const res = await api('POST', '/templates', {
        name: `NoType_${uid()}`,
        nodeType: '',
      }, maintToken);
      expect(res.status).toBe(400);
    });

    it('should reject attribute with invalid dataType', async () => {
      const res = await api('POST', '/templates', {
        name: `BadAttr_${uid()}`,
        nodeType: 'equipment',
        attributeSchema: [
          { name: 'field1', dataType: 'invalid_type' },
        ],
      }, maintToken);
      expect(res.status).toBe(400);
    });

    it('should deny OPERATOR from creating templates', async () => {
      const operator = await createTestUser(adminToken, { role: 'OPERATOR' });
      const loginRes = await loginTestUser(operator.username, operator.password, 'OpTempl@Pass1');
      const opToken = loginRes.data.token;

      const res = await api('POST', '/templates', {
        name: `OpTempl_${uid()}`,
        nodeType: 'equipment',
      }, opToken);
      expect(res.status).toBe(403);
    });

    it('should deny VIEWER from creating templates', async () => {
      const viewer = await createTestUser(adminToken, { role: 'VIEWER' });
      const loginRes = await loginTestUser(viewer.username, viewer.password, 'VwTempl@Pass1');
      const vwToken = loginRes.data.token;

      const res = await api('POST', '/templates', {
        name: `VwTempl_${uid()}`,
        nodeType: 'equipment',
      }, vwToken);
      expect(res.status).toBe(403);
    });
  });

  // ─── LIST TEMPLATES ─────────────────────────────────────────
  describe('GET /templates (List)', () => {
    it('should list all templates', async () => {
      const res = await api('GET', '/templates', null, adminToken);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.data)).toBe(true);
    });

    it('should filter by status', async () => {
      const res = await api('GET', '/templates?status=active', null, adminToken);
      expect(res.status).toBe(200);
      for (const t of res.data) {
        expect(t.status).toBe('active');
      }
    });

    it('should filter by nodeType', async () => {
      const res = await api('GET', '/templates?nodeType=equipment', null, adminToken);
      expect(res.status).toBe(200);
      for (const t of res.data) {
        expect(t.nodeType).toBe('equipment');
      }
    });

    it('should search by name', async () => {
      // Create with known name
      const name = `SearchMe_${uid()}`;
      await api('POST', '/templates', { name, nodeType: 'sensor' }, maintToken);

      const res = await api('GET', `/templates?search=${name}`, null, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.some((t: any) => t.name === name)).toBe(true);
    });
  });

  // ─── GET TEMPLATE DETAIL ────────────────────────────────────
  describe('GET /templates/:id (Detail)', () => {
    it('should return template with version history', async () => {
      const res = await api('GET', `/templates/${createdTemplateId}`, null, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.id).toBe(createdTemplateId);
      expect(res.data.templateVersions).toBeDefined();
      expect(Array.isArray(res.data.templateVersions)).toBe(true);
      expect(res.data.templateVersions.length).toBeGreaterThanOrEqual(1);
      expect(res.data._count).toBeDefined();
    });

    it('should return 404 for non-existent template', async () => {
      const res = await api('GET', '/templates/00000000-0000-0000-0000-000000000000', null, adminToken);
      expect(res.status).toBe(404);
    });
  });

  // ─── UPDATE TEMPLATE ────────────────────────────────────────
  describe('PUT /templates/:id (Update)', () => {
    it('should update template and increment version', async () => {
      const res = await api('PUT', `/templates/${createdTemplateId}`, {
        description: 'Updated description',
        reason: 'Test update',
      }, maintToken);
      expect(res.status).toBe(200);
      expect(res.data.version).toBe(2);
    });

    it('should create a new version snapshot on update', async () => {
      const detail = await api('GET', `/templates/${createdTemplateId}`, null, adminToken);
      expect(detail.data.templateVersions.length).toBeGreaterThanOrEqual(2);
    });

    it('should update attributeSchema', async () => {
      const res = await api('PUT', `/templates/${createdTemplateId}`, {
        attributeSchema: [
          { name: 'manufacturer', dataType: 'text', required: true },
          { name: 'capacity', dataType: 'number', unit: 'liters', required: true },
          { name: 'serialNumber', dataType: 'text', required: false },
        ],
        reason: 'Added serial number field',
      }, maintToken);
      expect(res.status).toBe(200);
    });

    it('should reject update without reason', async () => {
      const res = await api('PUT', `/templates/${createdTemplateId}`, {
        description: 'No reason given',
      }, maintToken);
      expect(res.status).toBe(400);
    });

    it('should reject update with empty reason', async () => {
      const res = await api('PUT', `/templates/${createdTemplateId}`, {
        description: 'Empty reason',
        reason: '',
      }, maintToken);
      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent template', async () => {
      const res = await api('PUT', '/templates/00000000-0000-0000-0000-000000000000', {
        description: 'Ghost',
        reason: 'Test',
      }, maintToken);
      expect(res.status).toBe(404);
    });
  });

  // ─── DELETE TEMPLATE (soft) ─────────────────────────────────
  describe('DELETE /templates/:id', () => {
    it('should soft-delete (deactivate) a template', async () => {
      // Create one to delete
      const createRes = await api('POST', '/templates', {
        name: `ToDelete_${uid()}`,
        nodeType: 'equipment',
      }, maintToken);
      const id = createRes.data.id;

      const res = await api('DELETE', `/templates/${id}`, { reason: 'Test deletion' }, maintToken);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);

      // Verify status
      const detail = await api('GET', `/templates/${id}`, null, adminToken);
      expect(detail.data.status).toBe('inactive');
    });

    it('should return 404 for non-existent template', async () => {
      const res = await api('DELETE', '/templates/00000000-0000-0000-0000-000000000000', { reason: 'Test' }, maintToken);
      expect(res.status).toBe(404);
    });
  });
});
