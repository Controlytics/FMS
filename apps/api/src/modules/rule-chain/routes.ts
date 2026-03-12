import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { errorResponses } from '../../lib/error-schemas.js';
import { invalidateChainCache } from './rule-engine.js';
import { getDebugBuffer, clearDebugBuffer } from './debug-recorder.js';
import { getAllNodes, getNodesByCategory } from './node-registry.js';
import { auditLog } from '../../lib/audit.js';
import { enforceReauth } from '../../lib/reauth-check.js';
import './nodes/index.js'; // Auto-register all nodes

export default async function ruleChainRoutes(app: FastifyInstance) {

  // ─── 1. GET / — List rule chains (paginated) ──────────
  app.get('/', {
    preHandler: [app.requirePermission('RULE_CHAIN_MANAGE')],
    schema: {
      tags: ['Rule Chains'],
      summary: 'List rule chains',
      description: 'List rule chains with optional search, isActive filter, and pagination.',
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Search by name' },
          isActive: { type: 'string', description: '"true" or "false"' },
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  isRoot: { type: 'boolean' },
                  isSystem: { type: 'boolean' },
                  firstRuleNodeId: { type: 'string' },
                  configuration: { type: 'object', additionalProperties: true },
                  currentVersion: { type: 'integer' },
                  isActive: { type: 'boolean' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                  _count: {
                    type: 'object',
                    properties: {
                      nodes: { type: 'integer' },
                      connections: { type: 'integer' },
                    },
                  },
                },
              },
            },
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { search, isActive, page: rawPage, limit: rawLimit } = req.query as {
      search?: string;
      isActive?: string;
      page?: number;
      limit?: number;
    };

    const page = Math.max(1, Number(rawPage) || 1);
    const limit = rawLimit ? Math.max(1, Number(rawLimit)) : undefined;
    const skip = limit ? (page - 1) * limit : 0;

    const where: Prisma.RuleChainWhereInput = {};
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (isActive === 'true') where.isActive = true;
    if (isActive === 'false') where.isActive = false;

    const [data, total] = await Promise.all([
      prisma.ruleChain.findMany({
        where,
        ...(limit ? { skip, take: limit } : {}),
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { nodes: true, connections: true } },
        },
      }),
      prisma.ruleChain.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit: limit ?? total,
      totalPages: limit ? Math.ceil(total / limit) : 1,
    };
  });

  // ─── 2. GET /node-types — List available node type definitions ──
  app.get('/node-types', {
    preHandler: [app.requirePermission('RULE_CHAIN_MANAGE')],
    schema: {
      tags: ['Rule Chains'],
      summary: 'List available node types',
      description: 'Returns all registered node type definitions. Optionally filter by category.',
      querystring: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Filter by category (INPUT, FILTER, ENRICHMENT, TRANSFORM, ACTION, EXTERNAL, FLOW, ANALYTICS)' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              category: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string' },
              outputs: { type: 'array', items: { type: 'string' } },
              defaultConfig: { type: 'object', additionalProperties: true },
              configSchema: { type: 'object', additionalProperties: true },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { category } = req.query as { category?: string };

    const nodes = category ? getNodesByCategory(category) : getAllNodes();

    return nodes.map((n) => ({
      type: n.type,
      category: n.category,
      name: n.name,
      description: n.description,
      outputs: n.outputs,
      defaultConfig: n.defaultConfig,
      configSchema: n.configSchema,
    }));
  });

  // ─── 3. GET /:id — Get single rule chain with nodes + connections ──
  app.get('/:id', {
    preHandler: [app.requirePermission('RULE_CHAIN_MANAGE')],
    schema: {
      tags: ['Rule Chains'],
      summary: 'Get rule chain by ID',
      description: 'Retrieve a single rule chain by UUID, including nodes, connections, and recent versions.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            isRoot: { type: 'boolean' },
            isSystem: { type: 'boolean' },
            firstRuleNodeId: { type: 'string' },
            configuration: { type: 'object', additionalProperties: true },
            currentVersion: { type: 'integer' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
            nodes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  ruleChainId: { type: 'string' },
                  type: { type: 'string' },
                  name: { type: 'string' },
                  configuration: { type: 'object', additionalProperties: true },
                  debugEnabled: { type: 'boolean' },
                  positionX: { type: 'number' },
                  positionY: { type: 'number' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                },
              },
            },
            connections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  ruleChainId: { type: 'string' },
                  fromNodeId: { type: 'string' },
                  toNodeId: { type: 'string' },
                  label: { type: 'string' },
                },
              },
            },
            versions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  ruleChainId: { type: 'string' },
                  version: { type: 'integer' },
                  snapshot: { type: 'object', additionalProperties: true },
                  status: { type: 'string' },
                  createdBy: { type: 'string' },
                  changeNotes: { type: 'string' },
                  createdAt: { type: 'string' },
                },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const chain = await prisma.ruleChain.findUnique({
      where: { id },
      include: {
        nodes: { orderBy: { createdAt: 'asc' } },
        connections: true,
        versions: { orderBy: { version: 'desc' }, take: 10 },
      },
    });

    if (!chain) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Rule chain not found' });
    }

    return chain;
  });

  // ─── 4. POST / — Create rule chain ────────────────────
  app.post('/', {
    preHandler: [app.requirePermission('RULE_CHAIN_MANAGE')],
    schema: {
      tags: ['Rule Chains'],
      summary: 'Create rule chain',
      description: 'Create a new rule chain.',
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          configuration: { type: 'object', additionalProperties: true },
          isRoot: { type: 'boolean' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('CREATE_RULE_CHAIN', req, reply);
    if (!ok) return;

    const body = req.body as {
      name: string;
      description?: string;
      configuration?: Record<string, unknown>;
      isRoot?: boolean;
    };

    const chain = await prisma.ruleChain.create({
      data: {
        name: body.name,
        description: body.description ?? null,
        configuration: (body.configuration ?? {}) as Prisma.InputJsonValue,
        isRoot: body.isRoot ?? false,
      },
    });

    await auditLog({
      userId: req.user?.username, userRole: req.user?.role, action: 'RULE_CHAIN_CREATED',
      targetType: 'rule_chain', targetId: chain.id,
      afterValue: { name: chain.name, description: chain.description },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return reply.code(201).send({ success: true, data: chain });
  });

  // ─── 5. PUT /:id — Update rule chain metadata ─────────
  app.put('/:id', {
    preHandler: [app.requirePermission('RULE_CHAIN_MANAGE')],
    schema: {
      tags: ['Rule Chains'],
      summary: 'Update rule chain',
      description: 'Update rule chain metadata (name, description, configuration, isActive, firstRuleNodeId).',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          configuration: { type: 'object', additionalProperties: true },
          isActive: { type: 'boolean' },
          firstRuleNodeId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_RULE_CHAIN', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      description?: string;
      configuration?: Record<string, unknown>;
      isActive?: boolean;
      firstRuleNodeId?: string;
    };

    const existing = await prisma.ruleChain.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Rule chain not found' });
    }

    const updateData: Prisma.RuleChainUpdateInput = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.configuration !== undefined) updateData.configuration = body.configuration as Prisma.InputJsonValue;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.firstRuleNodeId !== undefined) updateData.firstRuleNodeId = body.firstRuleNodeId;

    const chain = await prisma.ruleChain.update({
      where: { id },
      data: updateData,
    });

    invalidateChainCache(id);

    await auditLog({
      userId: req.user?.username, userRole: req.user?.role, action: 'RULE_CHAIN_UPDATED',
      targetType: 'rule_chain', targetId: id,
      beforeValue: { name: existing.name, isActive: existing.isActive },
      afterValue: { name: chain.name, isActive: chain.isActive },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return { success: true, data: chain };
  });

  // ─── 6. DELETE /:id — Delete rule chain ────────────────
  app.delete('/:id', {
    preHandler: [app.requirePermission('RULE_CHAIN_MANAGE')],
    schema: {
      tags: ['Rule Chains'],
      summary: 'Delete rule chain',
      description: 'Delete a rule chain. System chains (isSystem=true) cannot be deleted. Cascades to nodes/connections.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('DELETE_RULE_CHAIN', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };

    const chain = await prisma.ruleChain.findUnique({ where: { id } });
    if (!chain) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Rule chain not found' });
    }

    if (chain.isSystem) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Cannot delete a system rule chain' });
    }

    await prisma.ruleChain.delete({ where: { id } });

    invalidateChainCache(id);

    await auditLog({
      userId: req.user?.username, userRole: req.user?.role, action: 'RULE_CHAIN_DELETED',
      targetType: 'rule_chain', targetId: id,
      beforeValue: { name: chain.name },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return { success: true };
  });

  // ─── 7. POST /:id/nodes — Add node to chain ───────────
  app.post('/:id/nodes', {
    preHandler: [app.requirePermission('RULE_CHAIN_MANAGE')],
    schema: {
      tags: ['Rule Chains'],
      summary: 'Add node to rule chain',
      description: 'Create a new node in a rule chain.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['type', 'name'],
        properties: {
          type: { type: 'string' },
          name: { type: 'string' },
          configuration: { type: 'object', additionalProperties: true },
          positionX: { type: 'number' },
          positionY: { type: 'number' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      type: string;
      name: string;
      configuration?: Record<string, unknown>;
      positionX?: number;
      positionY?: number;
    };

    const chain = await prisma.ruleChain.findUnique({ where: { id } });
    if (!chain) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Rule chain not found' });
    }

    const node = await prisma.ruleNode.create({
      data: {
        ruleChainId: id,
        type: body.type,
        name: body.name,
        configuration: (body.configuration ?? {}) as Prisma.InputJsonValue,
        positionX: body.positionX ?? 0,
        positionY: body.positionY ?? 0,
      },
    });

    invalidateChainCache(id);

    return reply.code(201).send({ success: true, data: node });
  });

  // ─── 8. PUT /:id/nodes/:nodeId — Update node ──────────
  app.put('/:id/nodes/:nodeId', {
    preHandler: [app.requirePermission('RULE_CHAIN_MANAGE')],
    schema: {
      tags: ['Rule Chains'],
      summary: 'Update rule chain node',
      description: 'Update a node in a rule chain.',
      params: {
        type: 'object',
        required: ['id', 'nodeId'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          nodeId: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          configuration: { type: 'object', additionalProperties: true },
          debugEnabled: { type: 'boolean' },
          positionX: { type: 'number' },
          positionY: { type: 'number' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { id, nodeId } = req.params as { id: string; nodeId: string };
    const body = req.body as {
      name?: string;
      configuration?: Record<string, unknown>;
      debugEnabled?: boolean;
      positionX?: number;
      positionY?: number;
    };

    const existing = await prisma.ruleNode.findFirst({
      where: { id: nodeId, ruleChainId: id },
    });
    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Node not found in this rule chain' });
    }

    const updateData: Prisma.RuleNodeUpdateInput = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.configuration !== undefined) updateData.configuration = body.configuration as Prisma.InputJsonValue;
    if (body.debugEnabled !== undefined) updateData.debugEnabled = body.debugEnabled;
    if (body.positionX !== undefined) updateData.positionX = body.positionX;
    if (body.positionY !== undefined) updateData.positionY = body.positionY;

    const node = await prisma.ruleNode.update({
      where: { id: nodeId },
      data: updateData,
    });

    invalidateChainCache(id);

    return { success: true, data: node };
  });

  // ─── 9. DELETE /:id/nodes/:nodeId — Delete node ───────
  app.delete('/:id/nodes/:nodeId', {
    preHandler: [app.requirePermission('RULE_CHAIN_MANAGE')],
    schema: {
      tags: ['Rule Chains'],
      summary: 'Delete rule chain node',
      description: 'Delete a node from a rule chain. Cascades to connections involving this node.',
      params: {
        type: 'object',
        required: ['id', 'nodeId'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          nodeId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { id, nodeId } = req.params as { id: string; nodeId: string };

    const existing = await prisma.ruleNode.findFirst({
      where: { id: nodeId, ruleChainId: id },
    });
    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Node not found in this rule chain' });
    }

    await prisma.ruleNode.delete({ where: { id: nodeId } });

    invalidateChainCache(id);

    return { success: true };
  });

  // ─── 10. POST /:id/connections — Add connection ───────
  app.post('/:id/connections', {
    preHandler: [app.requirePermission('RULE_CHAIN_MANAGE')],
    schema: {
      tags: ['Rule Chains'],
      summary: 'Add connection between nodes',
      description: 'Create a connection between two nodes in a rule chain.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['fromNodeId', 'toNodeId', 'label'],
        properties: {
          fromNodeId: { type: 'string', format: 'uuid' },
          toNodeId: { type: 'string', format: 'uuid' },
          label: { type: 'string' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      fromNodeId: string;
      toNodeId: string;
      label: string;
    };

    // Verify both nodes belong to this chain
    const [fromNode, toNode] = await Promise.all([
      prisma.ruleNode.findFirst({ where: { id: body.fromNodeId, ruleChainId: id } }),
      prisma.ruleNode.findFirst({ where: { id: body.toNodeId, ruleChainId: id } }),
    ]);

    if (!fromNode) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Source node not found in this rule chain' });
    }
    if (!toNode) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Target node not found in this rule chain' });
    }

    const connection = await prisma.ruleNodeConnection.create({
      data: {
        ruleChainId: id,
        fromNodeId: body.fromNodeId,
        toNodeId: body.toNodeId,
        label: body.label,
      },
    });

    invalidateChainCache(id);

    return reply.code(201).send({ success: true, data: connection });
  });

  // ─── 11. DELETE /:id/connections/:connectionId — Delete connection ──
  app.delete('/:id/connections/:connectionId', {
    preHandler: [app.requirePermission('RULE_CHAIN_MANAGE')],
    schema: {
      tags: ['Rule Chains'],
      summary: 'Delete connection',
      description: 'Delete a connection between nodes in a rule chain.',
      params: {
        type: 'object',
        required: ['id', 'connectionId'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          connectionId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { id, connectionId } = req.params as { id: string; connectionId: string };

    const existing = await prisma.ruleNodeConnection.findFirst({
      where: { id: connectionId, ruleChainId: id },
    });
    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Connection not found in this rule chain' });
    }

    await prisma.ruleNodeConnection.delete({ where: { id: connectionId } });

    invalidateChainCache(id);

    return { success: true };
  });

  // ─── 12. POST /:id/save — Save full chain state + create version ──
  app.post('/:id/save', {
    preHandler: [app.requirePermission('RULE_CHAIN_MANAGE')],
    schema: {
      tags: ['Rule Chains'],
      summary: 'Save full chain state',
      description: 'Replace all nodes and connections, then create a version snapshot. Atomically deletes existing nodes/connections and recreates from body.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['nodes', 'connections'],
        properties: {
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              required: ['type', 'name'],
              properties: {
                id: { type: 'string' },
                type: { type: 'string' },
                name: { type: 'string' },
                configuration: { type: 'object', additionalProperties: true },
                positionX: { type: 'number' },
                positionY: { type: 'number' },
              },
            },
          },
          connections: {
            type: 'array',
            items: {
              type: 'object',
              required: ['fromNodeId', 'toNodeId', 'label'],
              properties: {
                fromNodeId: { type: 'string' },
                toNodeId: { type: 'string' },
                label: { type: 'string' },
              },
            },
          },
          firstRuleNodeId: { type: 'string' },
          changeNotes: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
            version: { type: 'integer' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_RULE_CHAIN', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const body = req.body as {
      nodes: Array<{
        id?: string;
        type: string;
        name: string;
        configuration?: Record<string, unknown>;
        positionX?: number;
        positionY?: number;
      }>;
      connections: Array<{
        fromNodeId: string;
        toNodeId: string;
        label: string;
      }>;
      firstRuleNodeId?: string;
      changeNotes?: string;
    };

    const chain = await prisma.ruleChain.findUnique({ where: { id } });
    if (!chain) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Rule chain not found' });
    }

    const newVersion = chain.currentVersion + 1;

    // Build a map from old/temp node IDs to new DB-generated UUIDs
    const nodeIdMap = new Map<string, string>();

    const result = await prisma.$transaction(async (tx) => {
      // Delete existing connections first (FK constraint), then nodes
      await tx.ruleNodeConnection.deleteMany({ where: { ruleChainId: id } });
      await tx.ruleNode.deleteMany({ where: { ruleChainId: id } });

      // Create new nodes
      const createdNodes = [];
      for (const nodeDef of body.nodes) {
        const node = await tx.ruleNode.create({
          data: {
            ruleChainId: id,
            type: nodeDef.type,
            name: nodeDef.name,
            configuration: (nodeDef.configuration ?? {}) as Prisma.InputJsonValue,
            positionX: nodeDef.positionX ?? 0,
            positionY: nodeDef.positionY ?? 0,
          },
        });
        createdNodes.push(node);
        if (nodeDef.id) {
          nodeIdMap.set(nodeDef.id, node.id);
        }
      }

      // Create new connections (remap node IDs)
      const createdConnections = [];
      for (const connDef of body.connections) {
        const fromNodeId = nodeIdMap.get(connDef.fromNodeId) ?? connDef.fromNodeId;
        const toNodeId = nodeIdMap.get(connDef.toNodeId) ?? connDef.toNodeId;

        const connection = await tx.ruleNodeConnection.create({
          data: {
            ruleChainId: id,
            fromNodeId,
            toNodeId,
            label: connDef.label,
          },
        });
        createdConnections.push(connection);
      }

      // Resolve firstRuleNodeId
      let resolvedFirstNodeId = body.firstRuleNodeId
        ? (nodeIdMap.get(body.firstRuleNodeId) ?? body.firstRuleNodeId)
        : null;

      // Create version snapshot
      const snapshot = {
        nodes: createdNodes.map((n) => ({
          id: n.id,
          type: n.type,
          name: n.name,
          configuration: n.configuration,
          positionX: n.positionX,
          positionY: n.positionY,
        })),
        connections: createdConnections.map((c) => ({
          id: c.id,
          fromNodeId: c.fromNodeId,
          toNodeId: c.toNodeId,
          label: c.label,
        })),
        firstRuleNodeId: resolvedFirstNodeId,
      };

      await tx.ruleChainVersion.create({
        data: {
          ruleChainId: id,
          version: newVersion,
          snapshot: snapshot as Prisma.InputJsonValue,
          createdBy: req.user?.username ?? 'system',
          changeNotes: body.changeNotes ?? null,
        },
      });

      // Update chain version and firstRuleNodeId
      const updatedChain = await tx.ruleChain.update({
        where: { id },
        data: {
          currentVersion: newVersion,
          firstRuleNodeId: resolvedFirstNodeId,
        },
        include: {
          nodes: { orderBy: { createdAt: 'asc' } },
          connections: true,
        },
      });

      return updatedChain;
    });

    invalidateChainCache(id);

    await auditLog({
      userId: req.user?.username, userRole: req.user?.role, action: 'RULE_CHAIN_UPDATED',
      targetType: 'rule_chain', targetId: id,
      afterValue: { version: newVersion, nodeCount: body.nodes.length, connectionCount: body.connections.length },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return { success: true, data: result, version: newVersion };
  });

  // ─── 13. GET /:id/debug — Get debug buffer for chain ──
  app.get('/:id/debug', {
    preHandler: [app.requirePermission('RULE_CHAIN_MANAGE')],
    schema: {
      tags: ['Rule Chains'],
      summary: 'Get debug buffer',
      description: 'Returns the in-memory debug buffer for a rule chain.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Max number of debug records to return' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nodeId: { type: 'string' },
              nodeType: { type: 'string' },
              nodeName: { type: 'string' },
              inputMsg: { type: 'object', additionalProperties: true },
              outputMsg: { type: 'object', additionalProperties: true },
              output: { type: 'string' },
              durationMs: { type: 'number' },
              timestamp: { type: 'string' },
              error: { type: 'string' },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const { limit: rawLimit } = req.query as { limit?: number };
    const limit = Number(rawLimit) || 50;

    return getDebugBuffer(id, limit);
  });

  // ─── 14. DELETE /:id/debug — Clear debug buffer ───────
  app.delete('/:id/debug', {
    preHandler: [app.requirePermission('RULE_CHAIN_MANAGE')],
    schema: {
      tags: ['Rule Chains'],
      summary: 'Clear debug buffer',
      description: 'Clear the in-memory debug buffer for a rule chain.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };

    clearDebugBuffer(id);

    return { success: true };
  });
}
