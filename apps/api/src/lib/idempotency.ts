/**
 * Idempotency helper — dedup retried offline replays via x-client-op-id header.
 *
 * Flow:
 *   1. Client queues an operation locally with a generated UUID (clientOpId)
 *   2. Sync engine replays with header `x-client-op-id: <uuid>` + body `clientOpId`
 *   3. Server checks if any FilterEvent was previously written with this clientOpId
 *      stored inside attributes.clientOpId — if so, returns the cached current-state
 *      response (effectively a no-op replay)
 *   4. Otherwise the mutation proceeds, and the writer must persist clientOpId
 *      inside FilterEvent.attributes so a future retry will hit step 3
 *
 * This makes every offline replay safe to retry without producing duplicate cycles,
 * double advances, or repeat checklist submissions.
 */
import type { FastifyRequest } from 'fastify';
import { prisma } from './prisma.js';

/**
 * Read clientOpId from header (preferred) or body fallback.
 * Returns null when the request is not an idempotent replay.
 */
export function getClientOpId(req: FastifyRequest, body?: Record<string, any>): string | null {
  const header = req.headers['x-client-op-id'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  if (body && typeof body.clientOpId === 'string' && body.clientOpId.trim()) return body.clientOpId.trim();
  return null;
}

/**
 * Has this clientOpId already been processed for this filter? Used at the
 * start of every mutation to short-circuit duplicate replays.
 */
export async function findExistingByClientOpId(filterId: string, clientOpId: string): Promise<boolean> {
  const existing = await prisma.filterEvent.findFirst({
    where: {
      filterId,
      attributes: { path: ['clientOpId'], equals: clientOpId },
    },
    select: { id: true },
  });
  return !!existing;
}

/**
 * Embed clientOpId into the attributes JSON for a FilterEvent write so that
 * future replays of the same op can detect the duplicate.
 */
export function withClientOpId<T extends Record<string, any>>(attrs: T, clientOpId: string | null): T {
  if (!clientOpId) return attrs;
  return { ...attrs, clientOpId } as T;
}
