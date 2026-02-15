import { useState, useCallback } from 'react';

interface ReauthState {
  isOpen: boolean;
  operation: string;
  pendingAction: ((token: string) => Promise<void>) | null;
}

export function useReauth() {
  const [state, setState] = useState<ReauthState>({
    isOpen: false,
    operation: '',
    pendingAction: null,
  });

  const executeWithReauth = useCallback(
    (operation: string, action: (token: string) => Promise<void>) => {
      // Try without token first - if reauth not required, it will succeed
      return action('').catch(async (err: Error) => {
        if (err.message?.includes('Re-authentication required')) {
          // Show reauth dialog
          return new Promise<void>((resolve, reject) => {
            setState({
              isOpen: true,
              operation,
              pendingAction: async (token: string) => {
                try {
                  await action(token);
                  resolve();
                } catch (innerErr) {
                  reject(innerErr);
                }
              },
            });
          });
        }
        throw err;
      });
    },
    [],
  );

  const onReauthSuccess = useCallback(async (token: string) => {
    if (state.pendingAction) {
      await state.pendingAction(token);
    }
    setState({ isOpen: false, operation: '', pendingAction: null });
  }, [state.pendingAction]);

  const onReauthClose = useCallback(() => {
    setState({ isOpen: false, operation: '', pendingAction: null });
  }, []);

  return {
    isOpen: state.isOpen,
    operation: state.operation,
    executeWithReauth,
    onReauthSuccess,
    onReauthClose,
  };
}
