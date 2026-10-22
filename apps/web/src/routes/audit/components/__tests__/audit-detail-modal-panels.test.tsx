import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup, within, waitFor } from '@testing-library/react';
import { getDefaultTemplates } from '@digilog/shared';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { AuditDetailModal } from '../audit-detail-modal';
import { ACTION_COLORS, getAuditStatus, getAuditSummary } from '../../audit-helpers';

/**
 * The panels of the audit record dialog that the M71 / 2026-09-03 tests do not
 * reach: redaction banner, replacement pair, reason, the honest empty states,
 * and the SUPER_ADMIN-only full record / record details. Rendered under the
 * page harness so the viewer's role comes from the real useAuth (/api/auth/me).
 */

afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); });

const UUID_OLD = '11111111-2222-4333-8444-555555555555';
const UUID_NEW = '66666666-7777-4888-9999-aaaaaaaaaaaa';

const BASE = {
  id: 'r1', timestamp: '2026-10-20T08:30:00.000Z', userId: '101010', userRole: 'ADMIN',
  action: 'USER_UPDATED', targetType: 'user', ipAddress: '10.0.0.5', checksum: 'deadbeef',
};

function show(record: any, role: string) {
  const api = mockApi();
  renderPage(
    <AuditDetailModal
      selectedRecord={record}
      onClose={() => {}}
      formatDateTime={(v: string) => `at:${v}`}
      getAuditSummary={getAuditSummary}
      getAuditStatus={getAuditStatus}
      templates={getDefaultTemplates()}
      ACTION_COLORS={ACTION_COLORS}
      ROLE_COLORS={{ ADMIN: 'bg-blue-600 text-white' }}
    />,
    { user: { role, permissions: ['AUDIT_READ'] }, api },
  );
  return api;
}

/** Wait until /api/auth/me has answered, so SUPER_ADMIN-gated blocks are settled. */
async function settled(api: ReturnType<typeof mockApi>) {
  await waitFor(() => expect(api.calls('GET', '/api/auth/me').length).toBeGreaterThan(0));
  await screen.findByText('Audit Record Detail');
}

describe('AuditDetailModal — redaction, reason, replacement', () => {
  it('a redacted record shows who masked it, when and why, and says it has no field values', async () => {
    const api = show({
      ...BASE, action: 'FILTER_CREATED', beforeValue: null, afterValue: null,
      redactedAt: '2026-10-19T00:00:00.000Z', redactedBy: 'u-77', redactionReason: null,
    }, 'QA');
    await settled(api);
    expect(screen.getByText("This record's payload was redacted")).toBeInTheDocument();
    // redactedByName missing -> raw id; reason missing -> explicit fallback
    expect(screen.getByText('u-77')).toBeInTheDocument();
    expect(screen.getByText('at:2026-10-19T00:00:00.000Z')).toBeInTheDocument();
    expect(screen.getByText('no reason recorded')).toBeInTheDocument();
    expect(screen.getByText('This action records no field-level values.')).toBeInTheDocument();
  });

  it('shows the operator reason and a Fail badge for a failed action', async () => {
    const api = show({ ...BASE, action: 'LOGIN_FAILED', reason: 'Wrong password x3', beforeValue: null, afterValue: null }, 'QA');
    await settled(api);
    expect(screen.getByText('Reason')).toBeInTheDocument();
    expect(screen.getByText('Wrong password x3')).toBeInTheDocument();
    expect(screen.getByText('Fail')).toBeInTheDocument();
    expect(screen.queryByText('Success')).toBeNull();
  });

  it('FILTER_REPLACED: names and ids of both filters, and how many RFID tags moved', async () => {
    const api = show({
      ...BASE, action: 'FILTER_REPLACED', targetType: 'asset_instance', targetId: UUID_OLD, beforeValue: null,
      afterValue: { oldFilterName: 'FLT-0001', newFilterName: 'FLT-0101', oldFilterId: UUID_OLD, newFilterId: UUID_NEW, identifiersMoved: 2 },
    }, 'QA');
    await settled(api);
    expect(screen.getByText('Replacement')).toBeInTheDocument();
    const oldSide = screen.getByText('Replaced (old)').parentElement as HTMLElement;
    expect(within(oldSide).getByText('FLT-0001')).toBeInTheDocument();
    expect(within(oldSide).getByText(UUID_OLD)).toBeInTheDocument();
    const newSide = screen.getByText('Replacement (new)').parentElement as HTMLElement;
    expect(within(newSide).getByText('FLT-0101')).toBeInTheDocument();
    expect(within(newSide).getByText(UUID_NEW)).toBeInTheDocument();
    expect(screen.getByText(/RFID identifiers moved to the new filter:/)).toHaveTextContent('2');
  });

  it('FILTER_REPLACED from an older row: old id falls back to targetId, missing names read "—", no tag count line', async () => {
    const api = show({ ...BASE, action: 'FILTER_REPLACED', targetId: UUID_OLD, beforeValue: null, afterValue: {} }, 'QA');
    await settled(api);
    const oldSide = screen.getByText('Replaced (old)').parentElement as HTMLElement;
    expect(within(oldSide).getByText(UUID_OLD)).toBeInTheDocument();
    const newSide = screen.getByText('Replacement (new)').parentElement as HTMLElement;
    expect(within(newSide).getAllByText('—')).toHaveLength(2); // no name, no id
    expect(screen.queryByText(/RFID identifiers moved/)).toBeNull();
  });

  it('FILTER_REPLACED with no filter id anywhere renders no replacement panel at all', async () => {
    const api = show({ ...BASE, action: 'FILTER_REPLACED', targetId: null, beforeValue: null, afterValue: null }, 'QA');
    await settled(api);
    expect(screen.queryByText('Replacement')).toBeNull();
  });

  it('a field cleared to empty reads "(empty)", not a blank', async () => {
    const api = show({ ...BASE, beforeValue: { department: 'QA Lab' }, afterValue: { department: '' } }, 'QA');
    await settled(api);
    const panel = screen.getByTestId('audit-changes');
    expect(within(panel).getByText('QA Lab')).toHaveClass('line-through');
    expect(within(panel).getByText('(empty)')).toBeInTheDocument();
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });
});

describe('AuditDetailModal — full record + record details are SUPER_ADMIN only', () => {
  const NO_CHANGE = {
    ...BASE,
    // equal values -> no change; uuid-valued and *Id keys are pruned from the full record
    beforeValue: { status: 'ENABLED', ownerId: 'plain-text-id', ref: UUID_OLD },
    afterValue: { status: 'ENABLED' },
  };

  it('a non-SUPER_ADMIN is told nothing changed, without a pointer to a panel they cannot see', async () => {
    const api = show(NO_CHANGE, 'QA');
    await settled(api);
    expect(screen.getByText('No field changed value in this record.')).toBeInTheDocument();
    expect(screen.queryByText('Full record (previous / new)')).toBeNull();
    expect(screen.queryByText('Record details')).toBeNull();
  });

  it('D4: the full record hides id keys (id, *_id, camelCase *Id) and uuid values, and keeps other keys', async () => {
    const api = show({
      ...BASE,
      beforeValue: {
        id: 'row-7', ownerId: 'plain-text-id', user_id: 'snake-id', ref: UUID_OLD,
        paid: 'yes-paid', status: 'ENABLED', idleMinutes: 15,
      },
      afterValue: { status: 'ENABLED' },
    }, 'SUPER_ADMIN');
    await settled(api);
    const full = (await screen.findByText('Full record (previous / new)')).closest('details') as HTMLDetailsElement;
    // id keys with string values are hidden, whatever their casing style
    expect(within(full).queryByText('row-7')).toBeNull();
    expect(within(full).queryByText('plain-text-id')).toBeNull();
    expect(within(full).queryByText('snake-id')).toBeNull();
    // a uuid value is hidden under any key
    expect(within(full).queryByText(UUID_OLD)).toBeNull();
    // keys that merely END in "id" letters, or start with "id", are not id keys
    expect(within(full).getByText('yes-paid')).toBeInTheDocument();
    expect(within(full).getByText('15')).toBeInTheDocument();
    expect(within(full).getAllByText('ENABLED').length).toBeGreaterThan(0);
  });

  it('SUPER_ADMIN: no changes -> pointed at the full record, opened by default, with ids pruned', async () => {
    const api = show(NO_CHANGE, 'SUPER_ADMIN');
    await settled(api);
    expect(await screen.findByText('No field changed value — see the full record below.')).toBeInTheDocument();
    const full = screen.getByText('Full record (previous / new)').closest('details') as HTMLDetailsElement;
    expect(full.open).toBe(true);
    expect(within(full).getAllByText('ENABLED')).toHaveLength(2);
    expect(within(full).queryByText(UUID_OLD)).toBeNull();
  });

  it('SUPER_ADMIN: with a change the full record starts collapsed; a one-sided payload shows "—" for the empty side', async () => {
    const api = show({ ...BASE, beforeValue: { email: 'a@x.io' }, afterValue: { email: 'b@x.io' } }, 'SUPER_ADMIN');
    await settled(api);
    const full = (await screen.findByText('Full record (previous / new)')).closest('details') as HTMLDetailsElement;
    expect(full.open).toBe(false);
    cleanup();

    const api2 = show({ ...BASE, action: 'FILTER_CREATED', beforeValue: null, afterValue: { name: 'FLT-9' } }, 'SUPER_ADMIN');
    await settled(api2);
    const full2 = (await screen.findByText('Full record (previous / new)')).closest('details') as HTMLDetailsElement;
    const prev = within(full2).getByText('Previous Value').parentElement as HTMLElement;
    expect(within(prev).getByText('—')).toBeInTheDocument();
    cleanup();

    const api3 = show({ ...BASE, action: 'FILTER_DELETED', beforeValue: { name: 'FLT-9' }, afterValue: null }, 'SUPER_ADMIN');
    await settled(api3);
    const full3 = (await screen.findByText('Full record (previous / new)')).closest('details') as HTMLDetailsElement;
    const next = within(full3).getByText('New Value').parentElement as HTMLElement;
    expect(within(next).getByText('—')).toBeInTheDocument();
  });

  it('SUPER_ADMIN record details: id, performer, role colour, IP, target type, checksum; fallbacks for unknown values', async () => {
    const api = show({ ...BASE, beforeValue: null, afterValue: null }, 'SUPER_ADMIN');
    await settled(api);
    const details = (await screen.findByText('Record details')).closest('details') as HTMLElement;
    expect(within(details).getByText('#r1')).toBeInTheDocument();
    expect(within(details).getByText('10.0.0.5')).toBeInTheDocument();
    expect(within(details).getByText('deadbeef')).toBeInTheDocument();
    expect(within(details).getByText('ADMIN')).toHaveClass('bg-blue-600');
    expect(within(details).getByText('USER_UPDATED')).toHaveClass(...ACTION_COLORS.USER_UPDATED.split(' '));
    cleanup();

    const api2 = show({ ...BASE, action: 'LOGIN_FAILED', userRole: 'GUEST', ipAddress: null, targetType: null, beforeValue: null, afterValue: null }, 'SUPER_ADMIN');
    await settled(api2);
    const d2 = (await screen.findByText('Record details')).closest('details') as HTMLElement;
    expect(within(d2).getByText('GUEST')).toHaveClass('bg-slate-100');
    expect(within(d2).getAllByText('-')).toHaveLength(2); // IP + target type
    expect(within(d2).getAllByText('Fail').length).toBeGreaterThan(0);
  });

  it('an action with no colour entry falls back to the neutral badge', async () => {
    const api = show({ ...BASE, action: 'SOMETHING_NEW', beforeValue: null, afterValue: null }, 'SUPER_ADMIN');
    await settled(api);
    const details = (await screen.findByText('Record details')).closest('details') as HTMLElement;
    expect(within(details).getByText('SOMETHING_NEW')).toHaveClass('bg-slate-100');
  });
});
