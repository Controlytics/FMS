import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { SuccessDialog } from '../success-dialog';
import { useToastState } from '@/hooks/use-toast';

describe('SuccessDialog', () => {
  it('renders the title + message and OK calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(<SuccessDialog item={{ id: 's1', title: 'Saved', message: 'All good' }} onDismiss={onDismiss} />);
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('All good')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onDismiss).toHaveBeenCalledWith('s1');
  });

  it('shows a default message when none is provided', () => {
    render(<SuccessDialog item={{ id: 's2', title: 'Done' }} onDismiss={() => {}} />);
    expect(screen.getByText('Your changes have been saved successfully.')).toBeInTheDocument();
  });

  it('dismisses on Escape', () => {
    const onDismiss = vi.fn();
    render(<SuccessDialog item={{ id: 's3', title: 'X' }} onDismiss={onDismiss} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledWith('s3');
  });
});

describe('useToastState success routing', () => {
  it('toast.success enqueues a success MODAL, not a toast', () => {
    const { result } = renderHook(() => useToastState());
    act(() => result.current.toast.success('Saved', 'msg'));
    expect(result.current.successDialogs).toHaveLength(1);
    expect(result.current.successDialogs[0]).toMatchObject({ title: 'Saved', message: 'msg' });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('toast.successToast and toast.error add non-blocking toasts', () => {
    const { result } = renderHook(() => useToastState());
    act(() => { result.current.toast.successToast('Synced'); result.current.toast.error('Oops'); });
    expect(result.current.toasts).toHaveLength(2);
    expect(result.current.successDialogs).toHaveLength(0);
  });

  it('dismissSuccess removes the acknowledged dialog from the queue', () => {
    const { result } = renderHook(() => useToastState());
    act(() => { result.current.toast.success('One'); result.current.toast.success('Two'); });
    expect(result.current.successDialogs).toHaveLength(2);
    const firstId = result.current.successDialogs[0].id;
    act(() => result.current.dismissSuccess(firstId));
    expect(result.current.successDialogs).toHaveLength(1);
    expect(result.current.successDialogs[0].title).toBe('Two');
  });
});
