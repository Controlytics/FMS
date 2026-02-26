import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp, loginAs, authGet, authPost, authPut, authDelete } from './test-helper.js';

// Use unique suffixes to avoid collisions between test runs
const SUFFIX = Date.now().toString(36);

describe('Rule Chain endpoints', () => {
  let app: FastifyInstance;
  let adminToken: string;

  // IDs tracked across tests
  let chainId: string;
  let nodeAId: string;
  let nodeBId: string;
  let connectionId: string;

  beforeAll(async () => {
    app = await buildApp();
    adminToken = await loginAs(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // =============================================
  // Create a rule chain
  // =============================================
  describe('Create rule chain', () => {
    it('POST /api/rule-chains creates a new rule chain', async () => {
      const res = await authPost(app, '/api/rule-chains', adminToken, {
        name: `Test Chain ${SUFFIX}`,
        description: 'E2E test rule chain',
        configuration: { retryCount: 3 },
        isRoot: false,
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.name).toBe(`Test Chain ${SUFFIX}`);
      expect(body.data.description).toBe('E2E test rule chain');
      expect(body.data.isRoot).toBe(false);
      expect(body.data.isActive).toBe(true);
      expect(body.data.id).toBeTruthy();
      chainId = body.data.id;
    });

    it('POST /api/rule-chains rejects missing name', async () => {
      const res = await authPost(app, '/api/rule-chains', adminToken, {
        description: 'No name provided',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // =============================================
  // Get the chain by ID
  // =============================================
  describe('Get rule chain by ID', () => {
    it('GET /api/rule-chains/:id returns the chain with nodes, connections, versions', async () => {
      expect(chainId).toBeTruthy();
      const res = await authGet(app, `/api/rule-chains/${chainId}`, adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.id).toBe(chainId);
      expect(body.name).toBe(`Test Chain ${SUFFIX}`);
      expect(Array.isArray(body.nodes)).toBe(true);
      expect(Array.isArray(body.connections)).toBe(true);
      expect(Array.isArray(body.versions)).toBe(true);
    });

    it('GET /api/rule-chains/:id returns 404 for non-existent chain', async () => {
      const res = await authGet(app, '/api/rule-chains/00000000-0000-0000-0000-000000000000', adminToken);
      expect(res.statusCode).toBe(404);
    });
  });

  // =============================================
  // Add nodes
  // =============================================
  describe('Add nodes to chain', () => {
    it('POST /api/rule-chains/:id/nodes adds first node (filter)', async () => {
      expect(chainId).toBeTruthy();
      const res = await authPost(app, `/api/rule-chains/${chainId}/nodes`, adminToken, {
        type: 'msg_type_filter',
        name: `Filter Node ${SUFFIX}`,
        configuration: { messageTypes: ['POST_TELEMETRY'] },
        positionX: 100,
        positionY: 200,
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.type).toBe('msg_type_filter');
      expect(body.data.name).toBe(`Filter Node ${SUFFIX}`);
      expect(body.data.ruleChainId).toBe(chainId);
      nodeAId = body.data.id;
    });

    it('POST /api/rule-chains/:id/nodes adds second node (action)', async () => {
      expect(chainId).toBeTruthy();
      const res = await authPost(app, `/api/rule-chains/${chainId}/nodes`, adminToken, {
        type: 'log_action',
        name: `Log Node ${SUFFIX}`,
        configuration: { logLevel: 'INFO' },
        positionX: 300,
        positionY: 200,
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.type).toBe('log_action');
      nodeBId = body.data.id;
    });

    it('POST /api/rule-chains/:id/nodes returns 404 for non-existent chain', async () => {
      const res = await authPost(app, '/api/rule-chains/00000000-0000-0000-0000-000000000000/nodes', adminToken, {
        type: 'log_action',
        name: 'Orphan Node',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // =============================================
  // Add connection between nodes
  // =============================================
  describe('Add connection between nodes', () => {
    it('POST /api/rule-chains/:id/connections creates a connection', async () => {
      expect(chainId).toBeTruthy();
      expect(nodeAId).toBeTruthy();
      expect(nodeBId).toBeTruthy();

      const res = await authPost(app, `/api/rule-chains/${chainId}/connections`, adminToken, {
        fromNodeId: nodeAId,
        toNodeId: nodeBId,
        label: 'True',
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.fromNodeId).toBe(nodeAId);
      expect(body.data.toNodeId).toBe(nodeBId);
      expect(body.data.label).toBe('True');
      expect(body.data.ruleChainId).toBe(chainId);
      connectionId = body.data.id;
    });

    it('POST /api/rule-chains/:id/connections returns 404 for bad source node', async () => {
      expect(chainId).toBeTruthy();
      expect(nodeBId).toBeTruthy();

      const res = await authPost(app, `/api/rule-chains/${chainId}/connections`, adminToken, {
        fromNodeId: '00000000-0000-0000-0000-000000000000',
        toNodeId: nodeBId,
        label: 'False',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // =============================================
  // Update a node
  // =============================================
  describe('Update node', () => {
    it('PUT /api/rule-chains/:id/nodes/:nodeId updates the node', async () => {
      expect(chainId).toBeTruthy();
      expect(nodeAId).toBeTruthy();

      const res = await authPut(app, `/api/rule-chains/${chainId}/nodes/${nodeAId}`, adminToken, {
        name: `Updated Filter ${SUFFIX}`,
        debugEnabled: true,
        positionX: 150,
        positionY: 250,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe(`Updated Filter ${SUFFIX}`);
      expect(body.data.debugEnabled).toBe(true);
      expect(body.data.positionX).toBe(150);
      expect(body.data.positionY).toBe(250);
    });

    it('PUT /api/rule-chains/:id/nodes/:nodeId returns 404 for non-existent node', async () => {
      expect(chainId).toBeTruthy();
      const res = await authPut(app, `/api/rule-chains/${chainId}/nodes/00000000-0000-0000-0000-000000000000`, adminToken, {
        name: 'Ghost Node',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // =============================================
  // Delete connection
  // =============================================
  describe('Delete connection', () => {
    it('DELETE /api/rule-chains/:id/connections/:connectionId deletes the connection', async () => {
      expect(chainId).toBeTruthy();
      expect(connectionId).toBeTruthy();

      const res = await authDelete(app, `/api/rule-chains/${chainId}/connections/${connectionId}`, adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it('DELETE /api/rule-chains/:id/connections/:connectionId returns 404 for non-existent connection', async () => {
      expect(chainId).toBeTruthy();
      const res = await authDelete(app, `/api/rule-chains/${chainId}/connections/00000000-0000-0000-0000-000000000000`, adminToken);
      expect(res.statusCode).toBe(404);
    });
  });

  // =============================================
  // Save full state + create version
  // =============================================
  describe('Save full chain state', () => {
    it('POST /api/rule-chains/:id/save replaces nodes/connections and creates a version', async () => {
      expect(chainId).toBeTruthy();

      const res = await authPost(app, `/api/rule-chains/${chainId}/save`, adminToken, {
        nodes: [
          {
            id: 'temp-node-1',
            type: 'msg_type_filter',
            name: `Saved Filter ${SUFFIX}`,
            configuration: { messageTypes: ['POST_TELEMETRY'] },
            positionX: 50,
            positionY: 100,
          },
          {
            id: 'temp-node-2',
            type: 'log_action',
            name: `Saved Log ${SUFFIX}`,
            configuration: { logLevel: 'DEBUG' },
            positionX: 250,
            positionY: 100,
          },
          {
            id: 'temp-node-3',
            type: 'log_action',
            name: `Saved Log 2 ${SUFFIX}`,
            configuration: { logLevel: 'WARN' },
            positionX: 450,
            positionY: 100,
          },
        ],
        connections: [
          { fromNodeId: 'temp-node-1', toNodeId: 'temp-node-2', label: 'True' },
          { fromNodeId: 'temp-node-1', toNodeId: 'temp-node-3', label: 'False' },
        ],
        firstRuleNodeId: 'temp-node-1',
        changeNotes: 'E2E test save',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.version).toBeGreaterThanOrEqual(1);

      // Verify the saved chain has the new nodes
      expect(body.data.nodes).toHaveLength(3);
      expect(body.data.connections).toHaveLength(2);
    });

    it('POST /api/rule-chains/:id/save returns 404 for non-existent chain', async () => {
      const res = await authPost(app, '/api/rule-chains/00000000-0000-0000-0000-000000000000/save', adminToken, {
        nodes: [],
        connections: [],
      });
      expect(res.statusCode).toBe(404);
    });

    it('GET /api/rule-chains/:id reflects the saved state', async () => {
      expect(chainId).toBeTruthy();
      const res = await authGet(app, `/api/rule-chains/${chainId}`, adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.nodes).toHaveLength(3);
      expect(body.connections).toHaveLength(2);
      expect(body.firstRuleNodeId).toBeTruthy();
      expect(body.currentVersion).toBeGreaterThanOrEqual(1);

      // Verify version history includes the save
      expect(body.versions.length).toBeGreaterThanOrEqual(1);
      const latestVersion = body.versions[0]; // ordered desc
      expect(latestVersion.changeNotes).toBe('E2E test save');
    });
  });

  // =============================================
  // Debug buffer
  // =============================================
  describe('Debug buffer', () => {
    it('GET /api/rule-chains/:id/debug returns debug buffer (empty is ok)', async () => {
      expect(chainId).toBeTruthy();
      const res = await authGet(app, `/api/rule-chains/${chainId}/debug`, adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body)).toBe(true);
    });

    it('GET /api/rule-chains/:id/debug supports ?limit= parameter', async () => {
      expect(chainId).toBeTruthy();
      const res = await authGet(app, `/api/rule-chains/${chainId}/debug?limit=10`, adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body)).toBe(true);
    });

    it('DELETE /api/rule-chains/:id/debug clears the debug buffer', async () => {
      expect(chainId).toBeTruthy();
      const res = await authDelete(app, `/api/rule-chains/${chainId}/debug`, adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });
  });

  // =============================================
  // List and filter rule chains
  // =============================================
  describe('List rule chains', () => {
    it('GET /api/rule-chains returns paginated list', async () => {
      const res = await authGet(app, '/api/rule-chains', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.total).toBeDefined();
      expect(body.page).toBeDefined();
      expect(body.limit).toBeDefined();
      expect(body.totalPages).toBeDefined();

      // The chain we created should be present
      const found = body.data.find((c: { id: string }) => c.id === chainId);
      expect(found).toBeDefined();
      expect(found.name).toBe(`Test Chain ${SUFFIX}`);
    });

    it('GET /api/rule-chains?search= filters by name', async () => {
      const res = await authGet(app, `/api/rule-chains?search=${SUFFIX}`, adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      const found = body.data.find((c: { id: string }) => c.id === chainId);
      expect(found).toBeDefined();
    });

    it('GET /api/rule-chains?isActive=true filters active chains', async () => {
      const res = await authGet(app, '/api/rule-chains?isActive=true', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // All returned chains should be active
      for (const chain of body.data) {
        expect(chain.isActive).toBe(true);
      }
    });

    it('GET /api/rule-chains?isActive=false filters inactive chains', async () => {
      const res = await authGet(app, '/api/rule-chains?isActive=false', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      for (const chain of body.data) {
        expect(chain.isActive).toBe(false);
      }
    });

    it('GET /api/rule-chains?page=1&limit=1 respects pagination', async () => {
      const res = await authGet(app, '/api/rule-chains?page=1&limit=1', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.length).toBeLessThanOrEqual(1);
      expect(body.limit).toBe(1);
      expect(body.page).toBe(1);
    });
  });

  // =============================================
  // Node types
  // =============================================
  describe('Node types', () => {
    it('GET /api/rule-chains/node-types returns available node types', async () => {
      const res = await authGet(app, '/api/rule-chains/node-types', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body)).toBe(true);

      // Each node type should have type, category, name
      if (body.length > 0) {
        const first = body[0];
        expect(first.type).toBeDefined();
        expect(first.category).toBeDefined();
        expect(first.name).toBeDefined();
      }
    });

    it('GET /api/rule-chains/node-types?category= filters by category', async () => {
      // First get all to find a valid category
      const allRes = await authGet(app, '/api/rule-chains/node-types', adminToken);
      const allTypes = JSON.parse(allRes.body);

      if (allTypes.length > 0) {
        const category = allTypes[0].category;
        const res = await authGet(app, `/api/rule-chains/node-types?category=${category}`, adminToken);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        // All returned items should match the requested category
        for (const item of body) {
          expect(item.category).toBe(category);
        }
      }
    });
  });

  // =============================================
  // Update rule chain metadata
  // =============================================
  describe('Update rule chain metadata', () => {
    it('PUT /api/rule-chains/:id updates chain metadata', async () => {
      expect(chainId).toBeTruthy();
      const res = await authPut(app, `/api/rule-chains/${chainId}`, adminToken, {
        name: `Updated Chain ${SUFFIX}`,
        description: 'Updated description',
        isActive: false,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe(`Updated Chain ${SUFFIX}`);
      expect(body.data.description).toBe('Updated description');
      expect(body.data.isActive).toBe(false);
    });

    it('PUT /api/rule-chains/:id returns 404 for non-existent chain', async () => {
      const res = await authPut(app, '/api/rule-chains/00000000-0000-0000-0000-000000000000', adminToken, {
        name: 'Ghost Chain',
      });
      expect(res.statusCode).toBe(404);
    });

    it('PUT /api/rule-chains/:id reactivates the chain for remaining tests', async () => {
      expect(chainId).toBeTruthy();
      const res = await authPut(app, `/api/rule-chains/${chainId}`, adminToken, {
        isActive: true,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.isActive).toBe(true);
    });
  });

  // =============================================
  // Delete rule chain
  // =============================================
  describe('Delete rule chain', () => {
    it('DELETE /api/rule-chains/:id deletes the chain', async () => {
      expect(chainId).toBeTruthy();
      const res = await authDelete(app, `/api/rule-chains/${chainId}`, adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it('GET /api/rule-chains/:id returns 404 after deletion', async () => {
      expect(chainId).toBeTruthy();
      const res = await authGet(app, `/api/rule-chains/${chainId}`, adminToken);
      expect(res.statusCode).toBe(404);
    });

    it('DELETE /api/rule-chains/:id returns 404 for already-deleted chain', async () => {
      expect(chainId).toBeTruthy();
      const res = await authDelete(app, `/api/rule-chains/${chainId}`, adminToken);
      expect(res.statusCode).toBe(404);
    });
  });

  // =============================================
  // System chain protection
  // =============================================
  describe('System chain protection', () => {
    let systemChainId: string | undefined;

    it('finds a system chain (if one exists) and verifies delete is forbidden', async () => {
      // List all chains and look for a system one
      const res = await authGet(app, '/api/rule-chains?limit=100', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const systemChain = body.data.find((c: { isSystem: boolean }) => c.isSystem === true);

      if (systemChain) {
        systemChainId = systemChain.id;
        const delRes = await authDelete(app, `/api/rule-chains/${systemChainId}`, adminToken);
        expect(delRes.statusCode).toBe(403);
        const delBody = JSON.parse(delRes.body);
        expect(delBody.error).toBe('FORBIDDEN');
      }
      // If no system chain exists, this test is a no-op (still passes)
    });
  });

  // =============================================
  // Delete node
  // =============================================
  describe('Delete node (standalone)', () => {
    let tempChainId: string;
    let tempNodeId: string;

    it('creates a temporary chain and node for deletion test', async () => {
      // Create chain
      const chainRes = await authPost(app, '/api/rule-chains', adminToken, {
        name: `Delete Node Chain ${SUFFIX}`,
      });
      expect(chainRes.statusCode).toBe(201);
      const chainBody = JSON.parse(chainRes.body);
      tempChainId = chainBody.data.id;

      // Create node
      const nodeRes = await authPost(app, `/api/rule-chains/${tempChainId}/nodes`, adminToken, {
        type: 'log_action',
        name: `To Delete ${SUFFIX}`,
      });
      expect(nodeRes.statusCode).toBe(201);
      const nodeBody = JSON.parse(nodeRes.body);
      tempNodeId = nodeBody.data.id;
    });

    it('DELETE /api/rule-chains/:id/nodes/:nodeId deletes the node', async () => {
      expect(tempChainId).toBeTruthy();
      expect(tempNodeId).toBeTruthy();

      const res = await authDelete(app, `/api/rule-chains/${tempChainId}/nodes/${tempNodeId}`, adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it('DELETE /api/rule-chains/:id/nodes/:nodeId returns 404 for deleted node', async () => {
      expect(tempChainId).toBeTruthy();
      expect(tempNodeId).toBeTruthy();

      const res = await authDelete(app, `/api/rule-chains/${tempChainId}/nodes/${tempNodeId}`, adminToken);
      expect(res.statusCode).toBe(404);
    });

    it('cleans up temporary chain', async () => {
      expect(tempChainId).toBeTruthy();
      const res = await authDelete(app, `/api/rule-chains/${tempChainId}`, adminToken);
      expect(res.statusCode).toBe(200);
    });
  });
});
