/**
 * An oversized replacement-schedule file is answered like every other upload
 * route: 413 { error: 'FILE_TOO_LARGE', message } — on the dry-run validate and
 * on the upload. It used to fall through to the global handler as 413
 * INVALID_REQUEST with Fastify's raw "request file too large", which the upload
 * dialog showed verbatim. Real harness app with the production 5 MB multipart
 * limit; nothing is written.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { buildApp, internalErrors } from '../../../e2e/test-helper.js';
import replacementScheduleRoutes from '../routes.js';
import { SliceOwner, runTag, type Caller } from '../../assets/__tests__/slice-support.js';

const own = new SliceOwner(runTag('CVRS'));
let app: FastifyInstance;
let sa: { call: Caller };

function multipart(file?: Buffer) {
  const b = `----cvrs${randomUUID().replace(/-/g, '')}`;
  const chunks: Buffer[] = [];
  if (file) chunks.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="schedule.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`), file, Buffer.from('\r\n'));
  else chunks.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="note"\r\n\r\nx\r\n`));
  chunks.push(Buffer.from(`--${b}--\r\n`));
  return { body: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

beforeAll(async () => {
  app = await buildApp([{ plugin: replacementScheduleRoutes, prefix: '/api/replacement-schedules' }]);
  sa = await own.user(app, 'sa', 'SUPER_ADMIN');
}, 60_000);

afterAll(async () => {
  await own.cleanup();
  await app?.close();
}, 60_000);

describe('replacement-schedule upload — file over the multipart limit', () => {
  it('validate and upload both answer 413 FILE_TOO_LARGE, write nothing, and raise no internal error', async () => {
    internalErrors.length = 0;
    const before = await prisma.replacementSchedule.count();
    const big = Buffer.alloc(5 * 1024 * 1024 + 4096, 0x41);
    for (const url of ['/api/replacement-schedules/validate', '/api/replacement-schedules']) {
      const res = await sa.call('POST', url, multipart(big));
      expect(res.status, url).toBe(413);
      expect(res.body, url).toEqual({ error: 'FILE_TOO_LARGE', message: 'Upload exceeds the maximum file size (5 MB).' });
    }
    expect(await prisma.replacementSchedule.count()).toBe(before);
    expect(internalErrors).toEqual([]);
  });

  it('a request with no file is still a 400', async () => {
    const res = await sa.call('POST', '/api/replacement-schedules/validate', multipart());
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'VALIDATION', message: 'A file is required' });
  });
});
