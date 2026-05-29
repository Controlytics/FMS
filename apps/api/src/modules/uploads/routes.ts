import { type FastifyInstance } from 'fastify';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Uploads directory
const uploadsDir = path.join(__dirname, '..', '..', '..', 'uploads');
const profilePhotosDir = path.join(uploadsDir, 'photos');

// Ensure upload directories exist
async function ensureDirectories() {
  await mkdir(profilePhotosDir, { recursive: true });
}

// Allowed image types — configurable via environment
const ALLOWED_TYPES = (process.env.UPLOAD_ALLOWED_TYPES ?? 'image/jpeg,image/png,image/gif,image/webp').split(',');
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE ?? `${5 * 1024 * 1024}`, 10); // default 5MB

export default async function uploadRoutes(app: FastifyInstance) {
  // Ensure directories exist on startup
  await ensureDirectories();

  // POST /api/uploads/photo - Upload profile photo (authenticated users only)
  app.post('/photo', {
    preHandler: [app.requirePermission('USER_UPDATE')],
    schema: {
      tags: ['Uploads'],
      summary: 'Upload a profile photo',
      description: 'Upload a profile photo image file (JPEG, PNG, GIF, or WebP). Maximum file size is 5 MB. Returns the URL path for the uploaded photo.',
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

      // Generate unique filename — derive extension from validated MIME type, not user-supplied filename
      const MIME_TO_EXT: Record<string, string> = {
        'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
      };
      const ext = MIME_TO_EXT[data.mimetype] || '.jpg';
      const filename = `${req.user.sub}-${randomUUID()}${ext}`;
      const filepath = path.join(profilePhotosDir, filename);

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

      // Validate magic bytes
      const MAGIC_BYTES: Record<string, number[]> = {
        'image/jpeg': [0xFF, 0xD8, 0xFF],
        'image/png': [0x89, 0x50, 0x4E, 0x47],
        'image/gif': [0x47, 0x49, 0x46],
        'image/webp': [0x52, 0x49, 0x46, 0x46], // RIFF header
      };
      const expectedMagic = MAGIC_BYTES[data.mimetype];
      if (expectedMagic) {
        const matches = expectedMagic.every((byte, i) => buffer[i] === byte);
        if (!matches) {
          return reply.code(400).send({ error: 'INVALID_FILE', message: 'File content does not match declared type' });
        }
      }

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
        return reply.code(400).send({ error: 'FILE_TOO_LARGE', message: 'File exceeds maximum size of 5MB' });
      }
      if (err.statusCode === 415 || err.message?.includes('multipart')) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', message: 'Request must be multipart/form-data with a file' });
      }
      app.log.error(err);
      return reply.code(500).send({ error: 'Failed to upload file' });
    }
  });
}
