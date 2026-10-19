import { useNavigate } from 'react-router-dom';
import { PERMISSIONS } from '@digilog/shared';
import { useAuth } from '@/hooks/use-auth';

/**
 * Back arrow for config sub-pages that roles WITHOUT CONFIG_READ can open
 * (QA 2026-10-19, OQ-14 follow-up). Going to /config there lands on "Access
 * denied", because /config needs SUPER_ADMIN or CONFIG_READ (main.tsx). Such a
 * user goes back in history instead, or to the dashboard when there is none
 * (page opened in a fresh tab). Same rule as the Equipment Groups fix.
 */
export function useConfigBack(): () => void {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canOpenConfig = user?.role === 'SUPER_ADMIN'
    || ((user?.permissions as string[] | undefined) ?? []).includes(PERMISSIONS.CONFIG_READ);
  return () => {
    if (canOpenConfig) { navigate('/config'); return; }
    if (((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0) navigate(-1);
    else navigate('/');
  };
}
