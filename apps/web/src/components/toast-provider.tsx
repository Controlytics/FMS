import { createElement, useEffect } from 'react';
import { ToastContext, useToastState } from '@/hooks/use-toast';
import { ToastContainer } from '@/components/ui/toast';
import { SuccessDialog } from '@/components/ui/success-dialog';
import { registerSwrToast, unregisterSwrToast } from '@/lib/swr-config';

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const state = useToastState();

  useEffect(() => {
    registerSwrToast(state.toast.error);
    return () => unregisterSwrToast();
  }, [state.toast.error]);

  return createElement(
    ToastContext.Provider,
    { value: state },
    children,
    createElement(ToastContainer, { toasts: state.toasts, onDismiss: state.dismiss }),
    // One success modal at a time (FIFO) — shown after any toast.success(...).
    state.successDialogs.length > 0
      ? createElement(SuccessDialog, { item: state.successDialogs[0], onDismiss: state.dismissSuccess })
      : null,
  );
}
