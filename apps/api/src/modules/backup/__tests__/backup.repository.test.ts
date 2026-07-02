import { describe, it, expect, beforeEach, vi } from 'vitest';

// fetchAllTablesRaw discovers tables via pg_tables, then queries each. We
// stub $queryRawUnsafe with two response shapes:
//   1. The pg_tables / information_schema introspection queries return rows
//      describing the schema (table list + FK list).
//   2. Subsequent SELECT * FROM "<table>" queries return [].
// To keep the stub simple and intent-revealing, mockResolvedValueOnce()
// chains the responses in order.
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import {
  fetchAllTablesRaw,
  resetAuditSequence,
  getAllTables,
} from '../backup.repository.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('backup.repository', () => {
  describe('getAllTables', () => {
    it('lists public tables in topological FK order, excluding the excluded set', async () => {
      // pg_tables → 3 tables; FK introspection → users -> roles
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([
          { tablename: 'roles' },
          { tablename: 'users' },
          { tablename: '_prisma_migrations' }, // EXCLUDED — should be filtered
        ])
        .mockResolvedValueOnce([
          { table_name: 'users', referenced_table: 'roles' },
        ]);

      const tables = await getAllTables();

      expect(tables).not.toContain('_prisma_migrations');
      expect(tables).toContain('roles');
      expect(tables).toContain('users');
      // roles has no deps, users depends on roles → roles must come first
      expect(tables.indexOf('roles')).toBeLessThan(tables.indexOf('users'));
    });
  });

  describe('fetchAllTablesRaw', () => {
    it('queries every discovered table via $queryRawUnsafe', async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ tablename: 'roles' }, { tablename: 'users' }]) // pg_tables
        .mockResolvedValueOnce([])            // foreign-keys (no FKs found)
        .mockResolvedValueOnce([{ c: 0n }])  // COUNT(*) "roles" (pre-flight size guard)
        .mockResolvedValueOnce([{ c: 0n }])  // COUNT(*) "users" (pre-flight size guard)
        .mockResolvedValueOnce([{ id: 1 }])  // SELECT * FROM "roles"
        .mockResolvedValueOnce([{ id: 2 }]); // SELECT * FROM "users"

      const result = await fetchAllTablesRaw();

      expect(result).toHaveProperty('roles');
      expect(result).toHaveProperty('users');
      // 1 pg_tables + 1 FKs + 2 COUNTs (pre-flight) + 2 SELECTs
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(6);
    });

    it('orders the audit_trail SELECT by id ASC for byte-for-byte reproducible backups', async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ tablename: 'audit_trail' }, { tablename: 'roles' }]) // pg_tables
        .mockResolvedValueOnce([])            // foreign-keys
        .mockResolvedValueOnce([{ c: 0n }])  // COUNT(*) "audit_trail" (pre-flight size guard)
        .mockResolvedValueOnce([{ c: 0n }])  // COUNT(*) "roles" (pre-flight size guard)
        .mockResolvedValueOnce([])           // SELECT * FROM "audit_trail"
        .mockResolvedValueOnce([]);          // SELECT * FROM "roles"

      await fetchAllTablesRaw();

      const auditCall = mockPrisma.$queryRawUnsafe.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('audit_trail') && (call[0] as string).startsWith('SELECT *'),
      );
      expect(auditCall).toBeDefined();
      expect(auditCall![0] as string).toContain('ORDER BY id ASC');
    });
  });

  describe('resetAuditSequence', () => {
    it('is a no-op: audit_trail PK is a UUID with no sequence to reset', async () => {
      // Function exists for API stability; should not touch the database.
      await expect(resetAuditSequence()).resolves.toBeUndefined();
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });
  });
});
