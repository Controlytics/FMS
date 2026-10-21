import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA } from '../../__tests__/fm-test-kit';
import { installFakeIndexedDB, openAppDb, cacheRow } from '../../hooks/__tests__/fake-indexeddb';
import { CleaningReasonDialog } from '../cleaning-reason-dialog';

usePageTestLifecycle();

const REASONS = [
  { key: 'PM', name: 'Preventive Maintenance', description: 'Scheduled PM', isActive: true },
  { key: 'BREAKDOWN', name: 'Breakdown', requiresJustification: true },
  { key: 'OLD', name: 'Retired reason', isActive: false },
];
const dialog = { filterId: 'f1', filterName: 'FLT-1', stage: { key: 'WASH_IN', label: 'Wash In' } };

function setup(reasonsBody: unknown = { reasons: REASONS }, props: Partial<React.ComponentProps<typeof CleaningReasonDialog>> = {}) {
  const api = mockApi([{ path: '/api/filters/reasons', body: reasonsBody }, ...baseRoutes()]);
  const handlers = { onClose: vi.fn(), onSubmit: vi.fn(), onClearError: vi.fn() };
  const view = renderPage(
    <CleaningReasonDialog dialog={dialog} loading={false} error="" {...handlers} {...props} />,
    { user: SA, api },
  );
  return { ...handlers, ...view };
}

describe('CleaningReasonDialog', () => {
  it('renders nothing without a dialog', async () => {
    const { container, api } = setup(undefined, { dialog: null });
    await waitFor(() => expect(api.calls('GET', '/api/filters/reasons')).toHaveLength(1));
    expect(container.querySelector('h2')).toBeNull();
  });

  it('lists only active reasons; Submit stays disabled until one is picked', async () => {
    const { onSubmit, onClearError } = setup();
    expect(await screen.findByText('Preventive Maintenance')).toBeInTheDocument();
    expect(screen.getByText('FLT-1 → Wash In')).toBeInTheDocument();
    expect(screen.getByText('Scheduled PM')).toBeInTheDocument();
    expect(screen.queryByText('Retired reason')).toBeNull();
    const submit = screen.getByRole('button', { name: 'Start & Submit' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Preventive Maintenance/ }));
    expect(onClearError).toHaveBeenCalled();
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith('PM', '');
  });

  it('a reason that requires justification blocks Submit until 10+ characters are typed', async () => {
    const { onSubmit } = setup(REASONS); // bare array response shape
    fireEvent.click(await screen.findByRole('button', { name: /Breakdown/ }));
    expect(screen.getByText('Requires justification')).toBeInTheDocument();
    const box = screen.getByPlaceholderText('Justification (min 10 characters)');
    const submit = screen.getByRole('button', { name: 'Start & Submit' });
    fireEvent.change(box, { target: { value: '  short   ' } });
    expect(submit).toBeDisabled();
    fireEvent.change(box, { target: { value: 'Motor seized on AHU-3' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith('BREAKDOWN', 'Motor seized on AHU-3');
  });

  it('PM-due: pre-selects the default reason and shows the PM banner', async () => {
    const { onSubmit } = setup(undefined, { pmDue: true, defaultReasonKey: 'PM' });
    await screen.findByText('Preventive Maintenance');
    expect(screen.getByText(/A non-PM reason will leave this task pending/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start & Submit' }));
    expect(onSubmit).toHaveBeenCalledWith('PM', '');
  });

  it('shows the parent error; loading disables Submit and replaces its label with a spinner', async () => {
    setup(undefined, { error: 'PM_PREVIOUS_TASK_PENDING', loading: true, defaultReasonKey: 'PM' });
    expect(await screen.findByText('PM_PREVIOUS_TASK_PENDING')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start & Submit' })).toBeNull();
    const buttons = screen.getAllByRole('button');
    expect(buttons[buttons.length - 1]).toBeDisabled();
  });

  it('Cancel and a backdrop click close; a click inside the card does not', async () => {
    const { onClose, container } = setup();
    await screen.findByText('Preventive Maintenance');
    fireEvent.click(screen.getByText('Select Cleaning Reason'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('.fixed.inset-0')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('offline (server list empty): falls back to the reasons cached in IndexedDB', async () => {
    const idb = installFakeIndexedDB();
    await openAppDb();
    idb.seed('cache', [cacheRow('cleaning-reasons', [{ key: 'CACHED', name: 'Cached reason' }])]);
    const { onSubmit } = setup([]);
    fireEvent.click(await screen.findByRole('button', { name: /Cached reason/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start & Submit' }));
    expect(onSubmit).toHaveBeenCalledWith('CACHED', '');
  });
});
