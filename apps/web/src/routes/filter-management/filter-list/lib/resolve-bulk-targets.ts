// Pure helper resolving which filters a bulk action actually operates on.
//
// The selection Set survives changes to the search box / block / diagram
// filter, but the list only ever RENDERS the narrowed `blockFilters`. Acting
// on the raw Set therefore let a bulk retire/replace/status-update hit filters
// the operator could not see — e.g. search "AHU-1", Select All, retype
// "AHU-2", confirm, and the ten invisible AHU-1 filters were retired.
//
// Narrowing to the intersection is the least-surprise rule: a destructive
// action may only touch rows currently on screen. The dialogs derive their
// list AND their count from this same value, so what the operator is told is
// exactly what happens.
export function resolveBulkTargets<T extends { id: string }>(
  selectedIds: Set<string>,
  visibleFilters: T[],
): T[] {
  return visibleFilters.filter(f => selectedIds.has(f.id));
}
