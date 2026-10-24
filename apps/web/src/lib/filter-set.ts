/**
 * Filter set code → screen label (2026-10-24). The API stores `SET_A` / `SET_B`;
 * the stage-approval details, the Filter Data Management table and the hierarchy
 * diagram printed that code (or "SET A") as is. Anything else (a legacy value)
 * is shown unchanged, empty → the caller's placeholder.
 */
export function formatFilterSet(set: string | null | undefined, empty = '—'): string {
  if (!set) return empty;
  const m = /^SET_([A-Z0-9]+)$/i.exec(set.trim());
  return m ? `Set ${m[1].toUpperCase()}` : set;
}
