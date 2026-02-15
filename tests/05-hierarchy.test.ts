import { describe, it, expect, beforeAll } from 'vitest';
import { api, getAdminToken, createTestUser, loginTestUser, uid } from './helpers';

describe('HIERARCHY NODE MODULE', () => {
  let adminToken: string;
  let maintToken: string;
  let rootNodeId: string;
  let childNodeId: string;
  let templateId: string;

  beforeAll(async () => {
    adminToken = await getAdminToken();

    // MAINTENANCE has NODE_CREATE/UPDATE/DELETE
    const maint = await createTestUser(adminToken, { role: 'MAINTENANCE' });
    const loginRes = await loginTestUser(maint.username, maint.password, 'MaintHier@Pass1');
    maintToken = loginRes.data.token;

    // Create a template for use in tests
    const tmplRes = await api('POST', '/templates', {
      name: `HierTest_${uid()}`,
      nodeType: 'equipment',
      attributeSchema: [
        { name: 'location', dataType: 'text', defaultValue: 'Building A' },
      ],
    }, maintToken);
    templateId = tmplRes.data.id;
  });

  // ─── CREATE NODE ────────────────────────────────────────────
  describe('POST /hierarchy (Create)', () => {
    it('should create a root node', async () => {
      const name = `Site_${uid()}`;
      const res = await api('POST', '/hierarchy', {
        name,
        nodeType: 'site',
        attributes: { country: 'India' },
      }, maintToken);

      expect(res.status).toBe(201);
      expect(res.data.id).toBeDefined();
      expect(res.data.name).toBe(name);
      expect(res.data.nodeType).toBe('site');
      expect(res.data.parentId).toBeNull();
      expect(res.data.unsPath).toBeDefined();
      expect(res.data.status).toBe('active');
      rootNodeId = res.data.id;
    });

    it('should create a child node', async () => {
      const name = `Area_${uid()}`;
      const res = await api('POST', '/hierarchy', {
        parentId: rootNodeId,
        name,
        nodeType: 'area',
      }, maintToken);

      expect(res.status).toBe(201);
      expect(res.data.parentId).toBe(rootNodeId);
      expect(res.data.unsPath).toContain('.');
      childNodeId = res.data.id;
    });

    it('should create node with template and merge attributes', async () => {
      const res = await api('POST', '/hierarchy', {
        parentId: rootNodeId,
        name: `Equip_${uid()}`,
        nodeType: 'equipment',
        templateId,
        attributes: { serialNo: 'SN-001' },
      }, maintToken);

      expect(res.status).toBe(201);
      expect(res.data.templateId).toBe(templateId);
      // Should have merged template default + custom attribute
      const attrs = res.data.attributes as Record<string, unknown>;
      expect(attrs.location).toBe('Building A'); // from template default
      expect(attrs.serialNo).toBe('SN-001'); // from request
    });

    it('should reject node without name', async () => {
      const res = await api('POST', '/hierarchy', {
        name: '',
        nodeType: 'site',
      }, maintToken);
      expect(res.status).toBe(400);
    });

    it('should reject node without nodeType', async () => {
      const res = await api('POST', '/hierarchy', {
        name: `NoType_${uid()}`,
        nodeType: '',
      }, maintToken);
      expect(res.status).toBe(400);
    });

    it('should reject non-existent parentId', async () => {
      const res = await api('POST', '/hierarchy', {
        parentId: '00000000-0000-0000-0000-000000000000',
        name: `Orphan_${uid()}`,
        nodeType: 'area',
      }, maintToken);
      expect(res.status).toBe(404);
    });

    it('should reject non-existent templateId', async () => {
      const res = await api('POST', '/hierarchy', {
        name: `BadTmpl_${uid()}`,
        nodeType: 'equipment',
        templateId: '00000000-0000-0000-0000-000000000000',
      }, maintToken);
      expect(res.status).toBe(404);
    });

    it('should deny VIEWER from creating nodes', async () => {
      const viewer = await createTestUser(adminToken, { role: 'VIEWER' });
      const loginRes = await loginTestUser(viewer.username, viewer.password, 'VwHier@Pass1');
      const vwToken = loginRes.data.token;

      const res = await api('POST', '/hierarchy', {
        name: `VwNode_${uid()}`,
        nodeType: 'site',
      }, vwToken);
      expect(res.status).toBe(403);
    });
  });

  // ─── LIST / TREE ────────────────────────────────────────────
  describe('GET /hierarchy (List & Tree)', () => {
    it('should list root nodes', async () => {
      const res = await api('GET', '/hierarchy', null, adminToken);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.data)).toBe(true);
      // All root nodes should have parentId null
      for (const node of res.data) {
        expect(node.parentId).toBeNull();
      }
    });

    it('should list children of a parent', async () => {
      const res = await api('GET', `/hierarchy?parentId=${rootNodeId}`, null, adminToken);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.data)).toBe(true);
      for (const node of res.data) {
        expect(node.parentId).toBe(rootNodeId);
      }
    });

    it('should return full tree', async () => {
      const res = await api('GET', '/hierarchy/tree', null, adminToken);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.data)).toBe(true);
      expect(res.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── GET NODE DETAIL ────────────────────────────────────────
  describe('GET /hierarchy/:id (Detail)', () => {
    it('should return node with children, parent, template, identifiers', async () => {
      const res = await api('GET', `/hierarchy/${rootNodeId}`, null, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.id).toBe(rootNodeId);
      expect(res.data.children).toBeDefined();
      expect(Array.isArray(res.data.children)).toBe(true);
      expect(res.data.identifiers).toBeDefined();
    });

    it('should return 404 for non-existent node', async () => {
      const res = await api('GET', '/hierarchy/00000000-0000-0000-0000-000000000000', null, adminToken);
      expect(res.status).toBe(404);
    });
  });

  // ─── ANCESTORS ──────────────────────────────────────────────
  describe('GET /hierarchy/:id/ancestors', () => {
    it('should return ancestor chain for child node', async () => {
      const res = await api('GET', `/hierarchy/${childNodeId}/ancestors`, null, adminToken);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.data)).toBe(true);
      // Should contain the root node as ancestor
      expect(res.data.some((a: any) => a.id === rootNodeId)).toBe(true);
    });

    it('should return empty array for root node', async () => {
      const res = await api('GET', `/hierarchy/${rootNodeId}/ancestors`, null, adminToken);
      expect(res.status).toBe(200);
      expect(res.data).toEqual([]);
    });
  });

  // ─── UPDATE NODE ────────────────────────────────────────────
  describe('PUT /hierarchy/:id (Update)', () => {
    it('should update node name', async () => {
      const newName = `Updated_${uid()}`;
      const res = await api('PUT', `/hierarchy/${childNodeId}`, {
        name: newName,
        reason: 'Renaming for test',
      }, maintToken);
      expect(res.status).toBe(200);
      expect(res.data.name).toBe(newName);
    });

    it('should update node attributes', async () => {
      const res = await api('PUT', `/hierarchy/${rootNodeId}`, {
        attributes: { country: 'USA', region: 'West' },
        reason: 'Adding region attribute',
      }, maintToken);
      expect(res.status).toBe(200);
      const attrs = res.data.attributes as Record<string, unknown>;
      expect(attrs.region).toBe('West');
    });

    it('should update node status', async () => {
      const res = await api('PUT', `/hierarchy/${childNodeId}`, {
        status: 'inactive',
        reason: 'Deactivating for maintenance',
      }, maintToken);
      expect(res.status).toBe(200);
      expect(res.data.status).toBe('inactive');

      // Restore
      await api('PUT', `/hierarchy/${childNodeId}`, {
        status: 'active',
        reason: 'Reactivating after maintenance',
      }, maintToken);
    });

    it('should reject update without reason', async () => {
      const res = await api('PUT', `/hierarchy/${childNodeId}`, {
        name: 'NoReason',
      }, maintToken);
      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent node', async () => {
      const res = await api('PUT', '/hierarchy/00000000-0000-0000-0000-000000000000', {
        name: 'Ghost',
        reason: 'test',
      }, maintToken);
      expect(res.status).toBe(404);
    });
  });

  // ─── IDENTIFIERS ───────────────────────────────────────────
  describe('POST /hierarchy/:id/identifiers', () => {
    it('should add QR identifier to node', async () => {
      const res = await api('POST', `/hierarchy/${rootNodeId}/identifiers`, {
        type: 'QR',
        value: `QR-${uid()}`,
      }, maintToken);
      expect(res.status).toBe(201);
      expect(res.data.id).toBeDefined();
      expect(res.data.type).toBe('QR');
    });

    it('should add RFID identifier', async () => {
      const res = await api('POST', `/hierarchy/${rootNodeId}/identifiers`, {
        type: 'RFID',
        value: `RFID-${uid()}`,
      }, maintToken);
      expect(res.status).toBe(201);
      expect(res.data.type).toBe('RFID');
    });

    it('should add BARCODE identifier', async () => {
      const res = await api('POST', `/hierarchy/${rootNodeId}/identifiers`, {
        type: 'BARCODE',
        value: `BC-${uid()}`,
      }, maintToken);
      expect(res.status).toBe(201);
    });

    it('should add NFC identifier', async () => {
      const res = await api('POST', `/hierarchy/${rootNodeId}/identifiers`, {
        type: 'NFC',
        value: `NFC-${uid()}`,
      }, maintToken);
      expect(res.status).toBe(201);
    });

    it('should add MANUAL identifier', async () => {
      const res = await api('POST', `/hierarchy/${rootNodeId}/identifiers`, {
        type: 'MANUAL',
        value: `MAN-${uid()}`,
      }, maintToken);
      expect(res.status).toBe(201);
    });

    it('should reject invalid identifier type', async () => {
      const res = await api('POST', `/hierarchy/${rootNodeId}/identifiers`, {
        type: 'INVALID',
        value: 'test',
      }, maintToken);
      expect(res.status).toBe(400);
    });

    it('should reject empty value', async () => {
      const res = await api('POST', `/hierarchy/${rootNodeId}/identifiers`, {
        type: 'QR',
        value: '',
      }, maintToken);
      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent node', async () => {
      const res = await api('POST', '/hierarchy/00000000-0000-0000-0000-000000000000/identifiers', {
        type: 'QR',
        value: `QR-${uid()}`,
      }, maintToken);
      expect(res.status).toBe(404);
    });
  });

  // ─── DELETE NODE ────────────────────────────────────────────
  describe('DELETE /hierarchy/:id', () => {
    it('should reject deleting node with children', async () => {
      const res = await api('DELETE', `/hierarchy/${rootNodeId}`, { reason: 'Test deletion' }, maintToken);
      expect(res.status).toBe(400);
    });

    it('should soft-delete (decommission) a leaf node', async () => {
      // Create a leaf node
      const leaf = await api('POST', '/hierarchy', {
        name: `Leaf_${uid()}`,
        nodeType: 'sensor',
      }, maintToken);

      const res = await api('DELETE', `/hierarchy/${leaf.data.id}`, { reason: 'Test deletion' }, maintToken);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);

      // Verify status
      const detail = await api('GET', `/hierarchy/${leaf.data.id}`, null, adminToken);
      expect(detail.data.status).toBe('decommissioned');
    });

    it('should return 404 for non-existent node', async () => {
      const res = await api('DELETE', '/hierarchy/00000000-0000-0000-0000-000000000000', { reason: 'Test' }, maintToken);
      expect(res.status).toBe(404);
    });
  });
});
