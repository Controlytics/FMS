import { describe, it, expect } from 'vitest';
import { describeRequestSubject, subjectFields } from '../admin-request.service.js';

/**
 * The audit name must describe the SUBJECT of the request, not the requester.
 *
 * Operator report 2026-09-02: a request BY 101010 (ADMIN) to create user 101021
 * as SUPERVISOR was recorded as `"Create User — Admin User (101010)"`. Both the
 * account being created and the role being asked for were absent — the two
 * facts an inspector most needs — while the requester appeared twice.
 */
describe('describeRequestSubject', () => {
  it('1. CREATE_USER names the NEW user id, their name and the REQUESTED role', () => {
    expect(describeRequestSubject('CREATE_USER', {
      username: '101021', fullName: 'Siva', requestedRole: 'SUPERVISOR',
    })).toBe('101021 (Siva), role SUPERVISOR');
  });

  it('2. CREATE_USER never falls back to the requester when fields are missing', () => {
    expect(describeRequestSubject('CREATE_USER', { username: '101021' })).toBe('101021');
    expect(describeRequestSubject('CREATE_USER', {})).toBe('(no user ID)');
  });

  it('3. MODIFY_USER names the target plus what is being changed', () => {
    expect(describeRequestSubject('MODIFY_USER', {
      username: '101020', modifyField: 'role', newValue: 'SUPERVISOR',
    })).toBe('101020, role -> SUPERVISOR');
  });

  it('3b. MODIFY_USER names the previous role when the request carries it', () => {
    expect(describeRequestSubject('MODIFY_USER', {
      username: '101020', modifyField: 'role', currentRole: 'OPERATOR', newValue: 'SUPERVISOR',
    })).toBe('101020, role OPERATOR -> SUPERVISOR');
  });

  it('4. account-state requests name the account being acted on', () => {
    for (const t of ['UNLOCK', 'ENABLE_ACCOUNT', 'DISABLE_ACCOUNT', 'FORGOT_PASSWORD']) {
      expect(describeRequestSubject(t, { username: '101020' })).toBe('101020');
    }
  });

  it('5. subjectFields exposes the target structurally, so it can be filtered on', () => {
    expect(subjectFields('CREATE_USER', { username: '101021', fullName: 'Siva', requestedRole: 'SUPERVISOR' }))
      .toEqual({ targetUsername: '101021', targetFullName: 'Siva', requestedRole: 'SUPERVISOR' });
    expect(subjectFields('UNLOCK', { username: '101020' })).toEqual({ targetUsername: '101020' });
  });

  it('6. a blank/absent username is labelled, never silently empty', () => {
    expect(describeRequestSubject('UNLOCK', { username: '   ' })).toBe('(no user ID)');
    expect(subjectFields('UNLOCK', {}).targetUsername).toBeNull();
  });
});
