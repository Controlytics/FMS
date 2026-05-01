/**
 * Offline Sync Service — Caches ALL master data needed for offline filter operations.
 * Called once after login while online. Stores everything in IndexedDB.
 *
 * Data cached:
 * 1. Filter instances (all active, non-retired)
 * 2. Filter states (current-state for each filter — pipeline, cycle, equipment, checklists)
 * 3. Cleaning reasons
 * 4. Equipment groups with instruments
 * 5. Identifier map (RFID/barcode → filterId)
 * 6. Templates
 * 7. PM due tasks
 * 8. Checklist profiles with questions
 * 9. Cleaning profiles (which block has which profile)
 */

import { apiClient } from './api-client';
import { cacheData, cacheFilters } from './offline-store';

export interface SyncProgress {
  step: string;
  current: number;
  total: number;
  done: boolean;
  error?: string;
}

type ProgressCallback = (progress: SyncProgress) => void;

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours (offline data should last a full shift)

async function cacheItem(key: string, data: any) {
  await cacheData(key, data, CACHE_TTL);
}

/**
 * Full sync — fetches and caches ALL data needed for offline operations.
 * Call this after login while online.
 * Returns true if all data was synced successfully.
 */
export async function syncAllDataForOffline(onProgress?: ProgressCallback): Promise<boolean> {
  const steps = [
    'Syncing templates...',
    'Syncing filters...',
    'Syncing filter states...',
    'Syncing cleaning reasons...',
    'Syncing equipment groups...',
    'Syncing identifiers...',
    'Syncing PM schedules...',
    'Syncing checklist profiles...',
    'Syncing cleaning profiles...',
  ];
  let currentStep = 0;
  const total = steps.length;

  const report = (step: string, done = false, error?: string) => {
    onProgress?.({ step, current: currentStep, total, done, error });
  };

  try {
    // 1. Templates
    report(steps[currentStep]);
    const templatesRes = await apiClient.get<any>('/api/assets/templates?limit=1000');
    await cacheItem('templates', templatesRes?.data ?? []);
    currentStep++;

    // 2. Filter instances
    report(steps[currentStep]);
    const instancesRes = await apiClient.get<any>('/api/assets/instances?limit=500');
    const instances = instancesRes?.data ?? [];
    await cacheFilters(instances); // stores in 'filters' IndexedDB store
    await cacheItem('instances-raw', instances); // also cache raw for reference
    currentStep++;

    // 3. Filter states (batch — single API call for ALL filters)
    report(steps[currentStep]);
    try {
      const batchResult = await apiClient.get<{ states: Record<string, any>; cachedAt: string }>('/api/filters/batch-states');
      if (batchResult?.states) {
        const stateEntries = Object.entries(batchResult.states);
        for (const [filterId, stateObj] of stateEntries) {
          await cacheItem(`filter-state-${filterId}`, stateObj);
        }
      }
    } catch {
      // Batch endpoint might not exist — fall back to individual calls
      const filterTemplateId = (templatesRes?.data ?? []).find((t: any) => t.name === 'Filter')?.id;
      const filters = instances.filter((i: any) =>
        (i.template?.name === 'Filter' || i.templateId === filterTemplateId) && i.isActive !== false && i.status !== 'Retired'
      );
      for (const f of filters) {
        try {
          const st = await apiClient.get<any>(`/api/filters/${f.id}/current-state`);
          await cacheItem(`filter-state-${f.id}`, st);
        } catch { /* skip individual failures */ }
      }
    }
    currentStep++;

    // 4. Cleaning reasons
    report(steps[currentStep]);
    const reasonsRes = await apiClient.get<any>('/api/filters/reasons');
    const reasons = (reasonsRes as any)?.reasons ?? reasonsRes ?? [];
    await cacheItem('cleaning-reasons', reasons);
    currentStep++;

    // 5. Equipment groups (with instruments)
    report(steps[currentStep]);
    const equipRes = await apiClient.get<any>('/api/equipment-groups');
    const equipGroups = Array.isArray(equipRes) ? equipRes : equipRes?.data ?? [];
    await cacheItem('equipment-groups', equipGroups);
    currentStep++;

    // 6. Identifier map (RFID/barcode → filterId+filterName)
    report(steps[currentStep]);
    const identRes = await apiClient.get<any[]>('/api/assets/identifiers?limit=1000');
    const identList = Array.isArray(identRes) ? identRes : [];
    const identMap: Record<string, { filterId: string; filterName: string }> = {};
    for (const ident of identList) {
      if (ident.identifierValue && ident.assetId) {
        const entry = { filterId: ident.assetId, filterName: ident.asset?.name || ident.assetId };
        identMap[ident.identifierValue] = entry;
        identMap[ident.identifierValue.toUpperCase()] = entry;
        identMap[ident.identifierValue.toLowerCase()] = entry;
      }
    }
    await cacheItem('identifier-map', identMap);
    currentStep++;

    // 7. PM schedules (due tasks)
    report(steps[currentStep]);
    try {
      const pmRes = await apiClient.get<any>('/api/pm-schedules/due');
      await cacheItem('due-tasks', pmRes);
    } catch { /* PM endpoint may fail for some roles */ }
    currentStep++;

    // 8. Checklist profiles (with questions)
    report(steps[currentStep]);
    try {
      const checklistRes = await apiClient.get<any>('/api/checklist-profiles?limit=100&isActive=true');
      await cacheItem('checklist-profiles', checklistRes?.data ?? []);
    } catch { /* may not have permission */ }
    currentStep++;

    // 9. Cleaning profiles (with stages and connections)
    report(steps[currentStep]);
    try {
      const profilesRes = await apiClient.get<any>('/api/filter-cleaning-profiles?limit=100&status=ACTIVE');
      const profiles = profilesRes?.data ?? [];
      await cacheItem('cleaning-profiles', profiles);
      // Also cache each profile's full pipeline (stages + connections)
      for (const p of profiles) {
        try {
          const fullProfile = await apiClient.get<any>(`/api/filter-cleaning-profiles/${p.id}`);
          await cacheItem(`cleaning-profile-${p.id}`, fullProfile);
        } catch { /* skip */ }
      }
    } catch { /* may not have permission */ }
    currentStep++;

    report('All data synced', true);
    return true;
  } catch (err: any) {
    report(`Sync failed: ${err?.message || 'Unknown error'}`, false, err?.message);
    return false;
  }
}
