/**
 * Filter Operations — leaf helpers extracted from filter-operations.service.ts.
 *
 * Pure / side-effecting helper functions that the service file used at
 * top-level scope. Split out so the orchestrator class is easier to read.
 * No behavioral changes — these are byte-equivalent moves.
 */
import { createHash } from 'node:crypto';
import type { LocalContext } from '@digilog/shared';
import * as executor from '@digilog/shared';
import { prisma } from '../../lib/prisma.js';

export function computeChecksum(data: Record<string, unknown>): string {
  const canonical = JSON.stringify(data, Object.keys(data).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Format a Date as its LOCAL calendar day 'YYYY-MM-DD' — server-local is the
 * site's local time on this single-site local-Windows deployment.
 *
 * Used for the filter's `lastCleaningDate` stamp. `toISOString().slice(0,10)`
 * yields the UTC day, which is off-by-one for the operator near local midnight:
 * a cleaning completed 02:00 IST (UTC+5:30) has an ISO instant of the PREVIOUS
 * calendar day, so "Last Cleaned" recorded yesterday. `getFullYear/getMonth/
 * getDate` read local-time components, so this reflects the operator's real day.
 */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Pretty-print a stateKey like "WASH_IN" → "Wash In" for operator-facing error messages. */
export function prettyStageLabel(stateKey: string | null | undefined): string {
  if (!stateKey) return 'this stage';
  return stateKey
    .split('_')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Walk the pipeline from a given stage and collect CHECKLIST nodes
 * that sit between it and the next STAGE/END node.
 */
export function collectChecklistsAfterStage(
  stage: any,
  allStages: any[],
  connections: any[],
): any[] {
  // ONE implementation (2026-10-22): this was a copy of the shared walker, and
  // both copies pushed a CHECKLIST reached a second time (a loop) twice. Same
  // walk, same order; returns the caller's own (Prisma) node objects.
  return executor.collectChecklistsAfterStage(stage, allStages, connections);
}

/**
 * Ids of the checklist profiles referenced by `stages` (CHECKLIST nodes) that
 * are DISABLED right now. A disabled checklist is skipped wherever it sits in
 * the pipeline (2026-10-12) — this is the server's one read of that fact, fed
 * to `LocalContext.disabledChecklistProfileIds` and to the current-state
 * response the tablet caches for offline work. Live, not pinned: switching a
 * checklist off affects cycles already running.
 */
export async function loadDisabledChecklistProfileIds(
  stages: Array<{ nodeType: string; configuration: unknown }>,
): Promise<string[]> {
  const ids = [...new Set(
    stages
      .filter(s => s.nodeType === 'CHECKLIST')
      .map(s => (s.configuration as { checklistProfileId?: unknown } | null)?.checklistProfileId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  )];
  if (ids.length === 0) return [];
  const rows = await prisma.checklistProfile.findMany({
    where: { id: { in: ids }, isActive: false },
    select: { id: true },
  });
  return rows.map(r => r.id);
}

/**
 * Ids of the ACTIVE checklist profiles named by the CHECKLIST nodes right after
 * `stage` — the checklists still to be answered there. A node whose checklist is
 * disabled or no longer exists asks nothing. The one server read of "does a
 * checklist follow this stage" for completion decisions: advance() (does this
 * advance complete the cycle, or does the checklist) and the QA approval of a
 * final gated stage (does the approval complete it, 2026-10-22).
 */
export async function activeChecklistIdsAfterStage(
  stage: any,
  allStages: any[],
  connections: any[],
): Promise<string[]> {
  const ids = [...new Set(
    collectChecklistsAfterStage(stage, allStages, connections)
      .map(n => (n.configuration as { checklistProfileId?: unknown } | null)?.checklistProfileId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  )];
  if (ids.length === 0) return [];
  const active = await prisma.checklistProfile.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true },
  });
  return active.map(a => a.id);
}

/**
 * The disabled checklists that sit after each of `afterStages` in the
 * context's pipeline, named for the event record (`skippedChecklists`). Empty
 * when none is disabled — the common case costs no query.
 */
export async function describeSkippedChecklists(
  ctx: LocalContext,
  afterStages: string[],
): Promise<Array<{ checklistProfileId: string; checklistProfileName: string; afterStage: string; reason: 'DISABLED' }>> {
  const disabled = new Set(ctx.disabledChecklistProfileIds ?? []);
  if (disabled.size === 0 || afterStages.length === 0) return [];
  const hits: Array<{ checklistProfileId: string; afterStage: string }> = [];
  for (const afterStage of [...new Set(afterStages)]) {
    const stage = ctx.profile.nodes.find(n => n.nodeType === 'STAGE' && n.stateKey === afterStage);
    if (!stage) continue;
    for (const node of executor.collectChecklistsAfterStage(stage, ctx.profile.nodes, ctx.profile.edges)) {
      const id = executor.checklistNodeProfileId(node);
      if (id && disabled.has(id)) hits.push({ checklistProfileId: id, afterStage });
    }
  }
  if (hits.length === 0) return [];
  const names = new Map(
    (await prisma.checklistProfile.findMany({
      where: { id: { in: [...new Set(hits.map(h => h.checklistProfileId))] } },
      select: { id: true, name: true },
    })).map(r => [r.id, r.name]),
  );
  return hits.map(h => ({
    ...h,
    checklistProfileName: names.get(h.checklistProfileId) ?? '(unknown checklist)',
    reason: 'DISABLED' as const,
  }));
}

/**
 * Resolve checklist questions for CHECKLIST pipeline nodes.
 *
 * Phase A.1: when `versionPins` is provided (cycle's pinned-version map), we
 * resolve questions through the immutable ChecklistProfileVersion snapshot
 * for that exact version. Edits to the live profile after the cycle started
 * have NO effect on the questions the operator sees. When `versionPins` is
 * not provided (legacy cycles started before this column existed, or
 * out-of-cycle preview), we fall back to live profile resolution.
 */
export async function resolveChecklistQuestions(
  checklistNodes: any[],
  versionPins?: Record<string, number> | null,
): Promise<any[]> {
  const profileIds = [...new Set(
    checklistNodes.map(n => (n.configuration as any)?.checklistProfileId).filter(Boolean),
  )];
  if (profileIds.length === 0) return [];

  // Resolve from pinned versions where pinned, live profile otherwise.
  type ResolvedProfile = { id: string; name: string; version: number; questions: any[] };
  const resolved = new Map<string, ResolvedProfile>();

  // 1. Pinned-version resolution: load each pin from ChecklistProfileVersion.
  const pinnedIds: string[] = [];
  if (versionPins) {
    for (const id of profileIds) {
      if (typeof versionPins[id] === 'number') pinnedIds.push(id);
    }
  }
  if (pinnedIds.length > 0) {
    const versions = await prisma.checklistProfileVersion.findMany({
      where: {
        OR: pinnedIds.map(id => ({ profileId: id, versionNumber: versionPins![id] })),
      },
    });
    for (const v of versions) {
      const snap = (v.snapshot as any) ?? {};
      resolved.set(v.profileId, {
        id: v.profileId,
        name: snap.name ?? '(unnamed)',
        version: v.versionNumber,
        questions: Array.isArray(snap.questions) ? snap.questions : [],
      });
    }
  }

  // 2. Live fallback for any unresolved IDs (legacy cycles, out-of-cycle previews).
  const unresolvedIds = profileIds.filter(id => !resolved.has(id));
  if (unresolvedIds.length > 0) {
    const profiles = await prisma.checklistProfile.findMany({
      where: { id: { in: unresolvedIds } },
      include: { questions: { orderBy: { sortOrder: 'asc' } } },
    });
    for (const p of profiles) {
      resolved.set(p.id, {
        id: p.id,
        name: p.name,
        version: p.version,
        questions: p.questions,
      });
    }
  }

  const result: any[] = [];
  for (const node of checklistNodes) {
    const checklistProfileId = (node.configuration as any)?.checklistProfileId;
    const profile = checklistProfileId ? resolved.get(checklistProfileId) : undefined;
    if (!profile) continue;

    result.push({
      pipelineNodeId: node.id,
      checklistProfileId: profile.id,
      checklistProfileName: profile.name,
      profileVersion: profile.version,
      questions: profile.questions.map((q: any) => ({
        id: q.id,
        question: q.question,
        questionType: q.questionType,
        required: q.required,
        section: q.section ?? null,
        description: q.description ?? null,
        options: q.options ?? [],
        validation: q.validation ?? {},
        sortOrder: q.sortOrder,
      })),
    });
  }
  return result;
}
