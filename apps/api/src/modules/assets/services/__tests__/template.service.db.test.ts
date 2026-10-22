/**
 * templateService.create / update / delete against the real database.
 *
 * No route calls these any more (POST/PUT/DELETE /templates were removed
 * 2026-05-26 — see template.routes.ts), so they cannot be reached over HTTP.
 * template.service.test.ts covers them with a mocked repository; this file
 * runs them for real: rows written, version snapshots, audit rows, and the
 * template-kind FK pre-check against the live lookup table.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../../lib/prisma.js';
import type { RequestContext } from '../../../../types/context.js';
import { templateService } from '../template.service.js';
import { SliceOwner, runTag, auditFor } from '../../__tests__/slice-support.js';

const own = new SliceOwner(runTag('CVTS'));
const ctx = { userId: 'cov-template-svc', userSub: randomUUID(), userRole: 'SUPER_ADMIN', ipAddress: '127.0.0.1', userAgent: 'vitest', sessionId: undefined } as unknown as RequestContext;
const inactiveKind = `CVK${Date.now().toString(36).toUpperCase()}`;
let id: string;

beforeAll(async () => {
  await own.template('OTHER'); // makes sure the system kinds exist
  await prisma.templateKind.create({ data: { code: inactiveKind, label: 'Coverage inactive kind', isActive: false } });
  own.templateKindCodes.push(inactiveKind);
}, 60_000);

afterAll(async () => {
  await own.cleanup();
}, 60_000);

describe('templateService.create', () => {
  it('creates the template at version 1 with a frozen version row and two audit rows', async () => {
    const t = await templateService.create({
      name: own.n('TPL'), description: 'pump', category: 'Equipment', icon: 'gear', templateKind: 'EQUIPMENT',
      attributeSchema: [{ fieldName: 'kw', dataType: 'FLOAT' }], maxConnections: 4, maxParentConnections: 2,
      dataIngestionEnabled: true, transportType: 'HTTP', credentialType: 'BASIC', inactivityTimeout: 30, defaultMaxDataRate: 10, autoProvision: false,
    }, ctx);
    id = t.id;
    own.templateIds.push(id);
    expect(t).toMatchObject({ version: 1, templateKind: 'EQUIPMENT', maxConnections: 4, maxParentConnections: 2, credentialType: 'BASIC', autoProvision: false, createdBy: 'cov-template-svc' });
    const v = await prisma.assetTemplateVersion.findMany({ where: { templateId: id } });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ versionNumber: 1, changeNotes: 'Initial version' });
    expect(v[0].snapshot).toMatchObject({ name: own.n('TPL'), category: 'Equipment', attributeSchema: [{ fieldName: 'kw', dataType: 'FLOAT' }] });
    expect((await auditFor(id, 'ASSET_TEMPLATE_VERSION_CREATED'))[0].signatureMeaning).toBe(`Version 1 of template "${own.n('TPL')}" created`);
    expect(await auditFor(id, 'ASSET_TEMPLATE_CREATED')).toHaveLength(1);
  });

  it('defaults to the OTHER kind and the repository defaults', async () => {
    const t = await templateService.create({ name: own.n('TPL-DEFAULTS') }, ctx);
    own.templateIds.push(t.id);
    expect(t).toMatchObject({ templateKind: 'OTHER', maxConnections: 10, maxParentConnections: 1, credentialType: 'TOKEN', inactivityTimeout: 60, defaultMaxDataRate: 600, autoProvision: true, dataIngestionEnabled: false });
  });

  it('refuses a taken name, an unknown kind (listing the valid ones) and a deactivated kind', async () => {
    await expect(templateService.create({ name: own.n('TPL') }, ctx)).rejects.toMatchObject({ statusCode: 409, message: 'Template name already exists' });
    const unknown = templateService.create({ name: own.n('TPL-X'), templateKind: 'NOPE_KIND' }, ctx);
    await expect(unknown).rejects.toMatchObject({ statusCode: 400 });
    await expect(templateService.create({ name: own.n('TPL-X'), templateKind: 'NOPE_KIND' }, ctx)).rejects.toThrow(/^Template kind "NOPE_KIND" not found\. Valid kinds: .*BLOCK.*\. Add new kinds via Configuration → Template Kinds\.$/);
    await expect(templateService.create({ name: own.n('TPL-X'), templateKind: inactiveKind }, ctx)).rejects.toMatchObject({
      statusCode: 400, message: `Template kind "${inactiveKind}" is currently deactivated. Reactivate it (or pick another) before assigning templates to it.`,
    });
    expect(await prisma.assetTemplate.count({ where: { name: own.n('TPL-X') } })).toBe(0);
  });
});

describe('templateService.update', () => {
  it('bumps the version, snapshots it and audits a readable change summary', async () => {
    const t = await templateService.update(id, {
      name: own.n('TPL-v2'), description: 'bigger pump', category: 'Utilities',
      attributeSchema: [{ fieldName: 'kw', dataType: 'FLOAT' }, { fieldName: 'rpm', dataType: 'INTEGER' }],
      telemetrySchema: [{ key: 'flow' }], expectedIdentifiers: ['RFID'], statusLifecycle: [{ status: 'Active' }], checklistSchema: [{ q: 'ok?' }],
      maxParentConnections: 3, maxConnections: 6, dataIngestionEnabled: false, transportType: null, credentialType: 'X509',
      templateKind: 'EQUIPMENT', icon: 'pump', inactivityTimeout: 90,
    }, ctx);
    expect(t).toMatchObject({ version: 2, name: own.n('TPL-v2'), maxConnections: 6, transportType: null, icon: 'pump', updatedBy: 'cov-template-svc' });
    expect(await prisma.assetTemplateVersion.count({ where: { templateId: id } })).toBe(2);
    const [audit] = await auditFor(id, 'ASSET_TEMPLATE_UPDATED');
    expect(audit.reason).toBe([
      `Name: "${own.n('TPL')}" → "${own.n('TPL-v2')}"`, 'Description updated', 'Category: "Equipment" → "Utilities"',
      'Attribute schema: 1 → 2 fields', 'Telemetry schema: 0 → 1 fields', 'Expected identifiers: 0 → 1', 'Status lifecycle updated',
      'Checklist items: 0 → 1', 'Max parent connections: 2 → 3', 'Max connections: 4 → 6', 'Data ingestion: disabled',
      'Transport: HTTP → none', 'Credential type: BASIC → X509',
    ].join('; '));
    expect(audit.signatureMeaning).toMatch(new RegExp(`^Template "${own.n('TPL-v2')}" v2: Name: `));
  });

  it('an update that changes nothing still versions, and says so', async () => {
    const t = await templateService.update(id, { description: 'bigger pump', transportType: 'MQTT', dataIngestionEnabled: true }, ctx);
    expect(t.version).toBe(3);
    expect((await auditFor(id, 'ASSET_TEMPLATE_UPDATED'))[0].reason).toBe('Data ingestion: enabled; Transport: none → MQTT');
    const t4 = await templateService.update(id, {}, ctx);
    expect(t4.version).toBe(4);
    const [empty] = await auditFor(id, 'ASSET_TEMPLATE_UPDATED');
    expect(empty.reason).toBe('Template updated');
    expect(empty.signatureMeaning).toBe(`Template "${own.n('TPL-v2')}" v4: updated`);
  });

  it('refuses an unknown template, an unknown kind and a taken name', async () => {
    await expect(templateService.update(randomUUID(), { name: 'x' }, ctx)).rejects.toMatchObject({ statusCode: 404, message: 'Template not found' });
    await expect(templateService.update(id, { templateKind: 'NOPE_KIND' }, ctx)).rejects.toMatchObject({ statusCode: 400 });
    await expect(templateService.update(id, { name: own.n('TPL-DEFAULTS') }, ctx)).rejects.toMatchObject({ statusCode: 409, message: 'Template name already exists' });
    expect((await prisma.assetTemplate.findUnique({ where: { id } }))!.version).toBe(4);
  });
});

describe('templateService.delete (soft)', () => {
  it('refuses while a filter profile binds the template, naming each binding', async () => {
    const cp = await own.cleaningProfile('CP', ['WASH_IN'], ctx.userSub!, { status: 'ARCHIVED' });
    const fp = await own.filterProfile('FP', cp.id);
    await prisma.filterProfileApplicableTemplate.create({ data: { profileId: fp, templateId: id } });
    await expect(templateService.delete(id, ctx)).rejects.toMatchObject({
      statusCode: 409, code: 'TEMPLATE_IN_USE',
      message: `Cannot delete template "${own.n('TPL-v2')}": still bound by 1 filter profile(s) [${own.n('FP')}]. Remove these bindings first.`,
      details: { bindings: [{ id: fp, name: own.n('FP') }] },
    });
    await prisma.filterProfileApplicableTemplate.deleteMany({ where: { templateId: id } });
  });

  it('deactivates the template and audits it; an unknown template is 404', async () => {
    await templateService.delete(id, ctx);
    expect(await prisma.assetTemplate.findUnique({ where: { id } })).toMatchObject({ isActive: false, updatedBy: 'cov-template-svc' });
    const [audit] = await auditFor(id, 'ASSET_TEMPLATE_DELETED');
    expect(audit).toMatchObject({ beforeValue: { name: own.n('TPL-v2'), isActive: true }, afterValue: { isActive: false } });
    await expect(templateService.delete(randomUUID(), ctx)).rejects.toMatchObject({ statusCode: 404 });
  });
});
