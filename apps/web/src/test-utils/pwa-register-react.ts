/**
 * Test stand-in for `virtual:pwa-register/react` (2026-10-21).
 *
 * vite-plugin-pwa GENERATES that module at build time; it does not exist under
 * vitest, and vite's import analysis fails before `vi.mock` can apply, so nothing
 * that imports it (PwaReloadPrompt) could be loaded in a test. `vitest.config.ts`
 * aliases the specifier to this file. Types come from the real declarations
 * (`vite-plugin-pwa/react`), so this must keep the same exports and shapes.
 *
 * Default: no update waiting, nothing registered — a page that mounts
 * PwaReloadPrompt renders nothing. Tests drive it through `pwaRegisterControl`
 * (import it from '@/test-utils/pwa-register-react' — the same module instance
 * the component gets through the alias).
 */
import { useState, type Dispatch, type SetStateAction } from 'react';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';

export type { RegisterSWOptions };

export const pwaRegisterControl = {
  /** `needRefresh` value for the NEXT mount. */
  initialNeedRefresh: false,
  /** The options the component passed (onRegisteredSW / onRegisterError). */
  options: undefined as RegisterSWOptions | undefined,
  /** Flip `needRefresh` from a test, as the real module does when a new worker waits. */
  setNeedRefresh: undefined as Dispatch<SetStateAction<boolean>> | undefined,
  /** Every `updateServiceWorker(reloadPage)` call. */
  updateCalls: [] as Array<boolean | undefined>,
  reset() {
    this.initialNeedRefresh = false;
    this.options = undefined;
    this.setNeedRefresh = undefined;
    this.updateCalls = [];
  },
};

export function useRegisterSW(options?: RegisterSWOptions): {
  needRefresh: [boolean, Dispatch<SetStateAction<boolean>>];
  offlineReady: [boolean, Dispatch<SetStateAction<boolean>>];
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
} {
  pwaRegisterControl.options = options;
  const needRefresh = useState(pwaRegisterControl.initialNeedRefresh);
  const offlineReady = useState(false);
  pwaRegisterControl.setNeedRefresh = needRefresh[1];
  return {
    needRefresh,
    offlineReady,
    updateServiceWorker: async (reloadPage?: boolean) => { pwaRegisterControl.updateCalls.push(reloadPage); },
  };
}
