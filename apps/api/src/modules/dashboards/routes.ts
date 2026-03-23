import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { getTsdbPool } from '@digilog/db';
import { getTenantId } from "../../lib/tenant-utils.js";

/**
 * Dashboard routes — widget-based dashboards with assignment
 * Prefix: /api/dashboards
 */
export default async function dashboardRoutes(app: FastifyInstance) {


  // Helper: check if user can see a dashboard
  async function canAccessDashboard(req: FastifyRequest, dashboardId: string): Promise<boolean> {
    const role = req.user.role;
    if (role === 'SUPER_ADMIN') return true;

    const tenantId = req.user.tenantId;
    const dashboard = await prisma.dashboard.findFirst({ where: { id: dashboardId, ...(tenantId ? { tenantId } : {}) } });
    if (!dashboard) return false;

    if (['TENANT_ADMIN', 'ADMIN'].includes(role)) return true;

    // Check assignment
    const assignment = await prisma.dashboardAssignment.findFirst({
      where: {
        dashboardId,
        OR: [
          { assigneeType: 'USER', userId: req.user.sub },
          { assigneeType: 'ORGANIZATION', organizationId: req.user.organizationId },
          { assigneeType: 'ROLE', roleValue: role },
        ],
      },
    });
    return !!assignment;
  }

  // ─── LIST DASHBOARDS (user's visible dashboards) ───────
  app.get('/', {
    schema: {
      tags: ['Dashboards'],
      summary: 'List dashboards visible to current user',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 20 },
        },
      },
    },
  }, async (req) => {
    const { page = 1, limit = 20 } = req.query as any;
    const role = req.user.role;
    const tenantId = getTenantId(req);

    let where: any = { isActive: true };

    if (role === 'SUPER_ADMIN') {
      if (tenantId) where.tenantId = tenantId;
    } else if (['TENANT_ADMIN', 'ADMIN'].includes(role)) {
      where.tenantId = tenantId;
    } else {
      // Org-scoped users: only assigned dashboards
      const assignments = await prisma.dashboardAssignment.findMany({
        where: {
          OR: [
            { assigneeType: 'USER', userId: req.user.sub },
            { assigneeType: 'ORGANIZATION', organizationId: req.user.organizationId },
            { assigneeType: 'ROLE', roleValue: role },
          ],
        },
        select: { dashboardId: true },
      });
      const ids = assignments.map(a => a.dashboardId);
      where = { id: { in: ids }, isActive: true, tenantId: tenantId };
    }

    const [data, total] = await Promise.all([
      prisma.dashboard.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        include: { _count: { select: { widgets: true, assignments: true } } },
      }),
      prisma.dashboard.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  });

  // ─── GET DASHBOARD WITH WIDGETS ────────────────────────
  app.get('/:id', {
    schema: {
      tags: ['Dashboards'],
      summary: 'Get dashboard with all widgets',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canAccessDashboard(req, id))) {
      return reply.code(404).send({ error: 'Dashboard not found' });
    }

    const dashboard = await prisma.dashboard.findUnique({
      where: { id },
      include: {
        widgets: { orderBy: { createdAt: 'asc' } },
        assignments: true,
      },
    });

    return dashboard;
  });

  // ─── CREATE DASHBOARD ──────────────────────────────────
  app.post('/', {
    schema: {
      tags: ['Dashboards'],
      summary: 'Create a new dashboard',
      body: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 500 },
          layout: { type: 'object' },
          isDefault: { type: 'boolean' },
          scope: { type: 'string', enum: ['TENANT', 'ORGANIZATION', 'USER'] },
        },
      },
    },
    preHandler: [app.requirePermission('DASHBOARD_CREATE')],
  }, async (req, reply) => {
    const body = req.body as any;
    const tenantId = getTenantId(req);
    if (!tenantId) return reply.code(400).send({ error: 'Tenant context required' });

    // If setting as default, unset other defaults
    if (body.isDefault) {
      await prisma.dashboard.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } });
    }

    const dashboard = await prisma.dashboard.create({
      data: {
        tenantId,
        title: body.title,
        description: body.description,
        layout: body.layout || {},
        isDefault: body.isDefault || false,
        scope: body.scope || 'TENANT',
        createdBy: req.user.sub,
      },
    });

    await auditLog({
      userId: req.user.username, userRole: req.user.role,
      action: 'DASHBOARD_CREATED', targetType: 'dashboard', targetId: dashboard.id,
      afterValue: { title: dashboard.title, scope: dashboard.scope },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return reply.code(201).send(dashboard);
  });

  // ─── UPDATE DASHBOARD ──────────────────────────────────
  app.put('/:id', {
    schema: {
      tags: ['Dashboards'],
      summary: 'Update dashboard',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 500 },
          layout: { type: 'object' },
          isDefault: { type: 'boolean' },
          isActive: { type: 'boolean' },
        },
      },
    },
    preHandler: [app.requirePermission('DASHBOARD_MANAGE')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const tenantId = getTenantId(req);

    const existing = await prisma.dashboard.findFirst({ where: { id, ...(tenantId ? { tenantId } : {}) } });
    if (!existing) return reply.code(404).send({ error: 'Dashboard not found' });

    if (body.isDefault) {
      await prisma.dashboard.updateMany({ where: { ...(tenantId ? { tenantId } : {}), isDefault: true, id: { not: id } }, data: { isDefault: false } });
    }

    const dashboard = await prisma.dashboard.update({ where: { id }, data: body });
    return dashboard;
  });

  // ─── DELETE DASHBOARD ──────────────────────────────────
  app.delete('/:id', {
    schema: {
      tags: ['Dashboards'],
      summary: 'Delete dashboard',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
    },
    preHandler: [app.requirePermission('DASHBOARD_MANAGE')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = getTenantId(req);

    const existing = await prisma.dashboard.findFirst({ where: { id, ...(tenantId ? { tenantId } : {}) } });
    if (!existing) return reply.code(404).send({ error: 'Dashboard not found' });

    await prisma.dashboard.update({ where: { id }, data: { isActive: false } });
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════
  // WIDGETS
  // ═══════════════════════════════════════════════════════

  // ─── ADD WIDGET ────────────────────────────────────────
  app.post('/:id/widgets', {
    schema: {
      tags: ['Dashboards'],
      summary: 'Add widget to dashboard',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
      body: {
        type: 'object',
        required: ['widgetType', 'title'],
        properties: {
          widgetType: { type: 'string', enum: ['timeseries_chart', 'gauge', 'value_card', 'alarm_table', 'entity_table', 'status_indicator', 'scada_symbol', 'map', 'html_widget', 'image'] },
          title: { type: 'string', maxLength: 200 },
          config: { type: 'object' },
          position: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, w: { type: 'integer' }, h: { type: 'integer' } } },
          dataSource: { type: 'object' },
          refreshInterval: { type: 'integer', minimum: 0 },
        },
      },
    },
    preHandler: [app.requirePermission('DASHBOARD_MANAGE')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const tenantId = getTenantId(req);

    const dashWhere: any = { id }; if (tenantId) dashWhere.tenantId = tenantId; const dashboard = await prisma.dashboard.findFirst({ where: dashWhere });
    if (!dashboard) return reply.code(404).send({ error: 'Dashboard not found' });

    const widget = await prisma.dashboardWidget.create({
      data: {
        dashboardId: id,
        widgetType: body.widgetType,
        title: body.title,
        config: body.config || {},
        position: body.position || { x: 0, y: 0, w: 4, h: 3 },
        dataSource: body.dataSource || {},
        refreshInterval: body.refreshInterval ?? 30,
      },
    });

    return reply.code(201).send(widget);
  });

  // ─── UPDATE WIDGET ─────────────────────────────────────
  app.put('/:id/widgets/:widgetId', {
    schema: {
      tags: ['Dashboards'],
      summary: 'Update widget',
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, widgetId: { type: 'string', format: 'uuid' } },
        required: ['id', 'widgetId'],
      },
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 200 },
          config: { type: 'object' },
          position: { type: 'object' },
          dataSource: { type: 'object' },
          refreshInterval: { type: 'integer', minimum: 0 },
        },
      },
    },
    preHandler: [app.requirePermission('DASHBOARD_MANAGE')],
  }, async (req, reply) => {
    const { id, widgetId } = req.params as { id: string; widgetId: string };
    const body = req.body as any;

    const widget = await prisma.dashboardWidget.findFirst({ where: { id: widgetId, dashboardId: id } });
    if (!widget) return reply.code(404).send({ error: 'Widget not found' });

    const updated = await prisma.dashboardWidget.update({ where: { id: widgetId }, data: body });
    return updated;
  });

  // ─── DELETE WIDGET ─────────────────────────────────────
  app.delete('/:id/widgets/:widgetId', {
    schema: {
      tags: ['Dashboards'],
      summary: 'Remove widget',
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, widgetId: { type: 'string', format: 'uuid' } },
        required: ['id', 'widgetId'],
      },
    },
    preHandler: [app.requirePermission('DASHBOARD_MANAGE')],
  }, async (req, reply) => {
    const { widgetId } = req.params as { widgetId: string };
    await prisma.dashboardWidget.delete({ where: { id: widgetId } });
    return { success: true };
  });

  // ─── BATCH UPDATE WIDGET POSITIONS (drag-and-drop) ─────
  app.put('/:id/layout', {
    schema: {
      tags: ['Dashboards'],
      summary: 'Batch update widget positions after drag-and-drop',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
      body: {
        type: 'object',
        required: ['positions'],
        properties: {
          positions: {
            type: 'array',
            items: {
              type: 'object',
              required: ['widgetId', 'x', 'y', 'w', 'h'],
              properties: {
                widgetId: { type: 'string', format: 'uuid' },
                x: { type: 'integer' }, y: { type: 'integer' },
                w: { type: 'integer' }, h: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    preHandler: [app.requirePermission('DASHBOARD_MANAGE')],
  }, async (req) => {
    const { positions } = req.body as { positions: Array<{ widgetId: string; x: number; y: number; w: number; h: number }> };
    await Promise.all(positions.map(p =>
      prisma.dashboardWidget.update({
        where: { id: p.widgetId },
        data: { position: { x: p.x, y: p.y, w: p.w, h: p.h } },
      })
    ));
    return { success: true, updated: positions.length };
  });

  // ═══════════════════════════════════════════════════════
  // ASSIGNMENTS
  // ═══════════════════════════════════════════════════════

  // ─── ASSIGN DASHBOARD ──────────────────────────────────
  app.post('/:id/assign', {
    schema: {
      tags: ['Dashboards'],
      summary: 'Assign dashboard to user/org/role',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
      body: {
        type: 'object',
        required: ['assigneeType'],
        properties: {
          assigneeType: { type: 'string', enum: ['USER', 'ORGANIZATION', 'ROLE'] },
          userId: { type: 'string', format: 'uuid' },
          organizationId: { type: 'string', format: 'uuid' },
          roleValue: { type: 'string' },
        },
      },
    },
    preHandler: [app.requirePermission('DASHBOARD_ASSIGN')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;

    const assignment = await prisma.dashboardAssignment.create({
      data: {
        dashboardId: id,
        assigneeType: body.assigneeType,
        userId: body.userId || null,
        organizationId: body.organizationId || null,
        roleValue: body.roleValue || null,
      },
    });

    return reply.code(201).send(assignment);
  });

  // ─── REMOVE ASSIGNMENT ─────────────────────────────────
  app.delete('/:dashboardId/assign/:assignmentId', {
    schema: {
      tags: ['Dashboards'],
      summary: 'Remove dashboard assignment',
      params: {
        type: 'object',
        properties: { dashboardId: { type: 'string' }, assignmentId: { type: 'string', format: 'uuid' } },
        required: ['dashboardId', 'assignmentId'],
      },
    },
    preHandler: [app.requirePermission('DASHBOARD_ASSIGN')],
  }, async (req) => {
    const { assignmentId } = req.params as { assignmentId: string };
    await prisma.dashboardAssignment.delete({ where: { id: assignmentId } });
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════
  // WIDGET DATA
  // ═══════════════════════════════════════════════════════

  // ─── GET WIDGET DATA ───────────────────────────────────
  app.get('/:id/data/:widgetId', {
    schema: {
      tags: ['Dashboards'],
      summary: 'Fetch data for a specific widget',
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, widgetId: { type: 'string', format: 'uuid' } },
        required: ['id', 'widgetId'],
      },
    },
  }, async (req, reply) => {
    const { id, widgetId } = req.params as { id: string; widgetId: string };

    if (!(await canAccessDashboard(req, id))) {
      return reply.code(404).send({ error: 'Dashboard not found' });
    }

    const widget = await prisma.dashboardWidget.findFirst({ where: { id: widgetId, dashboardId: id } });
    if (!widget) return reply.code(404).send({ error: 'Widget not found' });

    const dataSource = widget.dataSource as any;
    const entityIds = dataSource?.entityIds || [];
    const telemetryKeys = dataSource?.telemetryKeys || [];

    if (entityIds.length === 0) {
      return { widgetId, data: [], message: 'No entity IDs configured' };
    }

    switch (widget.widgetType) {
      case 'value_card':
      case 'gauge':
      case 'status_indicator': {
        // Latest telemetry values
        const latest = await prisma.latestTelemetry.findMany({
          where: {
            entityId: { in: entityIds },
            ...(telemetryKeys.length > 0 ? { key: { in: telemetryKeys } } : {}),
          },
        });
        return { widgetId, widgetType: widget.widgetType, data: latest };
      }

      case 'timeseries_chart': {
        // Historical telemetry from TSDB
        const pool = getTsdbPool();
        const timeWindow = dataSource?.timeWindow || { duration: '1h' };
        const duration = timeWindow.duration || '1 hour';
        const result = await pool.query(
          `SELECT time, entity_id, key, value_num, value_str
           FROM ts_telemetry
           WHERE entity_id = ANY($1)
             AND ($2::text[] IS NULL OR key = ANY($2))
             AND time > NOW() - $3::interval
           ORDER BY time DESC
           LIMIT 1000`,
          [entityIds, telemetryKeys.length > 0 ? telemetryKeys : null, duration]
        );
        return { widgetId, widgetType: 'timeseries_chart', data: result.rows };
      }

      case 'alarm_table': {
        const alarms = await prisma.alarm.findMany({
          where: {
            entityId: { in: entityIds },
            ...(dataSource?.filters?.severity ? { severity: { in: dataSource.filters.severity } } : {}),
            ...(dataSource?.filters?.status ? { status: { in: dataSource.filters.status } } : { status: 'ACTIVE' }),
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        });
        return { widgetId, widgetType: 'alarm_table', data: alarms };
      }

      case 'entity_table': {
        const entities = await prisma.assetInstance.findMany({
          where: { id: { in: entityIds }, isActive: true },
          select: { id: true, name: true, status: true, attributes: true, templateId: true },
        });
        return { widgetId, widgetType: 'entity_table', data: entities };
      }

      default:
        return { widgetId, widgetType: widget.widgetType, data: [], message: 'Widget type data fetch not implemented' };
    }
  });

  // ─── WIDGET TYPES ──────────────────────────────────────
  app.get('/widget-types', {
    schema: {
      tags: ['Dashboards'],
      summary: 'List available widget types',
    },
  }, async () => {
    return [
      { type: 'timeseries_chart', label: 'Time Series Chart', icon: 'line-chart', description: 'Line/bar/area chart for telemetry history', category: 'Charts' },
      { type: 'gauge', label: 'Gauge', icon: 'gauge', description: 'Radial gauge for single telemetry value', category: 'Charts' },
      { type: 'value_card', label: 'Value Card', icon: 'hash', description: 'Display latest telemetry value', category: 'Cards' },
      { type: 'alarm_table', label: 'Alarm Table', icon: 'alert-triangle', description: 'Filtered alarm list', category: 'Tables' },
      { type: 'entity_table', label: 'Entity Table', icon: 'table', description: 'Entity list with attributes', category: 'Tables' },
      { type: 'status_indicator', label: 'Status Indicator', icon: 'circle', description: 'Online/offline LED indicator', category: 'Indicators' },
      { type: 'scada_symbol', label: 'SCADA Symbol', icon: 'cpu', description: 'SVG with telemetry data binding', category: 'SCADA' },
      { type: 'map', label: 'Map', icon: 'map-pin', description: 'Device location map', category: 'Maps' },
      { type: 'html_widget', label: 'Custom HTML', icon: 'code', description: 'Custom HTML/JS widget', category: 'Advanced' },
      { type: 'image', label: 'Image', icon: 'image', description: 'Static or dynamic image', category: 'Media' },
    ];
  });
}
