/**
 * Super Admin's own work is not held (operator decision 2026-10-24, "own work
 * not held" — tier 1 of the four the operator was offered).
 *
 * A Super Admin's OWN online work is not paused or queued by the gates that
 * exist to have a second person check it:
 *   - the QA stage interlock: entering Wash Out / Dry Out raises no approval,
 *     so the filter can leave it (keyed on who ENTERED the stage — an
 *     operator's held filter still needs a real approval, whoever scans it);
 *   - the AHU completion interlock (INTERLOCK mode);
 *   - the review step of a filter, a PM visit or a replacement schedule the
 *     Super Admin creates.
 *
 * Deliberately NOT part of this (the operator kept them): segregation of duties
 * (a Super Admin still cannot approve what it performed — there is simply
 * nothing to approve for its own work now), the always-on password (OD-01), the
 * data-integrity refusals and the rules that protect the Super Admin itself.
 *
 * Every skipped gate is RECORDED, never silent: its name goes into
 * `superAdminExemptGates` on the event attributes and the audit row, the same
 * way an offline replay records `replayExemptGates`. An offline replay is
 * exempt from these gates already and records them there, so this rule is for
 * online work only.
 */
import type { RequestContext } from '../types/context.js';

export const SUPER_ADMIN_EXEMPT_GATES = 'superAdminExemptGates' as const;

/** The gate names written into `superAdminExemptGates`. */
export type SuperAdminExemptGate =
  | 'INTERLOCK_ENTRY'      // entered a gated stage; no approval was raised
  | 'INTERLOCK_TERMINAL'   // completed the cycle out of a gated stage without an approval
  | 'AHU_COMPLETION'       // completed while the AHU interlock would have refused
  | 'FILTER_REVIEW'        // a created filter was approved at once
  | 'PM_REVIEW'            // a PM visit / change was approved at once
  | 'REPLACEMENT_REVIEW';  // a replacement schedule upload was approved at once

export function isSuperAdminOwnWork(ctx: Pick<RequestContext, 'userRole' | 'isOfflineReplay'>): boolean {
  return ctx.userRole === 'SUPER_ADMIN' && ctx.isOfflineReplay !== true;
}

/** Did a stored event / audit payload record that `gate` was skipped for a Super Admin? */
export function recordsSuperAdminExemption(payload: unknown, gate: SuperAdminExemptGate): boolean {
  const list = (payload as Record<string, unknown> | null | undefined)?.[SUPER_ADMIN_EXEMPT_GATES];
  return Array.isArray(list) && list.includes(gate);
}

/** `{ superAdminExemptGates: [...] }` when the list is non-empty, else `{}` — for spreading into attributes / audit values. */
export function superAdminExemptionFields(gates: readonly SuperAdminExemptGate[]): Record<string, unknown> {
  return gates.length ? { [SUPER_ADMIN_EXEMPT_GATES]: [...gates] } : {};
}
