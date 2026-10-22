/**
 * The app-wide notification stack (coverage campaign 2026-10-21):
 * ToastContainer / ToastEntry (non-blocking toasts), ToastProvider (wires the
 * toast API, the FIFO acknowledgement modal and the SWR load-error bridge),
 * useToast, and ErrorPopup. Timers are faked only where a toast's lifetime is
 * asserted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';
import { ToastContainer, type ToastItem } from '@/components/ui/toast';
import { ToastProvider } from '@/components/toast-provider';
import { ErrorPopup } from '@/components/ui/error-popup';
import { MessageDialog } from '@/components/ui/message-dialog';
import { useToast } from '@/hooks/use-toast';
import { swrConfig } from '@/lib/swr-config';
import { expectAllControlsNamed } from './support/a11y';

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const expectQuietConsole = () => {
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
};

const item = (over: Partial<ToastItem> = {}): ToastItem => ({ id: 't1', title: 'Saved', variant: 'success', ...over });

describe('ToastContainer / ToastEntry', () => {
  it('renders nothing with no toasts', () => {
    const { container } = render(<ToastContainer toasts={[]} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expectQuietConsole();
  });

  it.each([
    ['success', '✔', 'border-l-emerald-600'],
    ['error', '✖', 'border-l-red-600'],
    ['warning', '⚠', 'border-l-amber-500'],
    ['info', 'ℹ', 'border-l-brand-600'],
  ] as const)('a %s toast shows its icon, title, message and accent', (variant, icon, accent) => {
    render(<ToastContainer toasts={[item({ variant, title: `T-${variant}`, message: 'line1\nline2' })]} onDismiss={vi.fn()} />);
    const title = screen.getByText(`T-${variant}`);
    const card = title.closest('div.flex.items-start') as HTMLElement;
    expect(card).toHaveClass(accent);
    expect(card).toHaveTextContent(icon);
    expect(screen.getByText(/line1/)).toHaveClass('whitespace-pre-line');
    expectQuietConsole();
  });

  it('omits the message line when there is none', () => {
    render(<ToastContainer toasts={[item({ title: 'Only title' })]} onDismiss={vi.fn()} />);
    const card = screen.getByText('Only title').closest('div.flex.items-start') as HTMLElement;
    expect(card.querySelectorAll('p')).toHaveLength(1);
  });

  it('slides in, then auto-dismisses after its duration (default 5 s) plus the 200 ms exit', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ToastContainer toasts={[item({ id: 'a' }), item({ id: 'b', title: 'Quick', duration: 1000 })]} onDismiss={onDismiss} />);
    const card = () => screen.getByText('Saved').closest('div.flex.items-start') as HTMLElement;
    expect(card()).toHaveClass('opacity-0');
    act(() => { vi.advanceTimersByTime(20); });
    expect(card()).toHaveClass('opacity-100');

    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(onDismiss).toHaveBeenCalledWith('b');
    expect(onDismiss).not.toHaveBeenCalledWith('a');

    act(() => { vi.advanceTimersByTime(4000); });
    expect(card()).toHaveClass('opacity-0');
    act(() => { vi.advanceTimersByTime(200); });
    expect(onDismiss).toHaveBeenCalledWith('a');
    expectQuietConsole();
  });

  it('the close button dismisses after the exit animation', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ToastContainer toasts={[item({ id: 'x', duration: 60_000 })]} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(onDismiss).toHaveBeenCalledWith('x');
  });

  it('renders the toast title with a single dismiss control', () => {
    render(<ToastContainer toasts={[item({ title: 'Cycle saved' })]} onDismiss={vi.fn()} />);
    expect(screen.getByText('Cycle saved')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  // A4 / A5: the close control is named, and each toast is a live status region —
  // politely announced, errors assertively.
  it('every toast is announced (status, assertive for errors) and its close control is named', () => {
    const { container } = render(
      <ToastContainer toasts={[item({ id: 'a', title: 'Cycle saved' }), item({ id: 'b', title: 'Sync failed', variant: 'error' })]} onDismiss={vi.fn()} />,
    );
    const [ok, err] = screen.getAllByRole('status');
    expect(ok).toHaveTextContent('Cycle saved');
    expect(ok).toHaveAttribute('aria-live', 'polite');
    expect(err).toHaveTextContent('Sync failed');
    expect(err).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getAllByRole('button', { name: 'Dismiss notification' })).toHaveLength(2);
    expectAllControlsNamed(container);
    expectQuietConsole();
  });

  it('unmounting before the timer fires never calls onDismiss', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { unmount } = render(<ToastContainer toasts={[item()]} onDismiss={onDismiss} />);
    unmount();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('ToastProvider + useToast', () => {
  function Buttons() {
    const { toast } = useToast();
    return (
      <>
        <button onClick={() => toast.warning('Low battery', 'Charge the tablet')}>warn</button>
        <button onClick={() => toast.info('FYI')}>info</button>
        <button onClick={() => toast.successToast('Synced')}>synced</button>
        <button onClick={() => { toast.success('Saved', 'All good'); toast.error('Save failed'); }}>two-modals</button>
      </>
    );
  }

  it('non-blocking toasts appear in the corner', () => {
    render(<ToastProvider><Buttons /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'warn' }));
    fireEvent.click(screen.getByRole('button', { name: 'info' }));
    fireEvent.click(screen.getByRole('button', { name: 'synced' }));
    expect(screen.getByText('Low battery')).toBeInTheDocument();
    expect(screen.getByText('Charge the tablet')).toBeInTheDocument();
    expect(screen.getByText('FYI')).toBeInTheDocument();
    expect(screen.getByText('Synced')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expectQuietConsole();
  });

  it('a toast removes itself from the provider after its lifetime', () => {
    vi.useFakeTimers();
    render(<ToastProvider><Buttons /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'info' }));
    expect(screen.getByText('FYI')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(5000); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText('FYI')).toBeNull();
    expectQuietConsole();
  });

  it('toast.success / toast.error queue acknowledgement modals shown one at a time (FIFO)', () => {
    render(<ToastProvider><Buttons /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'two-modals' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Saved' })).toBeInTheDocument();
    expect(screen.getByText('All good')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.getByRole('heading', { name: 'Save failed' })).toBeInTheDocument();
    expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expectQuietConsole();
  });

  it('bridges SWR load errors into a non-blocking error toast while mounted, and stops after unmount', () => {
    const quiet = consoleError.mockImplementation(() => {}); // onError logs real failures by design
    const { unmount } = render(<ToastProvider><span>app</span></ToastProvider>);
    act(() => { (swrConfig.onError as (e: unknown) => void)(Object.assign(new Error('DB timeout'), { status: 500 })); });
    expect(screen.getByText('Load Error')).toBeInTheDocument();
    expect(screen.getByText('DB timeout')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull(); // a poll failure must never pop a blocking modal
    unmount();
    expect(() => (swrConfig.onError as (e: unknown) => void)(new Error('after unmount'))).not.toThrow();
    expect(quiet).toHaveBeenCalledWith('[SWR Error]', 'after unmount');
  });

  it('useToast outside a provider throws a clear error', () => {
    const quiet = consoleError.mockImplementation(() => {}); // React reports the thrown render error
    expect(() => renderHook(() => useToast())).toThrow('useToast must be used within a ToastProvider');
    quiet.mockRestore();
  });
});

describe('MessageDialog backdrop', () => {
  it('a backdrop click dismisses; a click inside the card does not', () => {
    const onDismiss = vi.fn();
    render(<MessageDialog item={{ id: 'm1', variant: 'success', title: 'Done' }} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('Your changes have been saved successfully.'));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onDismiss).toHaveBeenCalledWith('m1');
  });

  // A6: the modal is named by its title.
  it('is a modal dialog named by its title, and its OK button is named', () => {
    const { container } = render(<MessageDialog item={{ id: 'm2', variant: 'error', title: 'Save failed' }} onDismiss={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Save failed' })).toHaveAttribute('aria-modal', 'true');
    expectAllControlsNamed(container);
  });

  it('removes its Escape listener when unmounted', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<MessageDialog item={{ id: 'm3', variant: 'error', title: 'X' }} onDismiss={onDismiss} />);
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('ErrorPopup', () => {
  it('renders nothing for an empty error', () => {
    const { container } = render(<ErrorPopup error="" onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the error; OK and Escape both close it', () => {
    const onClose = vi.fn();
    render(<ErrorPopup error="Filter is retired" onClose={onClose} />);
    expect(screen.getByRole('heading', { name: 'Error' })).toBeInTheDocument();
    expect(screen.getByText('Filter is retired')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expectQuietConsole();
  });
});
