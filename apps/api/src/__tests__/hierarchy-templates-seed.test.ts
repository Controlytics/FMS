/**
 * 2026-10-21 (go-live blocker found by the coverage campaign): a fresh install
 * had NO asset templates, so "Create Block" failed (400 templateId required) and
 * a typed filter insert raised in the mirror trigger. The seed now ensures one
 * active template per hierarchy kind, create-only. Runs against digilog_test_db
 * (which, rebuilt from migrations + seed, is exactly a fresh install).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../lib/prisma.js';
import { ensureHierarchyTemplates, HIERARCHY_TEMPLATES } from '../../prisma/hierarchy-templates.js';

describe('seed: hierarchy asset templates', () => {
  it('leaves an active template for every hierarchy kind, and a second run creates nothing', async () => {
    await ensureHierarchyTemplates(prisma as any);
    for (const t of HIERARCHY_TEMPLATES) {
      const n = await prisma.assetTemplate.count({ where: { templateKind: t.templateKind, isActive: true } });
      expect(n, t.templateKind).toBeGreaterThan(0);
    }
    const again = await ensureHierarchyTemplates(prisma as any);
    expect(again.created).toEqual([]);
  });

  it('is wired into the seed (the installer runs the seed on install and upgrade)', () => {
    const seed = readFileSync(join(__dirname, '..', '..', 'prisma', 'seed.ts'), 'utf8');
    expect(seed).toMatch(/await ensureHierarchyTemplates\(prisma\)/);
  });
});
