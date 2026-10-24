import useSWR from 'swr';
import { useIsSuperAdmin } from '@/components/super-admin-record-edit';

interface AhuCompletionModeData {
  mode: string;
}

export function useAhuCompletionMode(): 'NONE' | 'POPUP' | 'INTERLOCK' {
  const { data } = useSWR<AhuCompletionModeData>(
    '/api/config/ahu-completion-process/current',
    { revalidateOnMount: true, dedupingInterval: 5000, revalidateOnFocus: false }
  );
  const m = data?.mode;
  return m === 'INTERLOCK' || m === 'POPUP' ? m : 'NONE';
}

/**
 * The mode the cleaning pages (Filter Operations, the tablet station) apply to the
 * signed-in user's OWN completion (2026-10-24, operator: a Super Admin's own work
 * is not held). The server exempts a Super Admin from the AHU interlock and
 * records AHU_COMPLETION, so for a Super Admin INTERLOCK reads as POPUP: the same
 * set choice and warning listing the pending filters, with "proceed" instead of a
 * block. Every other role gets the configured mode. The configuration page keeps
 * useAhuCompletionMode — it shows the setting, not anyone's gate.
 */
export function useAhuCompletionModeForOwnWork(): 'NONE' | 'POPUP' | 'INTERLOCK' {
  const mode = useAhuCompletionMode();
  const isSuperAdmin = useIsSuperAdmin();
  return mode === 'INTERLOCK' && isSuperAdmin ? 'POPUP' : mode;
}
