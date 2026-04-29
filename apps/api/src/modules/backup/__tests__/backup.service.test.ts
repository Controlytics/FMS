import { describe, it, expect, beforeEach, vi } from 'vitest';
import { gunzipSync, gzipSync } from 'zlib';

const { mockFetchPrisma, mockFetchRaw, mockRestoreFromBackup, mockResetAuditSequence, mockAuditLog, mockComputeChecksum } = vi.hoisted(() => ({
  mockFetchPrisma: vi.fn(),
  mockFetchRaw: vi.fn(),
  mockRestoreFromBackup: vi.fn(),
  mockResetAuditSequence: vi.fn(),
  mockAuditLog: vi.fn(),
  mockComputeChecksum: vi.fn(),
}));

vi.mock('../backup.repository.js', () => ({
  fetchAllTablesPrisma: mockFetchPrisma,
  fetchAllTablesRaw: mockFetchRaw,
  restoreFromBackup: mockRestoreFromBackup,
  resetAuditSequence: mockResetAuditSequence,
}));

vi.mock('../../../lib/audit.js', () => ({ auditLog: mockAuditLog }));

vi.mock('../backup.helpers.js', async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    computeBackupChecksum: mockComputeChecksum,
  };
});

import { validate, restore } from '../backup.service.js';

const ctx = { userId: 'admin', userSub: 'sub-1', userRole: 'ADMIN', ipAddress: '127.0.0.1', userAgent: 'test', sessionId: 'sess-1' };

function makeBackup(overrides: Record<string, any> = {}) {
  return {
    metadata: {
      version: '1.0',
      timestamp: '2026-01-01T00:00:00Z',
      generatedBy: 'admin',
      tableCount: 2,
      checksum: 'abc123',
      format: 'json',
      ...overrides,
    },
    data: { roles: [{ name: 'ADMIN' }], users: [{ id: 'u1' }] },
  };
}

describe('backup.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditLog.mockResolvedValue(undefined);
  });

  describe('validate', () => {
    it('validates a valid JSON backup', async () => {
      const backup = makeBackup();
      const buf = Buffer.from(JSON.stringify(backup));
      mockComputeChecksum.mockReturnValue('abc123');

      const result = await validate(buf);
      expect(result.valid).toBe(true);
      expect(result.checksumValid).toBe(true);
      expect(result.metadata.version).toBe('1.0');
    });

    it('validates a gzip compressed backup', async () => {
      const backup = makeBackup({ format: 'bak' });
      const buf = gzipSync(Buffer.from(JSON.stringify(backup)));
      mockComputeChecksum.mockReturnValue('abc123');

      const result = await validate(buf);
      expect(result.valid).toBe(true);
    });

    it('detects checksum mismatch', async () => {
      const backup = makeBackup();
      const buf = Buffer.from(JSON.stringify(backup));
      mockComputeChecksum.mockReturnValue('wrong-checksum');

      const result = await validate(buf);
      expect(result.checksumValid).toBe(false);
    });

    it('returns table summary with record counts', async () => {
      const backup = makeBackup();
      const buf = Buffer.from(JSON.stringify(backup));
      mockComputeChecksum.mockReturnValue('abc123');

      const result = await validate(buf);
      expect(result.tableSummary.roles).toBe(1);
      expect(result.tableSummary.users).toBe(1);
      expect(result.totalRecords).toBe(2);
    });

    it('rejects invalid JSON', async () => {
      const buf = Buffer.from('not json');
      await expect(validate(buf)).rejects.toThrow();
    });

    it('rejects missing metadata', async () => {
      const buf = Buffer.from(JSON.stringify({ data: {} }));
      await expect(validate(buf)).rejects.toThrow();
    });
  });

  describe('restore', () => {
    it('restores valid backup successfully', async () => {
      const backup = makeBackup();
      const buf = Buffer.from(JSON.stringify(backup));
      mockComputeChecksum.mockReturnValue('abc123');
      mockRestoreFromBackup.mockResolvedValue(undefined);

      const result = await restore(buf, ctx);
      expect(result.success).toBe(true);
      expect(result.backupVersion).toBe('1.0');
      expect(mockRestoreFromBackup).toHaveBeenCalled();
      // resetAuditSequence is no longer called - audit_trail uses UUID PKs
      // (no sequence to reset). The function still exists as a no-op for
      // call-site compatibility.
      expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'BACKUP_RESTORED' }));
    });

    it('rejects backup with checksum mismatch', async () => {
      const backup = makeBackup();
      const buf = Buffer.from(JSON.stringify(backup));
      mockComputeChecksum.mockReturnValue('wrong');

      await expect(restore(buf, ctx)).rejects.toThrow();
    });
  });
});
