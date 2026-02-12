import { useEffect, useRef, useState, useCallback } from 'react';

interface SessionConfig {
  autoLogoutEnabled: boolean;
  idleTimeoutMinutes: number;
  warningMinutes: number;
}

export function useSession(config: SessionConfig | null, onLogout: () => void) {
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const warningTimer = useRef<ReturnType<typeof setInterval>>(undefined);

  const resetTimer = useCallback(() => {
    if (!config?.autoLogoutEnabled) return;

    setShowWarning(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (warningTimer.current) clearInterval(warningTimer.current);

    const warningTime = (config.idleTimeoutMinutes - config.warningMinutes) * 60 * 1000;

    idleTimer.current = setTimeout(() => {
      setShowWarning(true);
      let remaining = config.warningMinutes * 60;
      setCountdown(remaining);

      warningTimer.current = setInterval(() => {
        remaining -= 1;
        setCountdown(remaining);
        if (remaining <= 0) {
          if (warningTimer.current) clearInterval(warningTimer.current);
          onLogout();
        }
      }, 1000);
    }, warningTime);
  }, [config, onLogout]);

  useEffect(() => {
    if (!config?.autoLogoutEnabled) return;

    const events = ['mousedown', 'keypress', 'scroll', 'touchstart', 'mousemove'];
    const handler = () => {
      if (!showWarning) resetTimer();
    };

    events.forEach((e) => window.addEventListener(e, handler));
    resetTimer();

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (warningTimer.current) clearInterval(warningTimer.current);
    };
  }, [config, resetTimer, showWarning]);

  const continueSession = () => {
    setShowWarning(false);
    if (warningTimer.current) clearInterval(warningTimer.current);
    resetTimer();
  };

  return { showWarning, countdown, continueSession };
}
