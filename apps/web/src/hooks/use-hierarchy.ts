import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';

/**
 * Wave 3 (asset-removal) — frontend read hook for the new typed-table
 * hierarchy endpoints landed in Wave 2.
 *
 * Hits `GET /api/hierarchy/tree` and returns the nested
 * Block → Area → AHU → Filter structure. Existing pages still read from
 * the legacy AssetInstance routes; this hook is the bridge for new pages
 * that want to consume the typed-table read path directly.
 */

export type HierarchyFilter = {
  id: string;
  name: string;
  status: string;
  currentLifecycleState: string | null;
};

export type HierarchyAhu = {
  id: string;
  name: string;
  status: string;
  areaId?: string | null;
  blockId?: string | null;
  filters: HierarchyFilter[];
};

export type HierarchyArea = {
  id: string;
  name: string;
  status: string;
  ahus: HierarchyAhu[];
};

export type HierarchyBlock = {
  id: string;
  name: string;
  status: string;
  areas: HierarchyArea[];
  /** A-01 T2.2: AHUs parented directly by the block (no area level). */
  ahus: HierarchyAhu[];
};

/**
 * Audit 2026-09-24: `GET /api/hierarchy/tree` returns a BARE ARRAY of blocks
 * (see the route's response schema), never `{ blocks }`. The hook used to
 * declare `{ blocks: HierarchyBlock[] }`, so every consumer reading
 * `data.blocks` got undefined and the preview page crashed on `.length`.
 * The hook now normalises to this envelope so callers keep one shape.
 */
export type HierarchyTree = {
  blocks: HierarchyBlock[];
};

export function useHierarchy() {
  const { data, error, isLoading, mutate } = useSWR<HierarchyTree>(
    '/api/hierarchy/tree',
    // Explicit fetcher (rather than relying on the global SWRConfig
    // default) so this hook is self-contained and unambiguous about
    // going through apiClient — same auth/hard-cutoff/error-mapping
    // path every other authenticated read in the app uses.
    async (url: string) => {
      const raw = await apiClient.get<HierarchyBlock[] | HierarchyTree>(url);
      const blocks = Array.isArray(raw) ? raw : (raw?.blocks ?? []);
      return {
        blocks: blocks.map((b) => ({
          ...b,
          areas: (b.areas ?? []).map((a) => ({
            ...a,
            ahus: (a.ahus ?? []).map((h) => ({ ...h, filters: h.filters ?? [] })),
          })),
          ahus: (b.ahus ?? []).map((h) => ({ ...h, filters: h.filters ?? [] })),
        })),
      };
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    },
  );

  return { data, error, isLoading, mutate };
}
