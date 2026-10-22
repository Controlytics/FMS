import { type FastifyInstance } from 'fastify';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { UPLOADS_ROOT } from '../../lib/uploads-dir.js';
import { MAX_UPLOAD_FILE_SIZE } from '../../lib/upload-limits.js';
import { getLogger } from '../../lib/logger.js';

// Uploads directory. UPLOADS_ROOT honors UPLOAD_DIR (customer install) — must
// match the static serve root in app.ts, otherwise written photos 404.
const profilePhotosDir = path.join(UPLOADS_ROOT, 'photos');

// Ensure upload directories exist
async function ensureDirectories() {
  await mkdir(profilePhotosDir, { recursive: true });
}

// Allowed image types — configurable via environment
const ALLOWED_TYPES = (process.env.UPLOAD_ALLOWED_TYPES ?? 'image/jpeg,image/png,image/gif,image/webp').split(',');
// The enforced cap is the multipart registration (app.ts / test-helper.ts), which
// reads this same constant; this copy only words the 413 (D-OPS-7).
const MAX_FILE_SIZE = MAX_UPLOAD_FILE_SIZE;

/**
 * What the CONTENT is, by its signature — never the client's word (D-OPS-8,
 * 2026-10-22). The old check compared only a prefix of the claimed type
 * (WebP = "RIFF", so a WAVE/AVI file passed and was served as .webp) and skipped
 * the check entirely for a type with no rule, so a type added through
 * UPLOAD_ALLOWED_TYPES stored any bytes under `.jpg`. Each rule here names the
 * extension the file is stored with.
 */
const SIGNATURES: Array<{ mime: string; ext: string; matches: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg', ext: '.jpg', matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: '.png', matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/gif', ext: '.gif', matches: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')) },
  { mime: 'image/webp', ext: '.webp', matches: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];
const SIGNATURE_BY_MIME = new Map(SIGNATURES.map((s) => [s.mime, s]));

// An allowed type with no signature rule can never be accepted (fail closed);
// say so at load rather than leave the operator guessing why uploads of it fail.
const UNCHECKABLE_TYPES = ALLOWED_TYPES.filter((t) => !SIGNATURE_BY_MIME.has(t));
if (UNCHECKABLE_TYPES.length > 0) {
  getLogger('uploads', 'application').warn(
    { types: UNCHECKABLE_TYPES },
    'UPLOAD_ALLOWED_TYPES lists types with no content check; uploads of them are refused',
  );
}

export default async function uploadRoutes(app: FastifyInstance) {
  // Ensure directories exist on startup
  await ensureDirectories();

  // POST /api/uploads/photo - Upload profile photo (authenticated users only)
  //
  // Deliberately has no permission preHandler: this is self-service by
  // construction — the file is named after the CALLER's own id and the route
  // returns a URL, touching no other user's record. It was gated on USER_UPDATE
  // ("Edit Users"), an admin capability that 6 of 8 seeded roles don't hold, so
  // every non-admin got a 403 setting their own photo from the Profile page.
  // Auth comes from the global onRequest hook (/api/* is not in the public
  // allowlist; only GET /uploads/photos/ is, so images render in <img>).
  app.post('/photo', {
    // Nothing here ever unlinks a file and there is no quota, so each call
    // permanently costs up to MAX_FILE_SIZE of disk. The 30/hour route limit
    // that bounded this was removed 2026-10-10 (operator decision: no rate
    // limits except the three password endpoints) — any signed-in user can
    // now upload without limit. The orphan-file GC remains an open finding.
    schema: {
      tags: ['Uploads'],
      summary: 'Upload a profile photo',
      description: 'Upload a profile photo image file (JPEG, PNG, GIF, or WebP). Maximum file size is MAX_FILE_SIZE bytes (default 5 MB). Returns the URL path for the uploaded photo.',
      consumes: ['multipart/form-data'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            photoUrl: { type: 'string', description: 'Relative URL path to the uploaded photo' },
            filename: { type: 'string', description: 'Generated filename on the server' },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        413: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        500: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    try {
      const data = await req.file();

      if (!data) {
        return reply.code(400).send({ error: 'No file uploaded' });
      }

      // Validate file type
      if (!ALLOWED_TYPES.includes(data.mimetype)) {
        return reply.code(400).send({
          error: 'INVALID_FILE_TYPE',
          message: 'Only JPEG, PNG, GIF, and WebP images are allowed'
        });
      }
      const signature = SIGNATURE_BY_MIME.get(data.mimetype);
      if (!signature) {
        return reply.code(400).send({
          error: 'INVALID_FILE_TYPE',
          message: `Uploads of ${data.mimetype} cannot be content-checked and are not accepted`,
        });
      }

      // Buffer the file first
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      // Check truncation flag — @fastify/multipart silently TRUNCATES the stream
      // at the configured fileSize limit instead of throwing. The post-buffer
      // length check (buffer.length > MAX_FILE_SIZE) is therefore always false
      // because the buffer is capped at exactly MAX_FILE_SIZE bytes. Checking
      // data.file.truncated is the only reliable way to detect oversized uploads.
      if ((data.file as any).truncated) {
        return reply.code(413).send({
          error: 'FILE_TOO_LARGE',
          message: `File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024} MB`,
        });
      }

      // The content must BE the claimed type; the stored extension is that type's.
      if (!signature.matches(buffer)) {
        return reply.code(400).send({ error: 'INVALID_FILE', message: 'File content does not match declared type' });
      }
      const filename = `${req.user.sub}-${randomUUID()}${signature.ext}`;
      const filepath = path.join(profilePhotosDir, filename);

      // Write to disk
      await writeFile(filepath, buffer);

      // Return the URL
      const photoUrl = `/uploads/photos/${filename}`;

      return {
        success: true,
        photoUrl,
        filename,
      };
    } catch (err: any) {
      if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(400).send({ error: 'FILE_TOO_LARGE', message: `File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024} MB` });
      }
      if (err.statusCode === 415 || err.message?.includes('multipart')) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', message: 'Request must be multipart/form-data with a file' });
      }
      app.log.error(err);
      return reply.code(500).send({ error: 'Failed to upload file' });
    }
  });
}
