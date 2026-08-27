import { describe, it, expect } from 'vitest';
import { auditVisibilityScope, SUPER_ADMIN_ONLY_AUDIT_ACTIONS } from '../audit-visibility.js';
import { AUDIT_ACTIONS } from '@digilog/shared';

/**
 * The operator's requirement (2026-08-27): audit rows produced by
 * Config → Filter Data Management, and by audit-record management itself, are
 * visible to SUPER_ADMIN only.
 *
 * Before this scope existed the restriction was incidental — those rows happen
 * to be written by a SUPER_ADMIN, and the reads happened to exclude
 * SUPER_ADMIN-authored rows. That holds only while the console stays
 * SUPER_ADMIN-only; its config card is delegable, so the guarantee needed to be
 * a property of the RECORD, not of whoever clicked the button.
 */
describe('auditVisibilityScope', () => {
  it('does not filter anything for SUPER_ADMIN', () => {
    expect(auditVisibilityScope('SUPER_ADMIN')).toBeNull();
  });

  it.each(['ADMIN', 'MANAGER', 'QA', 'SUPERVISOR', 'SHIFTOFFICER', 'OPERATOR', 'VIEWER', undefined])(
    'restricts %s on BOTH the actor rule and the action rule',
    (role) => {
      const scope = auditVisibilityScope(role as string | undefined);
      expect(scope).not.toBeNull();
      const clauses = (scope as any).AND;
      expect(clauses).toHaveLength(2);

      // Rule 1 — no SUPER_ADMIN-authored rows, but system rows (null role) pass.
      expect(clauses[0]).toEqual({
        OR: [{ userRole: { not: 'SUPER_ADMIN' } }, { userRole: null }],
      });

      // Rule 2 — no super-admin-console actions, whoever wrote them.
      expect(clauses[1].action.notIn).toEqual([...SUPER_ADMIN_ONLY_AUDIT_ACTIONS]);
    },
  );

  it('restricts every manual-record and audit-record-management action', () => {
    // Guards the case where someone adds a MANUAL_RECORD_* / AUDIT_RECORD_*
    // action to the shared registry and forgets this list, silently publishing
    // a new class of super-admin-console row to every role holding AUDIT_READ.
    const shouldBeRestricted = Object.keys(AUDIT_ACTIONS).filter(
      (a) => a.startsWith('MANUAL_RECORD_') || a.startsWith('AUDIT_RECORD'),
    );
    expect(shouldBeRestricted.length).toBeGreaterThan(0);
    for (const action of shouldBeRestricted) {
      expect(SUPER_ADMIN_ONLY_AUDIT_ACTIONS).toContain(action);
    }
  });

  it('leaves the operational retire/replace records readable', () => {
    // These drive the Retirement and Replacement lists that operators are meant
    // to read. Restricting them would blank those pages for every non-owner.
    // The MANUAL_RECORD_CREATED marker written alongside a manual entry carries
    // the "a human keyed this in" fact, and that marker IS restricted.
    expect(SUPER_ADMIN_ONLY_AUDIT_ACTIONS).not.toContain('FILTER_RETIRED');
    expect(SUPER_ADMIN_ONLY_AUDIT_ACTIONS).not.toContain('FILTER_REPLACED');
  });
});
