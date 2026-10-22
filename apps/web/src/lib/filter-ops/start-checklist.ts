/**
 * The questions of the checklists between START and the first stage
 * (2026-10-22), resolved BEFORE the cycle is started — the dialog comes first
 * and nothing is written until it is answered.
 *
 * Which checklists: `startChecklistProfileIds` over the filter's state (the
 * pipeline graph current-state carries before a cycle starts, cached per filter).
 * Their questions: the cached `checklist-profiles` list, refetched once when a
 * profile or its questions are missing — the same call and gate
 * resolveChecklistForTargetStage uses (FILTER_OPERATE may read it).
 *
 * `[]` when there is none, or when it cannot be resolved (the caller must then
 * not start the filter without it: planStartChecklistBatch leaves it queued).
 * `profileVersion` is the live version, which is what start-cycle pins.
 */
import { ALL_ROWS } from '../page-size';
import { cacheData, getCachedData, OFFLINE_TTL_MS } from '@/lib/offline-store';
import { apiClient } from '@/lib/api-client';
import { startChecklistProfileIds } from './batch-plan';
import type { PendingChecklist } from './types';

function rowsFor(ids: string[], profiles: any[]): PendingChecklist[] | null {
  const rows: PendingChecklist[] = [];
  for (const id of ids) {
    const p = profiles.find((x: any) => x.id === id && x.isActive !== false);
    if (!p || !Array.isArray(p.questions) || p.questions.length === 0) return null;
    rows.push({
      pipelineNodeId: `START-${id}`,
      checklistProfileId: id,
      checklistProfileName: p.name,
      profileVersion: p.version,
      questions: p.questions.slice().sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    });
  }
  return rows;
}

export async function resolveStartChecklists(state: any, online: boolean): Promise<PendingChecklist[]> {
  const ids = startChecklistProfileIds(state);
  if (ids.length === 0) return [];
  const cached = rowsFor(ids, (await getCachedData<any[]>('checklist-profiles')) ?? []);
  if (cached) return cached;
  if (!online) return [];
  let list: any;
  try {
    const res = await apiClient.get<any>(`/api/checklist-profiles?limit=${ALL_ROWS}&isActive=true&expand=questions`);
    list = res?.data ?? res;
  } catch {
    return []; // not resolvable now: the caller keeps the filter queued
  }
  if (!Array.isArray(list)) return [];
  await cacheData('checklist-profiles', list, OFFLINE_TTL_MS);
  return rowsFor(ids, list) ?? [];
}
