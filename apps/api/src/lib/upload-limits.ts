import { getLogger } from './logger.js';

/**
 * The ONE upload size limit (D-OPS-7, 2026-10-22).
 *
 * `MAX_FILE_SIZE` (bytes, `.env` / `.env.example`) was documented as the upload
 * limit, but only the photo route read it, and only for its 413 MESSAGE. The cap
 * actually enforced was a literal `5 * 1024 * 1024` in the multipart registration
 * (app.ts, mirrored by e2e/test-helper.ts), so setting MAX_FILE_SIZE=2 MB still
 * let a 3 MB photo through, and 8 MB still refused at 5 MB while the message
 * claimed 8. Both registrations and the photo route now read this constant.
 *
 * It is the multipart DEFAULT: every route that calls `req.file()` / `req.parts()`
 * without its own `limits` gets it (photo, filter bulk upload, PM upload,
 * replacement-schedule upload). A route may still pass a per-request `limits`
 * (backup restore / validate ask for 100 MB), which @fastify/multipart 9 honours
 * in both directions.
 *
 * Read once at import, after `dotenv/config` (app.ts imports that first).
 */
export const DEFAULT_MAX_UPLOAD_FILE_SIZE = 5 * 1024 * 1024;

/** `raw` as a whole positive number of bytes, or null when it is not one. */
export function parseMaxFileSize(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function resolveMaxUploadFileSize(): number {
  const raw = process.env.MAX_FILE_SIZE;
  const parsed = parseMaxFileSize(raw);
  if (parsed !== null) return parsed;
  if (raw !== undefined && raw.trim() !== '') {
    // A typo must not brick the service at boot, and must not pass silently
    // either: say which value was refused and which limit is in force.
    getLogger('uploads', 'application').warn(
      { MAX_FILE_SIZE: raw, appliedBytes: DEFAULT_MAX_UPLOAD_FILE_SIZE },
      'MAX_FILE_SIZE is not a positive whole number of bytes; using the 5 MB default',
    );
  }
  return DEFAULT_MAX_UPLOAD_FILE_SIZE;
}

export const MAX_UPLOAD_FILE_SIZE = resolveMaxUploadFileSize();
