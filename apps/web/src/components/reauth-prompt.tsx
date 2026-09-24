import { ReauthDialog } from '@/components/reauth-dialog';
import type { useReauth } from '@/hooks/use-reauth';

/**
 * The password dialog for a page's `useReauth()` instance, in one line:
 *
 *   const reauth = useReauth();
 *   …
 *   <ReauthPrompt reauth={reauth} actionLabel="Save" />
 *
 * Added with the 2026-09-24 re-auth coverage sweep, which wired the prompt
 * into ~20 pages that called gated endpoints with no way to answer a
 * REAUTH_REQUIRED. Same dialog as the eight-prop form used elsewhere.
 */
export function ReauthPrompt({ reauth, actionLabel }: { reauth: ReturnType<typeof useReauth>; actionLabel?: string }) {
  return (
    <ReauthDialog
      open={reauth.isOpen}
      password={reauth.password}
      error={reauth.error}
      isVerifying={reauth.isVerifying}
      onPasswordChange={reauth.setPassword}
      onConfirm={reauth.confirm}
      onCancel={reauth.cancel}
      actionLabel={reauth.pendingActionLabel ?? actionLabel}
    />
  );
}
