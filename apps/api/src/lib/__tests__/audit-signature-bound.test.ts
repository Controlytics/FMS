/**
 * audit_trail.signature_meaning is varchar(255) (2026-10-21). Meanings quote
 * user-typed names of up to 255 characters, so an over-long one failed the
 * INSERT and with it the audited action. auditLog now bounds it - from the
 * middle, keeping the subject and the act - BEFORE hashing, so the stored row
 * still verifies.
 *
 * Real Prisma on digilog_test_db for the write; audit rows are append-only, so
 * the row written here stays (the suite already writes many).
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '../prisma.js';
import { auditLog, boundSignatureMeaning, SIGNATURE_MEANING_MAX } from '../audit.js';
import { verifyAuditChecksum } from '../hash-chain.js';

describe('boundSignatureMeaning', () => {
  it('leaves a meaning that fits untouched', () => {
    const fits = 'x'.repeat(SIGNATURE_MEANING_MAX);
    expect(boundSignatureMeaning(fits)).toBe(fits);
    expect(boundSignatureMeaning(undefined)).toBeUndefined();
  });

  it('shortens from the middle: the subject and the act both survive, within the column', () => {
    const meaning = `Report "${'T'.repeat(400)}" rejected at approval`;
    const bounded = boundSignatureMeaning(meaning)!;
    expect(bounded).toHaveLength(SIGNATURE_MEANING_MAX);
    expect(bounded.startsWith('Report "TTT')).toBe(true);
    expect(bounded.endsWith('" rejected at approval')).toBe(true);
    expect(bounded).toContain('…');
  });
});

describe('auditLog with an over-long signature meaning', () => {
  it('writes the row (it used to fail the action) and the stored row verifies', async () => {
    const name = `AHU-${'N'.repeat(300)}`;
    const id = await auditLog({
      userId: 'qa-audit-bound', userRole: 'SUPER_ADMIN', action: 'CONFIG_CHANGED',
      targetType: 'test', targetId: 'audit-signature-bound',
      afterValue: { name },
      signatureMeaning: `Deviation DEV-000001 auto-opened for overdue AHU "${name}" cleaning`,
      ipAddress: '127.0.0.1',
    });
    const row = await prisma.auditTrail.findUniqueOrThrow({ where: { id } });
    expect(row.signatureMeaning!.length).toBeLessThanOrEqual(SIGNATURE_MEANING_MAX);
    expect(row.signatureMeaning!.endsWith('" cleaning')).toBe(true);
    expect((row.afterValue as any).name).toBe(name); // the full name is kept
    expect(verifyAuditChecksum(row as any)).toBe(true);
  });
});
