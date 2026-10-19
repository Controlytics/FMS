/**
 * C-11 (QA 2026-10-19):
 *  1. failStrandedRetries() closes RETRYING rows left by a dead process as FAILED
 *     with a reason (they used to stay RETRYING forever after a restart);
 *  2. the first retry waits RETRY_DELAYS[0] (5 s) — the value written to
 *     nextRetryAt — instead of RETRY_DELAYS[1] (15 s).
 * Real digilog_test_db for the log rows; the EMAIL channel is mocked to fail.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';

vi.mock('../channels/email-channel.js', () => ({
  emailChannel: { send: vi.fn(async () => ({ success: false, error: 'qa-c11 forced failure' })) },
}));

import { prisma } from '../../../lib/prisma.js';
import { failStrandedRetries, sendNotification } from '../delivery.service.js';

const TAG = `qa-c11-${Date.now()}`;

afterAll(async () => {
  await prisma.notificationLog.deleteMany({ where: { recipient: { contains: TAG } } });
});

describe('notification retries (C-11)', () => {
  it('closes a RETRYING row left by a dead process as FAILED, with the reason', async () => {
    const row = await prisma.notificationLog.create({
      data: { channel: 'EMAIL', recipient: `${TAG}-stranded@example.test`, message: 'x', status: 'RETRYING', retryCount: 1, nextRetryAt: new Date(Date.now() - 60_000) },
    });
    const r = await failStrandedRetries();
    expect(r.failed).toBeGreaterThanOrEqual(1);
    const after = await prisma.notificationLog.findUnique({ where: { id: row.id } });
    expect(after?.status).toBe('FAILED');
    expect(after?.nextRetryAt).toBeNull();
    expect(after?.errorMessage).toMatch(/server restart/);
  });

  it('the first retry waits the 5 s that nextRetryAt promises', async () => {
    const delays: number[] = [];
    const real = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: any, ms?: number) => {
      delays.push(ms ?? 0);
      return real(fn, 0);
    }) as any);
    try {
      await sendNotification({ channel: 'EMAIL', recipient: `${TAG}-live@example.test`, message: 'x', subject: 's' } as any);
      // let the fire-and-forget retry chain run (each setTimeout fires immediately)
      for (let i = 0; i < 20 && delays.length < 2; i++) await new Promise((r) => real(r, 20));
    } finally {
      spy.mockRestore();
    }
    expect(delays[0]).toBe(5000);
    expect(delays[1]).toBe(15000);
  });
});
