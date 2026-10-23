import { describe, it, expect } from 'vitest';
import { auditQuerySchema } from './audit.js';

// GET /api/audit parses req.query with this schema, so every value arrives as a string.
describe('auditQuerySchema', () => {
  it('coerces page and limit from the query string', () => {
    expect(auditQuerySchema.parse({ page: '2', limit: '50', period: 'week' })).toEqual({
      page: 2,
      limit: 50,
      period: 'week',
    });
  });

  it('defaults page to 1 and leaves limit unset', () => {
    const q = auditQuerySchema.parse({ search: 'FILTER_RETIRED' });
    expect(q.page).toBe(1);
    expect(q.limit).toBeUndefined();
    expect(q.search).toBe('FILTER_RETIRED');
  });

  it('refuses page 0, limit 0 and a non-numeric page', () => {
    expect(auditQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ page: 'two' }).success).toBe(false);
  });

  it('accepts only the listed periods', () => {
    for (const period of ['today', 'week', 'month', 'quarter', 'year', 'all']) {
      expect(auditQuerySchema.safeParse({ period }).success).toBe(true);
    }
    expect(auditQuerySchema.safeParse({ period: 'decade' }).success).toBe(false);
  });
});
