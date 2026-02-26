import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockFindUnique, mockUpdate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    ingestionSystemConfig: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

import {
  getConfig,
  getConfigOrDefault,
  setConfig,
  invalidateConfigCache,
  clearConfigCache,
} from '../ingestion-config.service.js';

// -- Fixtures ----------------------------------------------------------------

const makeConfig = (overrides: Record<string, unknown> = {}) => ({
  key: 'test.key',
  value: '42',
  dataType: 'INTEGER',
  minValue: null as string | null,
  maxValue: null as string | null,
  ...overrides,
});

// -- Tests -------------------------------------------------------------------

describe('ingestion-config.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearConfigCache();
  });

  // ── getConfig ──────────────────────────────────────────────────────────

  describe('getConfig', () => {
    // 1. Returns parsed value from DB on cache miss
    it('should fetch from DB and return parsed value on cache miss', async () => {
      mockFindUnique.mockResolvedValue(makeConfig({ value: '100', dataType: 'INTEGER' }));

      const result = await getConfig<number>('test.key');

      expect(result).toBe(100);
      expect(mockFindUnique).toHaveBeenCalledWith({ where: { key: 'test.key' } });
    });

    // 2. Returns cached value on cache hit (no second DB call)
    it('should return cached value on second call without querying DB again', async () => {
      mockFindUnique.mockResolvedValue(makeConfig({ value: '55', dataType: 'INTEGER' }));

      const first = await getConfig<number>('test.key');
      const second = await getConfig<number>('test.key');

      expect(first).toBe(55);
      expect(second).toBe(55);
      expect(mockFindUnique).toHaveBeenCalledTimes(1);
    });

    // 3. Throws when key not found in DB
    it('should throw when config key is not found in DB', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(getConfig('missing.key')).rejects.toThrow('Config key not found: missing.key');
    });

    // 4. Parses INTEGER data type
    it('should parse INTEGER data type correctly', async () => {
      mockFindUnique.mockResolvedValue(makeConfig({ value: '999', dataType: 'INTEGER' }));

      const result = await getConfig<number>('int.key');

      expect(result).toBe(999);
      expect(typeof result).toBe('number');
    });

    // 5. Parses FLOAT data type
    it('should parse FLOAT data type correctly', async () => {
      mockFindUnique.mockResolvedValue(makeConfig({ key: 'float.key', value: '3.14', dataType: 'FLOAT' }));

      const result = await getConfig<number>('float.key');

      expect(result).toBeCloseTo(3.14);
      expect(typeof result).toBe('number');
    });

    // 6. Parses BOOLEAN data type ('true' and '1')
    it('should parse BOOLEAN data type correctly', async () => {
      mockFindUnique.mockResolvedValue(makeConfig({ key: 'bool.true', value: 'true', dataType: 'BOOLEAN' }));
      const resultTrue = await getConfig<boolean>('bool.true');
      expect(resultTrue).toBe(true);

      clearConfigCache();
      mockFindUnique.mockResolvedValue(makeConfig({ key: 'bool.one', value: '1', dataType: 'BOOLEAN' }));
      const resultOne = await getConfig<boolean>('bool.one');
      expect(resultOne).toBe(true);

      clearConfigCache();
      mockFindUnique.mockResolvedValue(makeConfig({ key: 'bool.false', value: 'false', dataType: 'BOOLEAN' }));
      const resultFalse = await getConfig<boolean>('bool.false');
      expect(resultFalse).toBe(false);
    });

    // 7. Parses JSON data type
    it('should parse JSON data type correctly', async () => {
      const jsonObj = { enabled: true, retries: 3 };
      mockFindUnique.mockResolvedValue(makeConfig({
        key: 'json.key',
        value: JSON.stringify(jsonObj),
        dataType: 'JSON',
      }));

      const result = await getConfig<typeof jsonObj>('json.key');

      expect(result).toEqual(jsonObj);
    });

    // 8. Parses STRING data type — tries JSON.parse, falls back to raw string
    it('should parse STRING data type with JSON fallback to raw string', async () => {
      // When value is valid JSON, it should parse it
      mockFindUnique.mockResolvedValue(makeConfig({ key: 'str.json', value: '"hello"', dataType: 'STRING' }));
      const jsonResult = await getConfig<string>('str.json');
      expect(jsonResult).toBe('hello');

      clearConfigCache();

      // When value is not valid JSON, it should return raw string
      mockFindUnique.mockResolvedValue(makeConfig({ key: 'str.raw', value: 'plain text', dataType: 'STRING' }));
      const rawResult = await getConfig<string>('str.raw');
      expect(rawResult).toBe('plain text');
    });
  });

  // ── getConfigOrDefault ─────────────────────────────────────────────────

  describe('getConfigOrDefault', () => {
    // 9. Returns value when config exists
    it('should return the config value when key exists', async () => {
      mockFindUnique.mockResolvedValue(makeConfig({ value: '200', dataType: 'INTEGER' }));

      const result = await getConfigOrDefault<number>('test.key', 50);

      expect(result).toBe(200);
    });

    // 10. Returns default when config key is not found
    it('should return default value when key is not found', async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await getConfigOrDefault<number>('missing.key', 50);

      expect(result).toBe(50);
    });
  });

  // ── setConfig ──────────────────────────────────────────────────────────

  describe('setConfig', () => {
    // 11. Updates value in DB and invalidates cache
    it('should update DB and invalidate cache on success', async () => {
      mockFindUnique.mockResolvedValue(makeConfig({ dataType: 'STRING' }));
      mockUpdate.mockResolvedValue({});

      // Pre-populate cache
      clearConfigCache();
      mockFindUnique.mockResolvedValueOnce(makeConfig({ value: 'old', dataType: 'STRING' }));
      await getConfig('test.key');
      expect(mockFindUnique).toHaveBeenCalledTimes(1);

      // Now setConfig
      mockFindUnique.mockResolvedValueOnce(makeConfig({ dataType: 'STRING' }));
      await setConfig('test.key', 'new-value', 'user-001');

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { key: 'test.key' },
        data: { value: 'new-value', updatedBy: 'user-001' },
      });

      // After setConfig, cache should be invalidated => next getConfig should hit DB
      mockFindUnique.mockResolvedValueOnce(makeConfig({ value: 'new-value', dataType: 'STRING' }));
      await getConfig('test.key');
      // findUnique: 1 (initial get) + 1 (setConfig lookup) + 1 (post-set get) = 3
      expect(mockFindUnique).toHaveBeenCalledTimes(3);
    });

    // 12. Throws when key not found
    it('should throw when setting a non-existent config key', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(setConfig('missing.key', 'value', 'user-001'))
        .rejects.toThrow('Config key not found: missing.key');
    });

    // 13. Validates numeric value is not below minValue
    it('should throw when numeric value is below minimum', async () => {
      mockFindUnique.mockResolvedValue(makeConfig({
        dataType: 'INTEGER',
        minValue: '10',
        maxValue: null,
      }));

      await expect(setConfig('test.key', 5, 'user-001'))
        .rejects.toThrow('Config test.key: value 5 below minimum 10');
    });

    // 14. Validates numeric value is not above maxValue
    it('should throw when numeric value is above maximum', async () => {
      mockFindUnique.mockResolvedValue(makeConfig({
        dataType: 'FLOAT',
        minValue: null,
        maxValue: '100.5',
      }));

      await expect(setConfig('test.key', 200, 'user-001'))
        .rejects.toThrow('Config test.key: value 200 above maximum 100.5');
    });

    // 15. Validates numeric value within both min and max passes
    it('should accept numeric value within min/max bounds', async () => {
      mockFindUnique.mockResolvedValue(makeConfig({
        dataType: 'INTEGER',
        minValue: '1',
        maxValue: '100',
      }));
      mockUpdate.mockResolvedValue({});

      await expect(setConfig('test.key', 50, 'user-001')).resolves.toBeUndefined();
      expect(mockUpdate).toHaveBeenCalled();
    });

    // 16. Throws on non-numeric value for numeric data type
    it('should throw when value is not a number for numeric data type', async () => {
      mockFindUnique.mockResolvedValue(makeConfig({ dataType: 'INTEGER' }));

      await expect(setConfig('test.key', 'abc', 'user-001'))
        .rejects.toThrow('Config test.key: expected numeric value');
    });
  });

  // ── Cache management ───────────────────────────────────────────────────

  describe('invalidateConfigCache', () => {
    // 17. Invalidates specific cache entry, forces DB re-query
    it('should force a DB re-query for the invalidated key', async () => {
      mockFindUnique.mockResolvedValue(makeConfig({ value: '10', dataType: 'INTEGER' }));

      await getConfig('test.key');
      expect(mockFindUnique).toHaveBeenCalledTimes(1);

      invalidateConfigCache('test.key');

      await getConfig('test.key');
      expect(mockFindUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearConfigCache', () => {
    // 18. Clears all cache entries, forces DB re-query for all keys
    it('should force DB re-query for all keys after clearing cache', async () => {
      mockFindUnique
        .mockResolvedValueOnce(makeConfig({ key: 'key.a', value: '1', dataType: 'INTEGER' }))
        .mockResolvedValueOnce(makeConfig({ key: 'key.b', value: '2', dataType: 'INTEGER' }));

      await getConfig('key.a');
      await getConfig('key.b');
      expect(mockFindUnique).toHaveBeenCalledTimes(2);

      clearConfigCache();

      mockFindUnique
        .mockResolvedValueOnce(makeConfig({ key: 'key.a', value: '1', dataType: 'INTEGER' }))
        .mockResolvedValueOnce(makeConfig({ key: 'key.b', value: '2', dataType: 'INTEGER' }));

      await getConfig('key.a');
      await getConfig('key.b');
      expect(mockFindUnique).toHaveBeenCalledTimes(4);
    });
  });

  // ── Cache TTL expiry ───────────────────────────────────────────────────

  describe('cache TTL expiry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // 19 (bonus). Cache expires after 10 seconds, forcing DB re-query
    it('should re-query DB after cache TTL (10s) expires', async () => {
      mockFindUnique.mockResolvedValue(makeConfig({ value: '77', dataType: 'INTEGER' }));

      await getConfig('ttl.key');
      expect(mockFindUnique).toHaveBeenCalledTimes(1);

      // Still cached at 9.9 seconds
      vi.advanceTimersByTime(9_900);
      await getConfig('ttl.key');
      expect(mockFindUnique).toHaveBeenCalledTimes(1);

      // Expired after 10+ seconds
      vi.advanceTimersByTime(200);
      await getConfig('ttl.key');
      expect(mockFindUnique).toHaveBeenCalledTimes(2);
    });
  });
});
