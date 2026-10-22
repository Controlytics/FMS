import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserBulkDeleteDialog } from '../user-bulk-delete-dialog';

/**
 * The bulk-delete confirm button's in-flight state. Component contract only:
 * the Users list (list.tsx:47) declares `bulkDeleting` but never sets it, so
 * the page itself never shows this state (reported as dead state).
 */

const users = [
  { id: 'u1', username: 'jdoe', fullName: 'Jane Doe' },
  { id: 'u2', username: 'rk', fullName: 'Ravi Kumar' },
];

describe('UserBulkDeleteDialog — confirm button state', () => {
  it('while deleting: reads "Deleting..." and cannot be pressed again', () => {
    const onConfirm = vi.fn();
    render(<UserBulkDeleteDialog open selectedIds={new Set(['u1'])} displayedUsers={users} bulkDeleting onClose={() => {}} onConfirm={onConfirm} />);
    const btn = screen.getByRole('button', { name: 'Deleting...' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('idle: singular label for one user, and only the selected users are listed', () => {
    const onConfirm = vi.fn();
    render(<UserBulkDeleteDialog open selectedIds={new Set(['u1'])} displayedUsers={users} bulkDeleting={false} onClose={() => {}} onConfirm={onConfirm} />);
    expect(screen.getAllByText('Delete 1 User')).toHaveLength(2); // title + button
    expect(screen.getByText('@jdoe')).toBeInTheDocument();
    expect(screen.queryByText('@rk')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 User' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
