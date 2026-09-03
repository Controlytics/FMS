import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AuditDetailModal } from '../audit-detail-modal';

// Mutable so each test can pick the viewing role. `vi.hoisted` because vi.mock
// factories are hoisted above ordinary top-level consts.
const auth = vi.hoisted(() => ({ role: 'ADMIN' as string }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'tester', role: auth.role } }),
}));

/**
 * The live digilog_db record the operator reported (cbd093e8, USER_UPDATED).
 * `beforeValue` is a fixed 5-key snapshot; `afterValue` is what the caller
 * submitted plus `username`. Only the email actually changed.
 */
const RECORD = {
  id: 'cbd093e8-2271-4467-836d-5cb4bb5b905d',
  timestamp: '2026-09-03T05:05:00.000Z',
  userId: '101010',
  userRole: 'ADMIN',
  action: 'USER_UPDATED',
  targetType: 'user',
  ipAddress: '127.0.0.1',
  checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  beforeValue: {
    role: 'ADMIN', email: 'siva@example.aaii',
    status: 'ENABLED', fullName: 'Siva', department: null,
  },
  afterValue: {
    role: 'ADMIN', email: 'siva@example.aai',
    fullName: 'Siva', username: '101020', department: '',
  },
};

function renderModal(record: any = RECORD) {
  return render(
    <AuditDetailModal
      selectedRecord={record}
      onClose={() => {}}
      formatDateTime={(v: string) => `fmt:${v}`}
      getAuditSummary={() => 'User "101020" updated by 101010'}
      getAuditStatus={() => 'Success'}
      templates={{}}
      ACTION_COLORS={{}}
      ROLE_COLORS={{}}
    />,
  );
}

describe('AuditDetailModal', () => {
  beforeEach(() => { auth.role = 'ADMIN'; });

  it('shows the changed value, old → new', () => {
    renderModal();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('siva@example.aaii')).toBeInTheDocument();
    expect(screen.getByText('siva@example.aai')).toBeInTheDocument();
  });

  it('does NOT invent changes from one-sided or blank-equivalent keys', () => {
    // Pre-2026-09-03 this rendered "Status ENABLED → -", "Username - → 101020"
    // and "Department null → ''" — three claims the record does not make.
    //
    // Scoped to the Changes panel on purpose. An unscoped query would pass for a
    // non-SUPER_ADMIN simply because the Record details block (which carries its
    // own "Status" label) is hidden, so it would keep passing if the diff
    // regressed. Asserted as SUPER_ADMIN — the role that sees BOTH — so the
    // assertion is about the change list and nothing else.
    auth.role = 'SUPER_ADMIN';
    renderModal();
    const panel = screen.getByTestId('audit-changes');
    expect(within(panel).getByText('Email')).toBeInTheDocument();
    expect(within(panel).queryByText('Status')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Username')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Department')).not.toBeInTheDocument();
    expect(within(panel).queryByText('101020')).not.toBeInTheDocument();
  });

  it('shows no fabricated rows to a non-SUPER_ADMIN either', () => {
    renderModal();
    const panel = screen.getByTestId('audit-changes');
    expect(within(panel).queryByText('Status')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Username')).not.toBeInTheDocument();
    // …and nothing outside the panel leaks the metadata back in.
    expect(screen.queryByText('101020')).not.toBeInTheDocument();
  });

  describe('for a non-SUPER_ADMIN', () => {
    it('hides Full record and Record details entirely', () => {
      renderModal();
      expect(screen.queryByText(/Full record/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Record details/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Integrity Checksum/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/IP Address/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Record ID/i)).not.toBeInTheDocument();
    });

    it('still shows what happened and when', () => {
      // Stripping the metadata must not strip the record's identity as an event.
      renderModal();
      expect(screen.getByText('User "101020" updated by 101010')).toBeInTheDocument();
      expect(screen.getByText(`fmt:${RECORD.timestamp}`)).toBeInTheDocument();
    });

    it('does not point at a full record it cannot see', () => {
      // A no-op save: every shared key is identical, so there is no change to show.
      auth.role = 'ADMIN';
      renderModal({ ...RECORD, afterValue: { ...RECORD.beforeValue, username: '101020' } });
      expect(screen.getByText('No field changed value in this record.')).toBeInTheDocument();
      expect(screen.queryByText(/see the full record below/i)).not.toBeInTheDocument();
    });
  });

  describe('for SUPER_ADMIN', () => {
    beforeEach(() => { auth.role = 'SUPER_ADMIN'; });

    it('keeps Full record and Record details', () => {
      renderModal();
      expect(screen.getByText(/Full record/i)).toBeInTheDocument();
      expect(screen.getByText(/Record details/i)).toBeInTheDocument();
    });

    it('keeps the integrity checksum — no other screen renders one', () => {
      renderModal();
      expect(screen.getByText(/Integrity Checksum/i)).toBeInTheDocument();
      expect(screen.getByText(RECORD.checksum)).toBeInTheDocument();
    });

    it('sees the one-sided keys in the full record even though they are not changes', () => {
      renderModal();
      // `username` is excluded from the change list but is still part of the
      // stored payload, so it must remain visible where the payload is shown.
      expect(screen.getByText('101020')).toBeInTheDocument();
    });
  });
});
