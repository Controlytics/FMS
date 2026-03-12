import { useState, useRef, useCallback } from 'react';
import useSWR from 'swr';

interface ReauthState {
  isOpen: boolean;
  password: string;
  error: string;
  isVerifying: boolean;
}

/**
 * Hook that manages re-authentication for any action.
 *
 * Usage:
 *   const reauth = useReauth();
 *
 *   // When user tries to perform an action:
 *   reauth.execute('DELETE_USER', async (password?) => {
 *     if (password) {
 *       await apiClient.deleteWithReauth(`/api/users/${id}`, password);
 *     } else {
 *       await apiClient.delete(`/api/users/${id}`);
 *     }
 *   });
 */
export function useReauth() {
  const { data: myActions } = useSWR<{ actions: string[] }>(
    '/api/config/action-reauth/my-actions',
    { revalidateOnMount: true, revalidateOnFocus: false, dedupingInterval: 5000 },
  );

  const [state, setState] = useState<ReauthState>({
    isOpen: false,
    password: '',
    error: '',
    isVerifying: false,
  });

  const pendingAction = useRef<{
    action: string;
    callback: (password?: string) => Promise<void>;
    onSuccess?: () => void;
    onError?: (err: unknown) => void;
  } | null>(null);

  const needsReauth = useCallback(
    (action: string): boolean => {
      return myActions?.actions.includes(action) ?? false;
    },
    [myActions],
  );

  const execute = useCallback(
    async (
      action: string,
      callback: (password?: string) => Promise<void>,
      options?: { onSuccess?: () => void; onError?: (err: unknown) => void },
    ) => {
      if (needsReauth(action)) {
        pendingAction.current = {
          action,
          callback,
          onSuccess: options?.onSuccess,
          onError: options?.onError,
        };
        setState({ isOpen: true, password: '', error: '', isVerifying: false });
      } else {
        try {
          await callback();
          options?.onSuccess?.();
        } catch (err: any) {
          // If the backend returns REAUTH_REQUIRED even though the frontend
          // didn't think reauth was needed (e.g. SWR data not loaded yet),
          // show the reauth dialog retroactively instead of swallowing the error.
          if (err?.error === 'REAUTH_REQUIRED') {
            pendingAction.current = {
              action,
              callback,
              onSuccess: options?.onSuccess,
              onError: options?.onError,
            };
            setState({ isOpen: true, password: '', error: '', isVerifying: false });
          } else {
            options?.onError?.(err);
          }
        }
      }
    },
    [needsReauth],
  );

  const confirm = useCallback(async () => {
    if (!pendingAction.current || !state.password) return;

    setState((s) => ({ ...s, isVerifying: true, error: '' }));
    try {
      await pendingAction.current.callback(state.password);
      pendingAction.current.onSuccess?.();
      setState({ isOpen: false, password: '', error: '', isVerifying: false });
      pendingAction.current = null;
    } catch (err: any) {
      if (err?.error === 'REAUTH_FAILED') {
        setState((s) => ({
          ...s,
          error: 'Incorrect password. Please try again.',
          isVerifying: false,
        }));
      } else if (err?.error === 'REAUTH_REQUIRED') {
        // Password wasn't received — show clearer message
        setState((s) => ({
          ...s,
          error: 'Password is required. Please enter your password.',
          isVerifying: false,
        }));
      } else {
        pendingAction.current?.onError?.(err);
        setState({ isOpen: false, password: '', error: '', isVerifying: false });
        pendingAction.current = null;
      }
    }
  }, [state.password]);

  const cancel = useCallback(() => {
    setState({ isOpen: false, password: '', error: '', isVerifying: false });
    pendingAction.current = null;
  }, []);

  const setPassword = useCallback((password: string) => {
    setState((s) => ({ ...s, password }));
  }, []);

  return {
    needsReauth,
    execute,
    confirm,
    cancel,
    setPassword,
    isOpen: state.isOpen,
    password: state.password,
    error: state.error,
    isVerifying: state.isVerifying,
  };
}
