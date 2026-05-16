import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { errorResponses } from '../../lib/error-schemas.js';

/**
 * Generate a simple placeholder SVG representing a QR code.
 * Since we cannot install the `qrcode` library, this produces
 * an SVG with the encoded URL rendered as text.
 */
function generateQrSvg(data: string, size: string, label?: string): string {
  const px = size === 'SMALL' ? 150 : size === 'LARGE' ? 400 : 250;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px + (label ? 30 : 0)}" viewBox="0 0 ${px} ${px + (label ? 30 : 0)}">
    <rect width="${px}" height="${px}" fill="white" stroke="#333" stroke-width="2"/>
    <text x="${px / 2}" y="${px / 2}" text-anchor="middle" dominant-baseline="middle" font-family="monospace" font-size="10" fill="#333">QR: ${data.slice(0, 40)}...</text>
    ${label ? `<text x="${px / 2}" y="${px + 20}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#333">${label}</text>` : ''}
  </svg>`;
}

export default async function qrCodeRoutes(app: FastifyInstance) {
  // POST /api/qr-codes/:entityId/generate — Generate QR code for entity
  app.post<{
    Params: { entityId: string };
    Body: { size?: 'SMALL' | 'MEDIUM' | 'LARGE'; includeLabel?: boolean; action?: 'checklist' | 'dashboard' | 'history' };
  }>('/:entityId/generate', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN', 'SUPERVISOR')],
    schema: {
      tags: ['QR Codes'],
      summary: 'Generate QR code for entity',
      description: 'Generate a QR code for the specified entity. Upserts the QR code record if one already exists.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid', description: 'Entity instance ID' },
        },
      },
      body: {
        type: 'object',
        properties: {
          size: { type: 'string', enum: ['SMALL', 'MEDIUM', 'LARGE'], default: 'MEDIUM', description: 'QR code size' },
          includeLabel: { type: 'boolean', default: false, description: 'Whether to include a text label below the QR code' },
          action: { type: 'string', enum: ['checklist', 'dashboard', 'history'], default: 'dashboard', description: 'Action the QR code links to' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            entityId: { type: 'string' },
            qrData: { type: 'string' },
            svgData: { type: 'string' },
            size: { type: 'string' },
            includeLabel: { type: 'boolean' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params;
    const { size = 'MEDIUM', includeLabel = false, action = 'dashboard' } = req.body ?? {};

    // Verify entity exists
    const entity = await prisma.assetInstance.findUnique({ where: { id: entityId } });
    if (!entity) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Entity not found' });
    }

    // Build the QR data URL
    const appUrl = process.env.ALLOWED_ORIGINS?.split(',')[0] || 'http://localhost:5173';
    const qrData = `${appUrl}/m/${entityId}?action=${action}`;

    // Generate SVG
    const label = includeLabel ? entity.name : undefined;
    const svgData = generateQrSvg(qrData, size, label);

    // Upsert QR code record
    const qrCode = await prisma.qrCode.upsert({
      where: { entityId },
      create: {
        entityId,
        qrData,
        imagePath: '',
        svgData,
        size,
        includeLabel,
      },
      update: {
        qrData,
        svgData,
        size,
        includeLabel,
      },
    });

    return {
      id: qrCode.id,
      entityId: qrCode.entityId,
      qrData: qrCode.qrData,
      svgData: qrCode.svgData,
      size: qrCode.size,
      includeLabel: qrCode.includeLabel,
    };
  });

  // GET /api/qr-codes/:entityId — Get QR code for entity
  app.get<{
    Params: { entityId: string };
  }>('/:entityId', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['QR Codes'],
      summary: 'Get QR code for entity',
      description: 'Retrieve the QR code record for the specified entity.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid', description: 'Entity instance ID' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            entityId: { type: 'string' },
            qrData: { type: 'string' },
            imagePath: { type: 'string' },
            svgData: { type: 'string' },
            size: { type: 'string' },
            includeLabel: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params;

    const qrCode = await prisma.qrCode.findUnique({ where: { entityId } });
    if (!qrCode) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'QR code not found for this entity' });
    }

    return qrCode;
  });

  // GET /api/qr-codes/:entityId/svg — Get QR code as SVG
  app.get<{
    Params: { entityId: string };
  }>('/:entityId/svg', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['QR Codes'],
      summary: 'Get QR code as SVG',
      description: 'Retrieve the QR code SVG image for the specified entity. Returns raw SVG with Content-Type image/svg+xml.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid', description: 'Entity instance ID' },
        },
      },
      response: {
        200: {
          type: 'string',
          description: 'SVG image data',
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params;

    const qrCode = await prisma.qrCode.findUnique({ where: { entityId } });
    if (!qrCode || !qrCode.svgData) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'QR code SVG not found for this entity' });
    }

    reply.header('Content-Type', 'image/svg+xml');
    return qrCode.svgData;
  });

  // DELETE /api/qr-codes/:entityId — Delete QR code
  app.delete<{
    Params: { entityId: string };
  }>('/:entityId', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['QR Codes'],
      summary: 'Delete QR code for entity',
      description: 'Delete the QR code record for the specified entity.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid', description: 'Entity instance ID' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            deleted: { type: 'boolean' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params;

    try {
      await prisma.qrCode.delete({ where: { entityId } });
    } catch (err: any) {
      if (err.code === 'P2025') {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'QR code not found for this entity' });
      }
      throw err;
    }

    return { deleted: true };
  });
}
