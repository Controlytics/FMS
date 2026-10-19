/**
 * M55 (QA 2026-10-19): orphan profile photos are removed; referenced, recent and
 * foreign files are never touched. Uses a temp directory and the real
 * digilog_test_db users table (one user owns its photo_url).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma.js';
import { sweepOrphanPhotos } from '../photo-orphan-sweep.js';

const dir = path.join(os.tmpdir(), `qa-m55-${Date.now()}`);
const DAY = 24 * 60 * 60 * 1000;
const name = () => `${randomUUID()}-${randomUUID()}.jpg`;
const referencedName = name();
const orphanOld = name();
const orphanRecent = name();
const foreign = 'logo-do-not-touch.png';
const USERNAME = `qa_m55_${Date.now()}`;

async function touch(file: string, ageMs: number) {
  const p = path.join(dir, file);
  await fs.writeFile(p, 'x');
  const t = new Date(Date.now() - ageMs);
  await fs.utimes(p, t, t);
}

describe('sweepOrphanPhotos (M55)', () => {
  beforeAll(async () => {
    await fs.mkdir(dir, { recursive: true });
    await touch(referencedName, 3 * DAY);
    await touch(orphanOld, 3 * DAY);
    await touch(orphanRecent, 60 * 1000);
    await touch(foreign, 3 * DAY);
    await prisma.user.create({
      data: { username: USERNAME, fullName: 'QA M55', passwordHash: 'x', role: 'OPERATOR', photoUrl: `/uploads/photos/${referencedName}`, createdBy: 'qa-m55-test' },
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('deletes only the old, unreferenced, generator-named file', async () => {
    const r = await sweepOrphanPhotos({ dir });
    const left = await fs.readdir(dir);
    expect(left).toContain(referencedName);
    expect(left).toContain(orphanRecent);
    expect(left).toContain(foreign);
    expect(left).not.toContain(orphanOld);
    expect(r.deleted).toBe(1);
    expect(r.errors).toEqual([]);
  });

  it('a missing photos directory is not an error', async () => {
    const r = await sweepOrphanPhotos({ dir: path.join(dir, 'nope') });
    expect(r).toMatchObject({ scanned: 0, deleted: 0 });
  });
});
