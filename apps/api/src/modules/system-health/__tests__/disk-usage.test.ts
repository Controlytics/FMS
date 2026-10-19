/**
 * M51 (QA 2026-10-19): disk usage is measured with statfs on the app's own
 * volume, and a failure is reported as unavailable — never as a healthy 0 %.
 * Before: `wmic` (deprecated, missing on Windows 11 24H2+) on a hard-coded C:,
 * and any failure returned { usagePercent: 0 }.
 */
import { describe, it, expect } from 'vitest';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDiskUsage } from '../routes.js';

describe('getDiskUsage (M51)', () => {
  it('measures a real volume with consistent numbers', async () => {
    const d = await getDiskUsage(os.tmpdir());
    expect(d.available).toBe(true);
    expect(d.total).toBeGreaterThan(0);
    expect((d.used ?? 0) + (d.free ?? 0)).toBe(d.total);
    expect(d.usagePercent).toBeGreaterThanOrEqual(0);
    expect(d.usagePercent).toBeLessThanOrEqual(100);
  });

  it('reports an unmeasurable path as unavailable with no numbers', async () => {
    const d = await getDiskUsage(resolve(os.tmpdir(), `does-not-exist-${Date.now()}`, 'x'));
    expect(d.available).toBe(false);
    expect(d.usagePercent).toBeNull();
    expect(d.total).toBeNull();
  });

  it('no longer shells out to wmic', () => {
    const src = readFileSync(resolve(__dirname, '../routes.ts'), 'utf8');
    expect(src).not.toMatch(/['"`]wmic|execAsync|child_process/);
  });
});
