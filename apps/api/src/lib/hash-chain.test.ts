import { describe, it, expect } from 'vitest';
import { computeChecksum, verifyAuditChecksum } from './hash-chain.js';

describe('computeChecksum', () => {
  it('produces a SHA-256 hex string (64 chars)', () => {
    const checksum = computeChecksum({ key: 'value' });
    expect(checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic for the same input', () => {
    const data = { action: 'LOGIN', userId: 'user1', timestamp: '2025-01-01T00:00:00.000Z' };
    const c1 = computeChecksum(data);
    const c2 = computeChecksum(data);
    expect(c1).toBe(c2);
  });

  it('sorts keys for deterministic ordering', () => {
    const c1 = computeChecksum({ b: 2, a: 1 });
    const c2 = computeChecksum({ a: 1, b: 2 });
    expect(c1).toBe(c2);
  });

  it('produces different checksums for different data', () => {
    const c1 = computeChecksum({ action: 'LOGIN' });
    const c2 = computeChecksum({ action: 'LOGOUT' });
    expect(c1).not.toBe(c2);
  });

  it('handles empty object', () => {
    const checksum = computeChecksum({});
    expect(checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('handles nested objects', () => {
    const checksum = computeChecksum({ data: { nested: true, value: 42 } });
    expect(checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('handles null values in data', () => {
    const c1 = computeChecksum({ key: null });
    const c2 = computeChecksum({ key: 'value' });
    expect(c1).not.toBe(c2);
  });
});

describe('verifyAuditChecksum', () => {
  it('verifies a valid audit record', () => {
    const timestamp = '2025-01-15T10:30:00.000Z';
    const record = {
      timestamp,
      userId: 'admin',
      action: 'LOGIN_SUCCESS',
      targetType: 'user',
      targetId: 'user-123',
      afterValue: { username: 'admin' },
      checksum: '', // will be computed below
    };

    // Compute expected checksum
    record.checksum = computeChecksum({
      timestamp,
      userId: 'admin',
      action: 'LOGIN_SUCCESS',
      targetType: 'user',
      targetId: 'user-123',
      afterValue: { username: 'admin' },
    });

    expect(verifyAuditChecksum(record)).toBe(true);
  });

  it('detects tampered action', () => {
    const timestamp = '2025-01-15T10:30:00.000Z';
    const checksum = computeChecksum({
      timestamp,
      userId: 'admin',
      action: 'LOGIN_SUCCESS',
      targetType: 'user',
      targetId: 'user-123',
      afterValue: undefined,
    });

    expect(verifyAuditChecksum({
      timestamp,
      userId: 'admin',
      action: 'ACCOUNT_LOCKED', // tampered
      targetType: 'user',
      targetId: 'user-123',
      checksum,
    })).toBe(false);
  });

  it('detects tampered timestamp', () => {
    const timestamp = '2025-01-15T10:30:00.000Z';
    const checksum = computeChecksum({
      timestamp,
      userId: 'admin',
      action: 'LOGIN_SUCCESS',
    });

    expect(verifyAuditChecksum({
      timestamp: '2025-01-16T10:30:00.000Z', // tampered
      userId: 'admin',
      action: 'LOGIN_SUCCESS',
      checksum,
    })).toBe(false);
  });

  it('handles Date object in timestamp', () => {
    const date = new Date('2025-01-15T10:30:00.000Z');
    const checksum = computeChecksum({
      timestamp: date.toISOString(),
      action: 'TEST_ACTION',
    });

    expect(verifyAuditChecksum({
      timestamp: date,
      action: 'TEST_ACTION',
      checksum,
    })).toBe(true);
  });

  it('handles null optional fields', () => {
    const checksum = computeChecksum({
      timestamp: '2025-01-15T10:30:00.000Z',
      action: 'TEST',
    });

    expect(verifyAuditChecksum({
      timestamp: '2025-01-15T10:30:00.000Z',
      userId: null,
      action: 'TEST',
      targetType: null,
      targetId: null,
      checksum,
    })).toBe(true);
  });

  it('handles undefined optional fields', () => {
    const checksum = computeChecksum({
      timestamp: '2025-06-01T00:00:00.000Z',
      action: 'DELETE',
    });

    expect(verifyAuditChecksum({
      timestamp: '2025-06-01T00:00:00.000Z',
      action: 'DELETE',
      checksum,
    })).toBe(true);
  });
});
