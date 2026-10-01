import { describe, it, expect } from 'vitest';
import { extractRefusal } from '../refusal-log.js';

describe('extractRefusal — the WHY on a refused request\'s log line', () => {
  it('reads the code and message of an AppError response', () => {
    const body = JSON.stringify({
      error: 'PM_PREVIOUS_TASK_PENDING',
      message: 'An earlier scheduled PM for "AHU-90" was not carried out.',
      details: { pendingPmTasks: [{ entryId: 'x' }] },
    });
    expect(extractRefusal(body)).toEqual({
      errorCode: 'PM_PREVIOUS_TASK_PENDING',
      errorMessage: 'An earlier scheduled PM for "AHU-90" was not carried out.',
    });
  });

  it('never carries `details` — the line must stay one line', () => {
    const r = extractRefusal(JSON.stringify({ error: 'X', message: 'm', details: { secret: 'no' } }));
    expect(JSON.stringify(r)).not.toContain('secret');
  });

  it('works for the gates that answer directly (rbac / reauth shape)', () => {
    expect(extractRefusal(JSON.stringify({ error: 'FORBIDDEN', message: 'Insufficient permissions', requiredPermission: 'FILTER_OPERATE' })))
      .toEqual({ errorCode: 'FORBIDDEN', errorMessage: 'Insufficient permissions' });
    expect(extractRefusal(JSON.stringify({ error: 'REAUTH_REQUIRED' }))).toEqual({ errorCode: 'REAUTH_REQUIRED' });
  });

  it('truncates a long message', () => {
    const r = extractRefusal(JSON.stringify({ error: 'VALIDATION_ERROR', message: 'x'.repeat(1000) }));
    expect(r?.errorMessage?.length).toBeLessThanOrEqual(241);
    expect(r?.errorMessage?.endsWith('…')).toBe(true);
  });

  it('returns null — never throws — for anything it cannot read', () => {
    expect(extractRefusal(undefined)).toBeNull();
    expect(extractRefusal(null)).toBeNull();
    expect(extractRefusal(Buffer.from('{}'))).toBeNull();
    expect(extractRefusal('')).toBeNull();
    expect(extractRefusal('<!doctype html><html></html>')).toBeNull();
    expect(extractRefusal('{not json')).toBeNull();
    expect(extractRefusal('{}')).toBeNull();
    expect(extractRefusal(JSON.stringify({ error: 42, message: null }))).toBeNull();
  });
});
