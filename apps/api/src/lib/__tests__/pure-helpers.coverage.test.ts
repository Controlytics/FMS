/**
 * Coverage for the small pure helpers in lib/ that had no test of their own:
 * change-reason, spreadsheet-safe, filter-details (flatten), request-store,
 * and the synchronous half of format-datetime. No database, no mocks — each
 * assertion is the value a caller receives.
 */
import { describe, it, expect } from 'vitest';
import { requireChangeReason, MIN_CHANGE_REASON, MAX_CHANGE_REASON, changeReasonSchemaProp } from '../change-reason.js';
import { AppError } from '../errors.js';
import { neutralizeFormula, neutralizeRow } from '../spreadsheet-safe.js';
import { flattenFilterFields, flattenFilterFieldsAll } from '../filter-details.js';
import { runWithRequestStore, getRequestStore } from '../request-store.js';
import { formatDateWith, formatDateTimeWith } from '../format-datetime.js';

function thrown(fn: () => unknown): AppError {
  try { fn(); } catch (e) { return e as AppError; }
  throw new Error('expected a throw');
}

describe('requireChangeReason', () => {
  it('returns the trimmed reason when it is long enough', () => {
    expect(requireChangeReason({ reason: '   granted for audit   ' })).toBe('granted for audit');
  });

  it('accepts exactly the minimum and exactly the maximum length', () => {
    expect(requireChangeReason({ reason: 'x'.repeat(MIN_CHANGE_REASON) })).toHaveLength(MIN_CHANGE_REASON);
    expect(requireChangeReason({ reason: 'y'.repeat(MAX_CHANGE_REASON) })).toHaveLength(MAX_CHANGE_REASON);
  });

  it.each([
    ['a missing body', null],
    ['a body without reason', {}],
    ['a non-string reason', { reason: 12345 }],
    ['a reason one char short after trimming', { reason: `  ${'z'.repeat(MIN_CHANGE_REASON - 1)}  ` }],
  ])('refuses %s with 400 REASON_REQUIRED', (_label, body) => {
    const err = thrown(() => requireChangeReason(body));
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('REASON_REQUIRED');
    expect(err.message).toContain(`at least ${MIN_CHANGE_REASON} characters`);
  });

  it('refuses a reason over the maximum with 400 REASON_TOO_LONG', () => {
    const err = thrown(() => requireChangeReason({ reason: 'r'.repeat(MAX_CHANGE_REASON + 1) }));
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('REASON_TOO_LONG');
  });

  it('publishes the same bound in the schema fragment routes embed', () => {
    expect(changeReasonSchemaProp.reason.maxLength).toBe(MAX_CHANGE_REASON);
    expect(changeReasonSchemaProp.reason.description).toContain(String(MIN_CHANGE_REASON));
  });
});

describe('neutralizeFormula / neutralizeRow (CSV injection)', () => {
  it.each(['=cmd|"/c calc"!A1', '+1+1', '-2', '@SUM(A1)', '\tTAB', '\rCR'])('prefixes a quote to %j', (v) => {
    expect(neutralizeFormula(v)).toBe(`'${v}`);
  });

  it('leaves ordinary text, empty strings and non-strings untouched', () => {
    expect(neutralizeFormula('AHU-01')).toBe('AHU-01');
    expect(neutralizeFormula('a=b')).toBe('a=b');
    expect(neutralizeFormula('')).toBe('');
    expect(neutralizeFormula(-5)).toBe(-5);
    const d = new Date(0);
    expect(neutralizeFormula(d)).toBe(d);
    expect(neutralizeFormula(null)).toBeNull();
  });

  it('maps every string value of a row and keeps the other types', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(neutralizeRow({ name: '=HYPERLINK("x")', qty: 3, when: d, remark: 'ok', flag: true }))
      .toEqual({ name: `'=HYPERLINK("x")`, qty: 3, when: d, remark: 'ok', flag: true });
  });
});

describe('flattenFilterFields', () => {
  it('lifts the four sidecar fields onto the instance and drops the nested object', () => {
    const out = flattenFilterFields({
      id: 'f1', name: 'F1',
      filterDetails: { filterProfileId: 'p1', currentLifecycleState: 'WASH_IN', currentCycleId: 'c1', filterSet: 'SET_B' },
    });
    expect(out).toEqual({ id: 'f1', name: 'F1', filterProfileId: 'p1', currentLifecycleState: 'WASH_IN', currentCycleId: 'c1', filterSet: 'SET_B' });
    expect('filterDetails' in out).toBe(false);
  });

  it('gives nulls for a row with no sidecar (null, undefined, or empty fields)', () => {
    const nulls = { filterProfileId: null, currentLifecycleState: null, currentCycleId: null, filterSet: null };
    expect(flattenFilterFields({ id: 'a', filterDetails: null })).toEqual({ id: 'a', ...nulls });
    expect(flattenFilterFields({ id: 'b' } as { id: string; filterDetails?: null })).toEqual({ id: 'b', ...nulls });
    expect(flattenFilterFields({ id: 'c', filterDetails: {} })).toEqual({ id: 'c', ...nulls });
  });

  it('is idempotent and has an array form', () => {
    const once = flattenFilterFields({ id: 'x', filterDetails: { filterSet: 'SET_A' } });
    expect(flattenFilterFields(once as any)).toEqual({ ...once, filterSet: null });
    const all = flattenFilterFieldsAll([{ id: '1', filterDetails: { currentCycleId: 'c' } }, { id: '2', filterDetails: null }]);
    expect(all.map((r) => r.currentCycleId)).toEqual(['c', null]);
  });
});

describe('request-store', () => {
  it('is undefined outside a request and carries the store inside one, across awaits', async () => {
    expect(getRequestStore()).toBeUndefined();
    const store: { reauthAuditId?: string } = {};
    const seen = await runWithRequestStore(store, async () => {
      await new Promise((r) => setTimeout(r, 1));
      getRequestStore()!.reauthAuditId = 'sig-1';
      await Promise.resolve();
      return getRequestStore();
    });
    expect(seen).toBe(store);
    expect(store.reauthAuditId).toBe('sig-1');
    expect(getRequestStore()).toBeUndefined();
  });

  it('keeps concurrent requests apart', async () => {
    const a = runWithRequestStore({ reauthAuditId: 'A' }, async () => { await new Promise((r) => setTimeout(r, 5)); return getRequestStore()?.reauthAuditId; });
    const b = runWithRequestStore({ reauthAuditId: 'B' }, async () => getRequestStore()?.reauthAuditId);
    expect(await Promise.all([a, b])).toEqual(['A', 'B']);
  });
});

describe('formatDateWith / formatDateTimeWith', () => {
  const IST = { dateFormat: 'DD/MM/YYYY', timeFormat: '12-hour', timezone: 'Asia/Kolkata' };
  const at = new Date('2026-06-15T10:05:00Z'); // 15:35 IST

  it.each([
    ['DD/MM/YYYY', '15/06/2026'],
    ['MM/DD/YYYY', '06/15/2026'],
    ['YYYY-MM-DD', '2026-06-15'],
    ['DD-MMM-YYYY', '15-Jun-2026'],
    ['MMM DD, YYYY', 'Jun 15, 2026'],
    ['SOMETHING-ELSE', '15/06/2026'],
  ])('renders %s', (dateFormat, expected) => {
    expect(formatDateWith({ ...IST, dateFormat }, at)).toBe(expected);
  });

  it('zero-pads a single-digit month and day in MM/DD/YYYY', () => {
    expect(formatDateWith({ ...IST, dateFormat: 'MM/DD/YYYY' }, new Date('2026-03-04T06:00:00Z'))).toBe('03/04/2026');
  });

  it('renders the date in the configured zone, not UTC (day rolls over in IST)', () => {
    expect(formatDateWith(IST, '2026-06-15T20:00:00Z')).toBe('16/06/2026');
    expect(formatDateWith({ ...IST, timezone: 'UTC' }, '2026-06-15T20:00:00Z')).toBe('15/06/2026');
  });

  it('appends a 12-hour or 24-hour time', () => {
    expect(formatDateTimeWith(IST, at)).toMatch(/^15\/06\/2026 03:35\sPM$/);
    expect(formatDateTimeWith({ ...IST, timeFormat: '24-hour' }, at)).toBe('15/06/2026 15:35');
  });

  it('falls back to UTC when the stored timezone is not a real zone', () => {
    const bad = { ...IST, timezone: 'Not/AZone' };
    expect(formatDateWith(bad, at)).toBe('15/06/2026');
    expect(formatDateTimeWith(bad, at)).toMatch(/^15\/06\/2026 10:05\sAM$/);
  });

  it('returns an empty string for null, undefined, empty and unparseable values', () => {
    for (const v of [null, undefined, '', 'not a date']) {
      expect(formatDateWith(IST, v as any)).toBe('');
      expect(formatDateTimeWith(IST, v as any)).toBe('');
    }
  });
});
