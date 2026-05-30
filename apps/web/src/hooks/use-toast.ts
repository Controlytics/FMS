import { createContext, useContext, useCallback, useState } from 'react';
import type { ToastItem, ToastVariant } from '@/components/ui/toast';
import type { SuccessItem } from '@/components/ui/success-dialog';

let idCounter = 0;

interface ToastAPI {
  // success() shows a blocking success MODAL (operator clicks OK). Used for
  // save-type actions app-wide. successToast() is the non-blocking escape hatch
  // for background/minor successes (sync, copy, etc.).
  success: (title: string, message?: string) => void;
  successToast: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

interface ToastContextValue {
  toasts: ToastItem[];
  successDialogs: SuccessItem[];
  toast: ToastAPI;
  dismiss: (id: string) => void;
  dismissSuccess: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToastState(): ToastContextValue {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [successDialogs, setSuccessDialogs] = useState<SuccessItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissSuccess = useCallback((id: string) => {
    setSuccessDialogs((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const addToast = useCallback((variant: ToastVariant, title: string, message?: string) => {
    const id = `toast-${++idCounter}`;
    setToasts((prev) => [...prev, { id, title, message, variant }]);
  }, []);

  const addSuccessDialog = useCallback((title: string, message?: string) => {
    const id = `success-${++idCounter}`;
    setSuccessDialogs((prev) => [...prev, { id, title, message }]);
  }, []);

  const toast: ToastAPI = {
    success: useCallback((title: string, message?: string) => addSuccessDialog(title, message), [addSuccessDialog]),
    successToast: useCallback((title: string, message?: string) => addToast('success', title, message), [addToast]),
    error: useCallback((title: string, message?: string) => addToast('error', title, message), [addToast]),
    warning: useCallback((title: string, message?: string) => addToast('warning', title, message), [addToast]),
    info: useCallback((title: string, message?: string) => addToast('info', title, message), [addToast]),
  };

  return { toasts, successDialogs, toast, dismiss, dismissSuccess };
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
