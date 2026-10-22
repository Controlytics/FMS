import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserBulkDeleteDialog } from '../user-bulk-delete-dialog';

/**
 * The bulk-delete confirm dialog's own contract. (Its dead "Deleting..." state
 * was removed 2026-10-22: the Users list closes this dialog as the delete
 * starts and never set the `bulkDeleting` prop.)
 */

const users = [
  { id: 'u1', username: 'jdoe', fullName: 'Jane Doe' },
  { id: 'u2', username: 'rk', fullName: 'Ravi Kumar' },
];

describe('UserBulkDeleteDialog — confirm button', () => {
  it('singular label for one user, only the selected users are listed, and confirm fires once', () => {
    const onConfirm = vi.fn();
    render(<UserBulkDeleteDialog open selectedIds={new Set(['u1'])} displayedUsers={users} onClose={() => {}} onConfirm={onConfirm} />);
    expect(screen.getAllByText('Delete 1 User')).toHaveLength(2); // title + button
    expect(screen.getByText('@jdoe')).toBeInTheDocument();
    expect(screen.queryByText('@rk')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 User' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('plural label for several users; Cancel calls onClose, not onConfirm', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<UserBulkDeleteDialog open selectedIds={new Set(['u1', 'u2'])} displayedUsers={users} onClose={onClose} onConfirm={onConfirm} />);
    expect(screen.getByRole('button', { name: 'Delete 2 Users' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
