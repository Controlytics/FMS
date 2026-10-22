import { useEffect } from 'react';

/**
 * Global RFID input guard.
 *
 * RFID readers in UKB mode type tag IDs as rapid keystrokes into whatever
 * field has focus. This guard intercepts those bursts and blocks them from
 * entering non-RFID fields.
 *
 * Only inputs with data-rfid="true" attribute will receive RFID input.
 * All other inputs are protected.
 *
 * Detection: tracks keystroke timing. When the last 3 characters each arrived
 * within SPEED_THRESHOLD (80 ms) of the previous one — readers type at 3-50 ms,
 * people at 80-300 ms — the key is flagged as RFID input and blocked from
 * non-RFID fields. Detection needs that history, so the first two characters
 * of a burst still land (a limit of timing-based detection).
 *
 * The Enter a reader sends after the tag is blocked only when it follows a
 * BLOCKED burst key within ENTER_AFTER_BURST_MS. It must never depend on how
 * recently a person typed: an earlier version blocked any Enter < 200 ms after
 * the third keystroke, which swallowed operators' own Enter on every page (WSH-RFID-2).
 */
export function useRfidGuard() {
  useEffect(() => {
    const timestamps: number[] = [];
    const MAX_TRACK = 10;

    // How fast characters arrive to be considered RFID (ms between keys)
    // RFID readers type at 3-50ms intervals. Humans type at 80-300ms.
    const SPEED_THRESHOLD = 80;
    // How many consecutive fast keys to trigger blocking
    const MIN_FAST_KEYS = 3;
    // A reader's trailing Enter arrives right after its last character.
    const ENTER_AFTER_BURST_MS = 200;
    // When this guard last blocked a burst character (0 = none pending).
    let lastBlockedAt = 0;

    const handler = (e: KeyboardEvent) => {
      // Only track printable characters. `key` is undefined on the synthetic
      // keydown Chrome dispatches when it autofills a field (seen on the SMTP
      // password input) — reading `.length` there threw on every autofill.
      if (!e.key || e.key.length !== 1) return;

      // Allow if focused element is an RFID input
      const target = e.target as HTMLElement;
      if (target.getAttribute('data-rfid') === 'true') return;

      // Track timestamp
      const now = Date.now();
      timestamps.push(now);
      if (timestamps.length > MAX_TRACK) timestamps.shift();

      // Check if recent keystrokes are RFID-fast
      if (timestamps.length >= MIN_FAST_KEYS) {
        const recentCount = MIN_FAST_KEYS;
        let allFast = true;
        for (let i = timestamps.length - 1; i > timestamps.length - recentCount; i--) {
          if (timestamps[i] - timestamps[i - 1] > SPEED_THRESHOLD) {
            allFast = false;
            break;
          }
        }

        if (allFast) {
          // This is RFID input — block it from non-RFID fields
          e.preventDefault();
          e.stopImmediatePropagation();
          lastBlockedAt = now;
          return;
        }
      }
    };

    // Also block the Enter key that RFID sends after the tag ID
    const enterHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const target = e.target as HTMLElement;
      if (target.getAttribute('data-rfid') === 'true') return;

      // Only an Enter that immediately follows a burst this guard actually
      // blocked is the reader's — any other Enter is a person submitting a form.
      if (lastBlockedAt && Date.now() - lastBlockedAt < ENTER_AFTER_BURST_MS) {
        e.preventDefault();
        e.stopImmediatePropagation();
        timestamps.length = 0;
        lastBlockedAt = 0;
      }
    };

    document.addEventListener('keydown', handler, true);
    document.addEventListener('keydown', enterHandler, true);
    return () => {
      document.removeEventListener('keydown', handler, true);
      document.removeEventListener('keydown', enterHandler, true);
    };
  }, []);
}
