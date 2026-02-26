import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import {
  buildApp,
  loginAs,
  authGet,
  authPost,
  authDelete,
  ADMIN_PASSWORD,
} from './test-helper.js';

const SUFFIX = Date.now().toString(36);

describe('QR Code endpoints', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let templateId: string;
  let instanceId: string;

  beforeAll(async () => {
    app = await buildApp();
    adminToken = await loginAs(app);

    // Create a template for the QR code tests
    const tplRes = await authPost(app, '/api/assets/templates', adminToken, {
      name: `QR Template ${SUFFIX}`,
      description: 'Template for QR code tests',
      category: 'Equipment',
      attributeSchema: [
        { fieldName: 'serial', dataType: 'TEXT' },
      ],
    }, ADMIN_PASSWORD);
    const tplBody = JSON.parse(tplRes.body);
    templateId = (tplBody.data || tplBody).id;

    // Create an instance to attach QR codes to
    const instRes = await authPost(app, '/api/assets/instances', adminToken, {
      name: `QR Device ${SUFFIX}`,
      templateId,
      description: 'Device for QR code tests',
      attributes: { serial: 'SN-001' },
    }, ADMIN_PASSWORD);
    const instBody = JSON.parse(instRes.body);
    instanceId = (instBody.data || instBody).id;
  });

  afterAll(async () => {
    // Cleanup: delete instance, then template
    if (instanceId) {
      await authDelete(app, `/api/assets/instances/${instanceId}`, adminToken, ADMIN_PASSWORD);
    }
    if (templateId) {
      await authDelete(app, `/api/assets/templates/${templateId}`, adminToken, ADMIN_PASSWORD);
    }
    await app.close();
  });

  // =============================================
  // GET /:entityId — 404 before QR code exists
  // =============================================
  it('GET /api/qr/:entityId returns 404 when no QR code exists', async () => {
    const res = await authGet(app, `/api/qr/${instanceId}`, adminToken);
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('NOT_FOUND');
  });

  // =============================================
  // POST /:entityId/generate — Generate QR code (default options)
  // =============================================
  it('POST /api/qr/:entityId/generate creates a QR code with defaults', async () => {
    const res = await authPost(app, `/api/qr/${instanceId}/generate`, adminToken, {});
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBeTruthy();
    expect(body.entityId).toBe(instanceId);
    expect(body.qrData).toBeTruthy();
    expect(body.svgData).toBeTruthy();
    expect(body.size).toBe('MEDIUM');
    expect(body.includeLabel).toBe(false);
  });

  // =============================================
  // POST /:entityId/generate — Regenerate with custom options (upsert)
  // =============================================
  it('POST /api/qr/:entityId/generate upserts with custom size and label', async () => {
    const res = await authPost(app, `/api/qr/${instanceId}/generate`, adminToken, {
      size: 'LARGE',
      includeLabel: true,
      action: 'checklist',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.entityId).toBe(instanceId);
    expect(body.size).toBe('LARGE');
    expect(body.includeLabel).toBe(true);
    expect(body.qrData).toContain('action=checklist');
  });

  // =============================================
  // POST /:entityId/generate — 404 for non-existent entity
  // =============================================
  it('POST /api/qr/:entityId/generate returns 404 for unknown entity', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await authPost(app, `/api/qr/${fakeId}/generate`, adminToken, {});
    expect(res.statusCode).toBe(404);
  });

  // =============================================
  // GET /:entityId — Retrieve QR code record
  // =============================================
  it('GET /api/qr/:entityId returns the QR code record', async () => {
    const res = await authGet(app, `/api/qr/${instanceId}`, adminToken);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBeTruthy();
    expect(body.entityId).toBe(instanceId);
    expect(body.qrData).toBeTruthy();
    expect(body.svgData).toBeTruthy();
    expect(body.size).toBe('LARGE'); // Updated by upsert above
    expect(body.includeLabel).toBe(true);
    expect(body.createdAt).toBeTruthy();
    expect(body.updatedAt).toBeTruthy();
  });

  // =============================================
  // GET /:entityId/svg — Retrieve SVG image
  // =============================================
  it('GET /api/qr/:entityId/svg returns SVG with correct content type', async () => {
    const res = await authGet(app, `/api/qr/${instanceId}/svg`, adminToken);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    // Body should be valid SVG
    expect(res.body).toContain('<svg');
    expect(res.body).toContain('</svg>');
  });

  // =============================================
  // GET /:entityId/svg — 404 for non-existent entity
  // =============================================
  it('GET /api/qr/:entityId/svg returns 404 for unknown entity', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await authGet(app, `/api/qr/${fakeId}/svg`, adminToken);
    expect(res.statusCode).toBe(404);
  });

  // =============================================
  // DELETE /:entityId — Delete QR code
  // =============================================
  it('DELETE /api/qr/:entityId deletes the QR code', async () => {
    const res = await authDelete(app, `/api/qr/${instanceId}`, adminToken);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.deleted).toBe(true);
  });

  // =============================================
  // GET /:entityId — 404 after deletion
  // =============================================
  it('GET /api/qr/:entityId returns 404 after deletion', async () => {
    const res = await authGet(app, `/api/qr/${instanceId}`, adminToken);
    expect(res.statusCode).toBe(404);
  });

  // =============================================
  // DELETE /:entityId — 404 when already deleted
  // =============================================
  it('DELETE /api/qr/:entityId returns 404 when QR code does not exist', async () => {
    const res = await authDelete(app, `/api/qr/${instanceId}`, adminToken);
    expect(res.statusCode).toBe(404);
  });

  // =============================================
  // GET /:entityId/svg — 404 after QR deletion
  // =============================================
  it('GET /api/qr/:entityId/svg returns 404 after QR code deleted', async () => {
    const res = await authGet(app, `/api/qr/${instanceId}/svg`, adminToken);
    expect(res.statusCode).toBe(404);
  });
});
