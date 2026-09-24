import { stageReauthAction } from '@digilog/shared';
import { apiClient } from './api-client';
import type { useReauth } from '@/hooks/use-reauth';

/**
 * Re-auth rows for a stage move (2026-09-24): the generic row(s) plus the
 * per-station row for the target stage, so Config → Action Re-auth can gate
 * "Move to Storage In" on its own. Mirrors `withStageAction()` on the API.
 */
export function withStageAction(base: string[], targetState: string | null | undefined): string[] {
  const stage = stageReauthAction(targetState);
  return stage ? [...base, stage] : base;
}

/** Target stage of the first item in a bulk batch (all items share a station). */
export function batchTargetState(ops: Array<{ payload?: any; advancePayload?: any }>): string | undefined {
  const first = ops[0];
  return first?.advancePayload?.targetState ?? first?.payload?.targetState;
}

/**
 * Sign ONCE for a loop of per-filter calls. Prompts when any of `actions` is
 * switched on for this role, verifies the password against
 * POST /api/auth/verify (so a wrong password is refused in the dialog, not
 * once per filter), and returns it for the caller to forward on every call.
 * Returns undefined when nothing is gated. Rejects with
 * `{ error: 'REAUTH_CANCELLED' }` when the operator dismisses the dialog.
 */
export async function preauthorize(
  reauth: Pick<ReturnType<typeof useReauth>, 'executeWithResult'>,
  actions: string | string[],
): Promise<string | undefined> {
  return reauth.executeWithResult(actions, async (password?: string) => {
    if (password) {
      try {
        await apiClient.post('/api/auth/verify', { password });
      } catch (e: any) {
        // Normalise to the code the dialog understands ("Incorrect password").
        if (e?.status === 401 || e?.error === 'INVALID_CREDENTIALS' || e?.error === 'INVALID_PASSWORD') {
          throw { error: 'REAUTH_FAILED', message: e?.message ?? 'Incorrect password.' };
        }
        throw e;
      }
    }
    return password;
  });
}

/**
 * `preauthorize` for a loop that must simply stop when the operator cancels:
 * returns `{ ok: false }` on REAUTH_CANCELLED instead of throwing, so the
 * caller can reset its loading flags and return. Other errors still throw.
 */
export async function signOnce(
  reauth: Pick<ReturnType<typeof useReauth>, 'executeWithResult'>,
  actions: string | string[],
): Promise<{ ok: true; password?: string } | { ok: false }> {
  try {
    return { ok: true, password: await preauthorize(reauth, actions) };
  } catch (e: any) {
    if (e?.error === 'REAUTH_CANCELLED') return { ok: false };
    throw e;
  }
}
