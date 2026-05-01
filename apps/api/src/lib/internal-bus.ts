/**
 * Internal pub/sub bus (Phase 4 — 2026-05-01).
 *
 * Replaces the Redis pub/sub layer that fanned out events between API
 * subsystems (ingestion → WebSocket fan-out, pipeline traces → debug page,
 * rule-chain debug stream). DigiLog runs as a SINGLE Node API process —
 * NSSM runs one `node app.js` — so cross-process pub/sub was solving a
 * problem that doesn't exist in this deployment model.
 *
 * Design goals:
 *   1. Zero new infrastructure (no Redis, no PG LISTEN/NOTIFY, no broker hop).
 *   2. Same-process latency (~10ns per emit, vs Redis 0.1-1ms or PG 5-20ms).
 *   3. Future-proof: if multi-process scale-out ever becomes a real
 *      requirement, replace the EventEmitter implementation below with a
 *      PG LISTEN/NOTIFY adapter — call sites won't change.
 *
 * Design non-goals (deliberately):
 *   - Backpressure (Redis pub/sub didn't have it either; no regression).
 *   - Persistence across process restart (Redis pub/sub didn't either).
 *   - Cross-process delivery (single-process deployment).
 *
 * Channels in current use:
 *   - 'ws:events'                 — telemetry/attribute updates fan out
 *                                   to WebSocket subscribers.
 *   - 'ws:trace:${entityId}'      — pipeline trace stream per entity.
 *   - 'debug:rulechain:${chainId}'— rule-chain debug record stream.
 *
 * If you ever need multi-process: replace `emitter` with a transport that
 * implements the same emit/on/off interface. No call sites change.
 */
import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();

// We have many channels (one per entity for traces) and several listeners
// per channel. Default of 10 trips the maxListeners warning under load.
emitter.setMaxListeners(1000);

export type BusUnsubscribe = () => void;

export const bus = {
  /**
   * Publish a payload to a channel. Synchronous: all listeners run in the
   * current event-loop tick before this call returns.
   */
  emit<T = unknown>(channel: string, payload: T): void {
    emitter.emit(channel, payload);
  },

  /**
   * Subscribe to a channel. Returns an unsubscribe function. Handler may be
   * sync or async; rejected promises are swallowed (matches Redis pub/sub
   * fire-and-forget semantics — handler errors don't disturb publishers).
   */
  on<T = unknown>(channel: string, handler: (payload: T) => void | Promise<void>): BusUnsubscribe {
    const wrapped = (payload: T) => {
      try {
        const r = handler(payload);
        if (r && typeof (r as any).catch === 'function') (r as Promise<void>).catch(() => {});
      } catch {
        // Match fire-and-forget semantics — never let a handler bring down a publisher.
      }
    };
    emitter.on(channel, wrapped as any);
    return () => emitter.off(channel, wrapped as any);
  },

  /** Manually remove a specific handler. Prefer the unsubscribe returned by `on`. */
  off<T = unknown>(channel: string, handler: (payload: T) => void | Promise<void>): void {
    emitter.off(channel, handler as any);
  },

  /** Listener count — only used by tests. */
  listenerCount(channel: string): number {
    return emitter.listenerCount(channel);
  },
};
