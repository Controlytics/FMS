/**
 * Per-request ambient store (AsyncLocalStorage), 2026-09-25.
 *
 * Exists for ONE fact that has to travel from the re-auth gate to every audit
 * row the gated handler writes, without threading a parameter through ~200
 * `auditLog()` call sites: the id of the REAUTH_SUCCESS row that IS the
 * operator's electronic signature for this request.
 *
 * Audit 2026-09-24 (compliance F2): a signature row and the row it signed
 * were linked only by being adjacent in the hash chain. Adjacency is not a
 * link — two signed actions in flight at once interleave, and an inspector
 * reading "REAUTH_SUCCESS for RETIRE_FILTER" followed by "FILTER_RETIRED"
 * has to *assume* they belong together. `audit_trail.signature_audit_id` now
 * carries the REAUTH_SUCCESS row's id on every row written inside the signed
 * request, and it is part of the row's checksum.
 *
 * The store is created in an `onRequest` hook (app.ts) via `als.run(store,
 * done)`, which is the documented way to make the context reach every later
 * hook and the handler. Outside a request (cron, tests, boot) `getRequestStore()`
 * is undefined and callers treat that as "no signature".
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestStore {
  /** id of the REAUTH_SUCCESS audit row written by the re-auth gate for this request. */
  reauthAuditId?: string;
}

const als = new AsyncLocalStorage<RequestStore>();

export function runWithRequestStore<T>(store: RequestStore, fn: () => T): T {
  return als.run(store, fn);
}

export function getRequestStore(): RequestStore | undefined {
  return als.getStore();
}
