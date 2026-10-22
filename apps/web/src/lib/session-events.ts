/**
 * "The session ended" - one signal for every way it can end: a manual logout, the
 * idle auto-logout (both through useAuth().logout) and a 401 from the server
 * (api-client). App-wide state that outlives the routes - the ToastProvider's
 * message dialogs and toasts - listens and clears itself, so nothing from the
 * previous session is left over the login page of a shared workstation
 * (D03-14, 2026-10-22: a "User created ..." result covered the next login).
 */
const SESSION_ENDED = 'digilog:session-ended';

export function announceSessionEnded(): void {
  window.dispatchEvent(new Event(SESSION_ENDED));
}

/** Runs `onEnd` whenever the session ends; returns the unsubscribe. */
export function onSessionEnded(onEnd: () => void): () => void {
  window.addEventListener(SESSION_ENDED, onEnd);
  return () => window.removeEventListener(SESSION_ENDED, onEnd);
}
