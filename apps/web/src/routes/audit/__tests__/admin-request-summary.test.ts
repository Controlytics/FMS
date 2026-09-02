import { describe, it, expect } from 'vitest';
import { getAuditSummary } from '../audit-helpers';
import { AUDIT_TEMPLATE_DEFAULTS } from '@digilog/shared';

/**
 * Admin-request audit attribution (2026-09-02).
 *
 * The submitted/approved rows showed the requester only inside a quoted name and
 * never their ROLE — the submit path did not pass `userRole` at all, so
 * `audit_trail.user_role` was blank on every submission. These lock the new
 * wording AND the degradation path: rows written before the change carry a
 * requesterEmployeeId but no requesterRole, and must still read correctly rather
 * than trailing an empty "()".
 */
const templates = Object.fromEntries(
  Object.entries(AUDIT_TEMPLATE_DEFAULTS).map(([k, v]: [string, any]) => [k, v.template]),
) as Record<string, string>;

const row = (over: Record<string, any> = {}) => ({
  userId: '101010',
  userRole: 'ADMIN',
  targetType: 'admin_request',
  targetId: 'req-1',
  afterValue: {
    name: 'Create User: 101021 (Siva), role SUPERVISOR',
    operation: 'Create User',
    requesterName: 'Admin User',
    requesterEmployeeId: '101010',
    requesterRole: 'ADMIN',
  },
  ...over,
});

describe('audit summary — admin requests', () => {
  it('1. SUBMITTED names the requester id AND role', () => {
    const s = getAuditSummary({ ...row(), action: 'ADMIN_REQUEST_SUBMITTED' }, templates);
    expect(s).toBe('Admin request submitted — "Create User: 101021 (Siva), role SUPERVISOR" requested by 101010 (ADMIN)');
  });

  it('2. APPROVED names requester and approver, each with a role', () => {
    const s = getAuditSummary({ ...row(), action: 'ADMIN_REQUEST_APPROVED', userId: '900001', userRole: 'SUPER_ADMIN' }, templates);
    expect(s).toBe(
      'Admin request approved — "Create User: 101021 (Siva), role SUPERVISOR" requested by 101010 (ADMIN), approved by 900001 (SUPER_ADMIN)');
  });

  it('3. REJECTED names the reason it was refused, not just that it was', () => {
    const s = getAuditSummary({
      ...row({ afterValue: { ...row().afterValue, adminRemarks: 'Role not approved by dept head' } }),
      action: 'ADMIN_REQUEST_REJECTED',
    }, templates);
    expect(s).toContain('rejected by 101010 (ADMIN)');
    expect(s).toContain('reason: Role not approved by dept head');
  });

  it('3b. a rejection with no remark stored renders no dangling clause', () => {
    const s = getAuditSummary({ ...row(), action: 'ADMIN_REQUEST_REJECTED' }, templates);
    expect(s.endsWith('rejected by 101010 (ADMIN)')).toBe(true);
    expect(s).not.toContain('reason:');
  });

  it('4. a no-op approval says so, and only then', () => {
    const noop = getAuditSummary({
      ...row({ afterValue: { ...row().afterValue, actionTaken: false, outcome: 'No action taken — account "101011" is not locked (current status: ENABLED).' } }),
      action: 'ADMIN_REQUEST_APPROVED',
    }, templates);
    expect(noop).toContain('— No action taken — account "101011" is not locked (current status: ENABLED).');

    const acted = getAuditSummary({
      ...row({ afterValue: { ...row().afterValue, actionTaken: true, outcome: 'Account "101011" unlocked.' } }),
      action: 'ADMIN_REQUEST_APPROVED',
    }, templates);
    expect(acted).not.toContain('No action taken');
    expect(acted.endsWith('(ADMIN)')).toBe(true);
  });

  it('5. a PRE-CHANGE row (no requesterRole stored) degrades to the id, with no empty parens', () => {
    const legacy = getAuditSummary({
      ...row({ afterValue: { name: 'Unlock Account — Admin User (101010)', requesterEmployeeId: '101010' } }),
      action: 'ADMIN_REQUEST_SUBMITTED',
    }, templates);
    expect(legacy).toBe('Admin request submitted — "Unlock Account — Admin User (101010)" requested by 101010');
    expect(legacy).not.toContain('()');
  });

  it('6. no placeholder is ever left unsubstituted', () => {
    for (const action of ['ADMIN_REQUEST_SUBMITTED', 'ADMIN_REQUEST_APPROVED', 'ADMIN_REQUEST_REJECTED']) {
      // worst case: a row carrying none of the new fields at all
      const bare = getAuditSummary(
        { action, userId: '', userRole: '', targetType: 'admin_request', afterValue: {} }, templates);
      expect(bare).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });
});
