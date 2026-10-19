/**
 * M55 (QA 2026-10-19): delete profile-photo files nothing references.
 *
 * POST /api/uploads/photo writes `<userId>-<uuid>.<ext>` and the profile save
 * then points users.photo_url at it. Nothing ever deleted a file: every replaced
 * photo, and every upload whose profile save was cancelled, stayed on disk
 * forever. (The route's rate limit was removed by operator decision 2026-10-10 —
 * this sweep does NOT bring one back; it only removes orphans.)
 *
 * Safety rules, all required before a file is removed:
 *  1. it sits directly in <UPLOADS_ROOT>/photos;
 *  2. its name matches the generator's pattern exactly (uuid-uuid.ext), so no
 *     hand-placed or foreign file is ever touched;
 *  3. no users.photo_url references it;
 *  4. it is older than `minAgeMs` (default 24 h), so a photo uploaded but not yet
 *     saved to the profile is never deleted from under the user.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from './prisma.js';
import { UPLOADS_ROOT } from './uploads-dir.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const GENERATED_PHOTO_NAME = new RegExp(`^${UUID}-${UUID}\\.(jpg|png|gif|webp)$`, 'i');

export async function sweepOrphanPhotos(opts: { dir?: string; minAgeMs?: number; now?: number } = {}) {
  const dir = opts.dir ?? path.join(UPLOADS_ROOT, 'photos');
  const minAgeMs = opts.minAgeMs ?? 24 * 60 * 60 * 1000;
  const now = opts.now ?? Date.now();

  let names: string[];
  try { names = await fs.readdir(dir); }
  catch (e: any) { if (e?.code === 'ENOENT') return { scanned: 0, deleted: 0, kept: 0, errors: [] as string[] }; throw e; }

  const candidates = names.filter((n) => GENERATED_PHOTO_NAME.test(n));
  const referenced = new Set(
    (await prisma.user.findMany({ where: { photoUrl: { not: null } }, select: { photoUrl: true } }))
      .map((u) => path.basename(u.photoUrl ?? '')),
  );

  let deleted = 0;
  let kept = 0;
  const errors: string[] = [];
  for (const name of candidates) {
    if (referenced.has(name)) { kept++; continue; }
    const full = path.join(dir, name);
    try {
      const st = await fs.stat(full);
      if (!st.isFile() || now - st.mtimeMs < minAgeMs) { kept++; continue; }
      await fs.unlink(full);
      deleted++;
    } catch (e: any) {
      errors.push(`${name}: ${e?.code ?? e?.message ?? 'error'}`);
    }
  }
  return { scanned: candidates.length, deleted, kept, errors };
}
