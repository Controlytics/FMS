/**
 * Pure planning for the SUPER_ADMIN edit of one RFID Track Record row
 * (2026-09-05). The Track Record is reconstructed from `audit_trail` rows
 * (ASSET_IDENTIFIER_CREATED = Assigned, ASSET_IDENTIFIER_DELETED = Removed), so
 * an edit is an edit of an audit row - which breaks the hash chain from that
 * row onward, permanently and by operator decision - and, when the row is the
 * tag's LATEST event, a correction of the live `asset_identifiers` row too.
 *
 * Kept free of Prisma so the two rules that matter can be unit-tested:
 *   1. which side of the row carries the identifier payload (afterValue for an
 *      Assigned row, beforeValue for a Removed row) and how it moves when the
 *      event type is flipped;
 *   2. when a history edit is allowed to touch the live tag. Only the latest
 *      event for a tag number describes its present state; editing an older
 *      Assigned row must never re-assign a tag that was removed later.
 */
import { ConflictError } from '../../lib/errors.js';

export const RFID_EVENT_ACTIONS = ['ASSET_IDENTIFIER_CREATED', 'ASSET_IDENTIFIER_DELETED'] as const;
export type RfidEvent = 'ASSIGN' | 'REMOVE';

export interface RfidEventRow {
  id: string;
  action: string;
  timestamp: Date;
  userId: string | null;
  userName: string | null;
  reason: string | null;
  beforeValue: unknown;
  afterValue: unknown;
}

export interface RfidEventChanges {
  timestamp?: Date;
  event?: RfidEvent;
  rfidNumber?: string;
  filterId?: string;
  /** Resolved by the caller from filterId (the payload is self-describing). */
  filterName?: string | null;
  userId?: string | null;
  userName?: string | null;
  remarks?: string | null;
}

export interface RfidEventPlan {
  /** Prisma update data for the audit row. */
  data: {
    action: string;
    timestamp: Date;
    userId: string | null;
    userName: string | null;
    reason: string | null;
    beforeValue: unknown;
    afterValue: unknown;
  };
  oldEvent: RfidEvent;
  newEvent: RfidEvent;
  oldValue: string;
  newValue: string;
  oldAssetId: string | null;
  newAssetId: string | null;
}

export function eventOf(action: string): RfidEvent {
  return action === 'ASSET_IDENTIFIER_CREATED' ? 'ASSIGN' : 'REMOVE';
}

/** The identifier payload lives on the side that still had the tag. */
export function payloadOf(row: Pick<RfidEventRow, 'action' | 'beforeValue' | 'afterValue'>): Record<string, unknown> {
  const side = eventOf(row.action) === 'ASSIGN' ? row.afterValue : row.beforeValue;
  return (side && typeof side === 'object' ? side : {}) as Record<string, unknown>;
}

export function planRfidEventEdit(row: RfidEventRow, changes: RfidEventChanges): RfidEventPlan {
  const oldEvent = eventOf(row.action);
  const payload = payloadOf(row);
  const oldValue = String(payload.identifierValue ?? '');
  const oldAssetId = (payload.assetId as string | undefined) ?? null;

  const newEvent = changes.event ?? oldEvent;
  const newValue = (changes.rfidNumber !== undefined ? changes.rfidNumber.trim() : oldValue) || oldValue;
  const newAssetId = changes.filterId !== undefined ? changes.filterId : oldAssetId;

  // Carry every stored key (identifier id, label, isPrimary, createdAt...) and
  // overwrite only what the operator changed, so the row stays self-describing.
  const nextPayload: Record<string, unknown> = {
    ...payload,
    identifierType: 'RFID',
    identifierValue: newValue,
    assetId: newAssetId,
    ...(changes.filterName !== undefined ? { filterName: changes.filterName } : {}),
  };

  const beforeValue = newEvent === 'ASSIGN' ? null : nextPayload;
  const afterValue = newEvent === 'ASSIGN' ? nextPayload : { deleted: true };

  const remarks = changes.remarks === undefined ? row.reason : (changes.remarks?.trim() || null);

  return {
    data: {
      action: newEvent === 'ASSIGN' ? 'ASSET_IDENTIFIER_CREATED' : 'ASSET_IDENTIFIER_DELETED',
      timestamp: changes.timestamp ?? row.timestamp,
      userId: changes.userId !== undefined ? changes.userId : row.userId,
      userName: changes.userName !== undefined ? changes.userName : row.userName,
      reason: remarks,
      beforeValue,
      afterValue,
    },
    oldEvent, newEvent, oldValue, newValue, oldAssetId, newAssetId,
  };
}

export interface LiveTagContext {
  /** No later Assigned/Removed row mentions the NEW tag number. */
  latestForNew: boolean;
  /** No later Assigned/Removed row mentions the OLD tag number (same as latestForNew when unchanged). */
  latestForOld: boolean;
  /** Live asset_identifiers row currently holding the OLD number, if any. */
  existingByOld: { id: string; assetId: string } | null;
  /** Live asset_identifiers row currently holding the NEW number, if any. */
  existingByNew: { id: string; assetId: string } | null;
  /** A DIFFERENT live tag already on the target filter (one tag per filter). */
  targetOtherTag: { id: string; identifierValue: string } | null;
  targetFilterName?: string | null;
}

export type LiveTagAction =
  | { kind: 'none'; note: string }
  | { kind: 'update'; identifierId: string; identifierValue: string; assetId: string; note: string }
  | { kind: 'create'; identifierValue: string; assetId: string; note: string }
  | { kind: 'delete'; identifierIds: string[]; note: string };

/**
 * What the live tag table should do after the history row changes. Throws
 * ConflictError for the two states that cannot be made consistent silently.
 */
export function decideLiveTag(plan: RfidEventPlan, ctx: LiveTagContext): LiveTagAction {
  const { newEvent, oldValue, newValue, newAssetId } = plan;
  const valueChanged = oldValue !== newValue;

  if (newEvent === 'ASSIGN') {
    if (!ctx.latestForNew || (valueChanged && ctx.existingByOld && !ctx.latestForOld)) {
      return { kind: 'none', note: 'History row only - a later event describes the current state of this tag.' };
    }
    if (!newAssetId) return { kind: 'none', note: 'No filter on the row; live tag left unchanged.' };
    // The live row this event is entitled to move: the one holding the OLD
    // number, provided this row is still that number's latest event. With an
    // unchanged number the caller passes the same live row on both sides.
    const ownRow = ctx.existingByOld && (!valueChanged || ctx.latestForOld) ? ctx.existingByOld : null;
    if (ctx.existingByNew && ctx.existingByNew.assetId !== newAssetId && ctx.existingByNew.id !== ownRow?.id) {
      throw new ConflictError(`Tag ${newValue} is live on another filter - remove it there first.`, 'DUPLICATE_IDENTIFIER_VALUE');
    }
    if (ctx.targetOtherTag) {
      throw new ConflictError(
        `${ctx.targetFilterName ?? 'The target filter'} already has tag ${ctx.targetOtherTag.identifierValue} - remove it first.`,
        'ENTITY_HAS_IDENTIFIER',
      );
    }
    if (ownRow && (valueChanged || ownRow.assetId !== newAssetId)) {
      return { kind: 'update', identifierId: ownRow.id, identifierValue: newValue, assetId: newAssetId, note: 'Live tag moved to match the edited assignment.' };
    }
    if (!ctx.existingByNew) {
      return { kind: 'create', identifierValue: newValue, assetId: newAssetId, note: 'Live tag created to match the edited assignment.' };
    }
    return { kind: 'none', note: 'Live tag already matches.' };
  }

  // REMOVE: the tag must not be live any more - for the old number (if this
  // row was its latest event) and for the new one.
  const ids: string[] = [];
  if (ctx.latestForNew && ctx.existingByNew) ids.push(ctx.existingByNew.id);
  if (valueChanged && ctx.latestForOld && ctx.existingByOld && !ids.includes(ctx.existingByOld.id)) ids.push(ctx.existingByOld.id);
  if (ids.length === 0) {
    return { kind: 'none', note: ctx.latestForNew ? 'No live tag to remove.' : 'History row only - a later event describes the current state of this tag.' };
  }
  return { kind: 'delete', identifierIds: ids, note: 'Live tag removed to match the edited record.' };
}
