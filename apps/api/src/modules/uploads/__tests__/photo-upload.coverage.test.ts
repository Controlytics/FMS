/**
 * POST /api/uploads/photo — behaviour through the real route (2026-10-21).
 *
 * UPLOAD_DIR points at a private temp folder for this file only (set before any
 * module reads it, restored in afterAll), so the bytes the route writes can be
 * read back and nothing lands in the repo's uploads/ folder. Every outcome is
 * asserted as a client sees it (status + body) and as the disk sees it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

const env = vi.hoisted(() => {
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const fs = require('node:fs') as typeof import('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cvo-uploads-'));
  const prev = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  return { dir, prev };
});

import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp, internalErrors } from '../../../e2e/test-helper.js';
import uploadRoutes from '../routes.js';
import { UPLOADS_ROOT } from '../../../lib/uploads-dir.js';
import { cleanupAll, createUser, deleteUsers, login, runSuffix } from '../../../e2e/support/owned-fixtures.js';

const S = runSuffix();
const PW = 'CvoUpl@2026!x';
const USER = `cvoupl${S}`.toLowerCase();
let app: FastifyInstance;
let userId = '';
let token = '';
const photosDir = () => path.join(env.dir, 'photos');

function multipart(file: { bytes: Buffer; type: string; name?: string } | null, fieldName = 'file') {
  const B = '----cvouploadtest';
  const parts: Buffer[] = [Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello\r\n`)];
  if (file) {
    parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${file.name ?? 'p.bin'}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    parts.push(file.bytes, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${B}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${B}` };
}

async function upload(file: { bytes: Buffer; type: string; name?: string } | null, auth = true) {
  const { payload, contentType } = multipart(file);
  return app.inject({
    method: 'POST', url: '/api/uploads/photo', payload,
    headers: { 'content-type': contentType, ...(auth ? { authorization: `Bearer ${token}` } : {}) },
  });
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('cvo-png-body')]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('cvo-jpg-body')]);
const GIF = Buffer.from('GIF89a-cvo');
const WEBP = Buffer.from('RIFF\x00\x00\x00\x00WEBPcvo', 'latin1');

beforeAll(async () => {
  userId = await createUser(USER, 'OPERATOR', PW);
  app = await buildApp([{ plugin: uploadRoutes, prefix: '/api/uploads' }]);
  token = await login(app, USER, PW);
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['users', () => deleteUsers([userId])],
    ['app', () => app?.close()],
    ['temp dir', () => rm(env.dir, { recursive: true, force: true })],
    ['env', async () => { if (env.prev === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = env.prev; }],
  ]);
}, 60_000);

beforeEach(() => { internalErrors.length = 0; });

describe('POST /api/uploads/photo', () => {
  it('writes into UPLOAD_DIR/photos (the same root the static server serves)', () => {
    expect(UPLOADS_ROOT).toBe(path.resolve(env.dir));
  });

  it.each([
    ['image/png', PNG, '.png'],
    ['image/jpeg', JPG, '.jpg'],
    ['image/gif', GIF, '.gif'],
    ['image/webp', WEBP, '.webp'],
  ])('accepts %s, names the file after the CALLER, and stores the exact bytes', async (type, bytes, ext) => {
    const res = await upload({ bytes, type, name: '../../evil.exe' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    // Extension comes from the validated MIME type, never the client filename.
    expect(body.filename).toMatch(new RegExp(`^${userId}-[0-9a-f-]{36}\\${ext}$`));
    expect(body.photoUrl).toBe(`/uploads/photos/${body.filename}`);
    expect(await readFile(path.join(photosDir(), body.filename))).toEqual(bytes);
  });

  it('refuses a non-image MIME type and writes nothing', async () => {
    const before = (await readdir(photosDir())).length;
    const res = await upload({ bytes: Buffer.from('%PDF-1.7'), type: 'application/pdf' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'INVALID_FILE_TYPE', message: 'Only JPEG, PNG, GIF, and WebP images are allowed' });
    expect((await readdir(photosDir())).length).toBe(before);
  });

  it('refuses content whose magic bytes do not match the declared type', async () => {
    const before = (await readdir(photosDir())).length;
    const res = await upload({ bytes: Buffer.from('<?php system($_GET[1]); ?>'), type: 'image/png' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'INVALID_FILE', message: 'File content does not match declared type' });
    expect((await readdir(photosDir())).length).toBe(before);
  });

  it('a multipart body with no file part is a 400', async () => {
    const res = await upload(null);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('No file uploaded');
  });

  it('a non-multipart body is a 400 INVALID_REQUEST, not a 500', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/uploads/photo', payload: { file: 'x' },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'INVALID_REQUEST', message: 'Request must be multipart/form-data with a file' });
    expect(internalErrors).toEqual([]);
  });

  it('a file over the 5 MB limit is refused and nothing is written', async () => {
    const before = (await readdir(photosDir())).length;
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 10, 1)]);
    const res = await upload({ bytes: big, type: 'image/png' });
    // @fastify/multipart truncates the stream at the limit; the route detects it.
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: 'FILE_TOO_LARGE', message: 'File exceeds maximum size of 5 MB' });
    expect((await readdir(photosDir())).length).toBe(before);
  });

  it('a disk-write failure answers 500 "Failed to upload file" (the route handles it itself)', async () => {
    await rm(photosDir(), { recursive: true, force: true });
    try {
      const res = await upload({ bytes: PNG, type: 'image/png' });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: 'Failed to upload file' });
    } finally {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(photosDir(), { recursive: true });
    }
  });

  it('needs a token', async () => {
    const res = await upload({ bytes: PNG, type: 'image/png' }, false);
    expect(res.statusCode).toBe(401);
  });
});
