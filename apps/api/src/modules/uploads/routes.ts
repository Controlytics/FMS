import { type FastifyInstance } from 'fastify';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
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

// Allowed image types
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export default async function uploadRoutes(app: FastifyInstance) {
  // Ensure directories exist on startup
  await ensureDirectories();

  // POST /api/uploads/photo - Upload profile photo
  app.post('/photo', {
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

      // Save file
      await pipeline(data.file, createWriteStream(filepath));

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
