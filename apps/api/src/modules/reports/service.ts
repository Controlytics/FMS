import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import type { RequestContext } from '../../types/context.js';
import { resolveAllTags } from './variable-resolver.js';
import { buildHtml } from './renderers/html-builder.js';
import { renderPdf } from './renderers/pdf-renderer.js';
import type { ResolutionContext } from './data-sources/timestamp-source.js';
import fs from 'fs/promises';
import path from 'path';

const UPLOAD_DIR = path.resolve('uploads/reports');

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

interface GenerateInput {
  templateId: string;
  entitySlots: Record<string, string>;
  timeRangeStart?: string;
  timeRangeEnd?: string;
  name?: string;
}

export class ReportService {

  async generate(ctx: RequestContext, input: GenerateInput) {
    // 1. Load template with latest config
    const template = await prisma.reportTemplate.findUnique({
      where: { id: input.templateId },
      include: {
        versions: { orderBy: { version: 'desc' }, take: 1 },
      },
    });
    if (!template) throw { statusCode: 404, message: 'Template not found' };
    if (template.status !== 'ACTIVE') throw { statusCode: 400, message: 'Template is not active' };

    const config = (template.versions[0]?.config ?? {}) as any;
    const version = template.currentVersion;

    // 2. Resolve user for meta resolution
    const user = await prisma.user.findUnique({ where: { id: ctx.userSub } });

    const reportName = input.name || `${template.name} - ${new Date().toLocaleDateString()}`;

    // 3. Build resolution context
    const resCtx: ResolutionContext = {
      entitySlots: input.entitySlots ?? {},
      timeRange: {
        start: input.timeRangeStart ? new Date(input.timeRangeStart) : new Date(Date.now() - 86400_000),
        end: input.timeRangeEnd ? new Date(input.timeRangeEnd) : new Date(),
      },
      orgId: '',
      userId: ctx.userSub,
      userName: user?.fullName ?? ctx.userId,
      orgName: '',
      reportName,
      templateName: template.name,
    };

    // 4. Resolve all variable tags
    const resolved = await resolveAllTags(config, resCtx);

    // 5. Build HTML
    const html = await buildHtml(config, resolved);

    // 6. Generate PDF
    const pdfBuffer = await renderPdf(html, config.pageSettings ?? { pageSize: 'A4', orientation: 'portrait', margins: { top: 20, right: 15, bottom: 20, left: 15 } });

    // 7. Store PDF to disk
    await ensureUploadDir();
    const reportId = crypto.randomUUID();
    const pdfPath = path.join(UPLOAD_DIR, `${reportId}.pdf`);
    await fs.writeFile(pdfPath, pdfBuffer);

    // 8. Create report instance record
    const report = await prisma.reportInstance.create({
      data: {
        id: reportId,
        templateId: input.templateId,
        templateVersion: version,
        name: reportName,
        status: config.signatureConfig?.required ? 'PENDING_SIGNATURE' : 'DRAFT',
        timeRangeStart: resCtx.timeRange.start,
        timeRangeEnd: resCtx.timeRange.end,
        entitySlots: input.entitySlots,
        resolvedData: Object.fromEntries(resolved) as any,
        pdfPath,
        pdfSize: pdfBuffer.length,
        generatedBy: ctx.userSub,
      },
    });

    // 9. Audit log
    await auditLog({
      userId: ctx.userId,
      userRole: ctx.userRole,
      action: 'REPORT_GENERATED',
      targetType: 'report_instance',
      targetId: report.id,
      afterValue: { name: report.name, templateId: input.templateId, templateVersion: version },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      sessionId: ctx.sessionId,
    });

    return report;
  }

  async list(_ctx: RequestContext, query: { page?: number; limit?: number; status?: string; templateId?: string }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const where: any = {};

    if (query.status) where.status = query.status;
    if (query.templateId) where.templateId = query.templateId;

    const [data, total] = await Promise.all([
      prisma.reportInstance.findMany({
        where,
        include: {
          template: { select: { name: true } },
          generator: { select: { fullName: true, username: true } },
          signatures: { select: { signerRole: true, signerLabel: true, signedAt: true } },
        },
        orderBy: { generatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.reportInstance.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getById(ctx: RequestContext, id: string) {
    const report = await prisma.reportInstance.findUnique({
      where: { id },
      include: {
        template: { select: { name: true } },
        generator: { select: { fullName: true, username: true } },
        signatures: {
          include: { user: { select: { fullName: true, username: true } } },
        },
      },
    });
    if (!report) throw { statusCode: 404, message: 'Report not found' };
    return report;
  }

  async getPdfPath(id: string): Promise<string> {
    const report = await prisma.reportInstance.findUnique({
      where: { id },
      select: { pdfPath: true, name: true },
    });
    if (!report?.pdfPath) throw { statusCode: 404, message: 'PDF not found' };

    try {
      await fs.access(report.pdfPath);
    } catch {
      throw { statusCode: 404, message: 'PDF file missing from storage' };
    }
    return report.pdfPath;
  }

  async delete(ctx: RequestContext, id: string) {
    const report = await prisma.reportInstance.findUnique({ where: { id } });
    if (!report) throw { statusCode: 404, message: 'Report not found' };

    if (report.pdfPath) {
      try { await fs.unlink(report.pdfPath); } catch { /* file may already be deleted */ }
    }

    await prisma.reportInstance.delete({ where: { id } });

    await auditLog({
      userId: ctx.userId,
      userRole: ctx.userRole,
      action: 'REPORT_DELETED',
      targetType: 'report_instance',
      targetId: id,
      beforeValue: { name: report.name },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      sessionId: ctx.sessionId,
    });

    return { success: true };
  }

  async sign(ctx: RequestContext, id: string, body: { signerRole: string; meaning: string }) {
    const report = await prisma.reportInstance.findUnique({
      where: { id },
      include: { template: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } }, signatures: true },
    });
    if (!report) throw { statusCode: 404, message: 'Report not found' };
    if (report.status !== 'DRAFT' && report.status !== 'PENDING_SIGNATURE') {
      throw { statusCode: 400, message: `Cannot sign report in ${report.status} status` };
    }

    // Check if this role already signed
    const existing = report.signatures.find(s => s.signerRole === body.signerRole);
    if (existing) throw { statusCode: 409, message: `Role "${body.signerRole}" has already signed` };

    // Create signature
    const config = (report.template.versions[0]?.config as any) ?? {};
    const signerDef = (config.signatureConfig?.signers ?? []).find((s: any) => s.role === body.signerRole);

    const signature = await prisma.reportSignature.create({
      data: {
        reportId: id,
        signerRole: body.signerRole,
        signerLabel: signerDef?.label ?? body.signerRole,
        userId: ctx.userSub,
        meaning: body.meaning || config.signatureConfig?.meaning || 'Signed',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    // Check if all required signers have signed
    const requiredSigners = (config.signatureConfig?.signers ?? []).filter((s: any) => s.required);
    const allSignatures = [...report.signatures, signature];
    const allRequiredSigned = requiredSigners.every((s: any) => allSignatures.some(sig => sig.signerRole === s.role));

    if (allRequiredSigned && requiredSigners.length > 0) {
      await prisma.reportInstance.update({
        where: { id },
        data: { status: 'SIGNED', signedAt: new Date() },
      });
    } else {
      await prisma.reportInstance.update({
        where: { id },
        data: { status: 'PENDING_SIGNATURE' },
      });
    }

    await auditLog({
      userId: ctx.userId,
      userRole: ctx.userRole,
      action: 'REPORT_SIGNED',
      targetType: 'report_instance',
      targetId: id,
      afterValue: { signerRole: body.signerRole, meaning: body.meaning },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      sessionId: ctx.sessionId,
      signatureMeaning: body.meaning,
    });

    return signature;
  }

  async reject(ctx: RequestContext, id: string, body: { reason: string }) {
    const report = await prisma.reportInstance.findUnique({ where: { id } });
    if (!report) throw { statusCode: 404, message: 'Report not found' };
    if (report.status !== 'DRAFT' && report.status !== 'PENDING_SIGNATURE') {
      throw { statusCode: 400, message: `Cannot reject report in ${report.status} status` };
    }

    await prisma.reportInstance.update({
      where: { id },
      data: { status: 'REJECTED' },
    });

    await auditLog({
      userId: ctx.userId,
      userRole: ctx.userRole,
      action: 'REPORT_REJECTED',
      targetType: 'report_instance',
      targetId: id,
      afterValue: { reason: body.reason },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      sessionId: ctx.sessionId,
    });

    return { success: true, status: 'REJECTED' };
  }
}
