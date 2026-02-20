import { createContext, useContext, useCallback, useState } from 'react';
import type { ToastItem, ToastVariant } from '@/components/ui/toast';

let idCounter = 0;

interface ToastAPI {
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

interface ToastContextValue {
  toasts: ToastItem[];
  toast: ToastAPI;
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToastState(): ToastContextValue {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((variant: ToastVariant, title: string, message?: string) => {
    const id = `toast-${++idCounter}`;
    setToasts((prev) => [...prev, { id, title, message, variant }]);
  }, []);

  const toast: ToastAPI = {
    success: useCallback((title: string, message?: string) => addToast('success', title, message), [addToast]),
    error: useCallback((title: string, message?: string) => addToast('error', title, message), [addToast]),
    warning: useCallback((title: string, message?: string) => addToast('warning', title, message), [addToast]),
    info: useCallback((title: string, message?: string) => addToast('info', title, message), [addToast]),
  };

  return { toasts, toast, dismiss };
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
