import { createElement } from 'react';
import { ToastContext, useToastState } from '@/hooks/use-toast';
import { ToastContainer } from '@/components/ui/toast';

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const state = useToastState();
  return createElement(
    ToastContext.Provider,
    { value: state },
    children,
    createElement(ToastContainer, { toasts: state.toasts, onDismiss: state.dismiss }),
  );
}
