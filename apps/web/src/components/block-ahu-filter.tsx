import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { buildAhuBlockMap } from '@/lib/ahu-block-map';

/**
 * Block → AHU cascade scope filter, shared by the Replacement List and
 * Retirement List history pages.
 *
 * The row shape both lists expose (`blockId` / `ahuId`) is resolved
 * SERVER-side — see `filter-operations.service.ts.resolveAhuScopes`. Neither
 * list can derive it in the browser: a retired filter has had its `parentId`
 * nulled, and a replacement row is an audit record holding only two filter ids.
 *
 * Default is unscoped — these are compliance history pages, so with no
 * selection every row shows. Selecting a Block narrows to that block, and the
 * AHU dropdown then lists only that block's AHUs.
 */

export interface ScopedRow {
  blockId?: string | null;
  ahuId?: string | null;
}

interface HierarchyNode {
  id: string;
  name: string;
  blockId?: string | null;
  areaId?: string | null;
}

export interface BlockAhuScope {
  blockId: string;
  ahuId: string;
  setBlockId: (v: string) => void;
  setAhuId: (v: string) => void;
  /** Blocks for the first dropdown. */
  blocks: HierarchyNode[];
  /** AHUs for the second dropdown — narrowed to the selected block. */
  ahus: HierarchyNode[];
  /** True when either dropdown is set (drives empty-state wording). */
  isActive: boolean;
  /** Row predicate — AHU wins over Block when both are set. */
  matches: (row: ScopedRow) => boolean;
  /** e.g. `Block CWH › AHU-0B` — for the report subtitle. '' when unscoped. */
  scopeLabel: string;
  /** Clear both dropdowns. */
  reset: () => void;
}

export function useBlockAhuScope(): BlockAhuScope {
  // 21 blocks / 38 AHUs / 22 areas live (2026-08-20) — well inside the
  // hierarchy endpoints' 500-row cap. Areas are needed only to resolve AHUs
  // that hang off an Area rather than directly off a Block (Area is optional).
  const { data: blocksResp } = useSWR<{ data: HierarchyNode[] }>('/api/hierarchy/blocks');
  const { data: ahusResp } = useSWR<{ data: HierarchyNode[] }>('/api/hierarchy/ahus');
  const { data: areasResp } = useSWR<{ data: HierarchyNode[] }>('/api/hierarchy/areas');

  const blocks = useMemo(
    () => [...(blocksResp?.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [blocksResp],
  );
  const allAhus = useMemo(
    () => [...(ahusResp?.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [ahusResp],
  );
  const ahuBlockMap = useMemo(
    () => buildAhuBlockMap(allAhus, areasResp?.data ?? []),
    [allAhus, areasResp],
  );

  const [blockId, setBlockIdState] = useState('');
  const [ahuId, setAhuId] = useState('');

  // Changing the block always clears the AHU — leaving the previous block's AHU
  // selected would empty the table with no visible reason.
  const setBlockId = useCallback((v: string) => {
    setBlockIdState(v);
    setAhuId('');
  }, []);

  const reset = useCallback(() => {
    setBlockIdState('');
    setAhuId('');
  }, []);

  const ahus = useMemo(
    () => (blockId ? allAhus.filter(a => ahuBlockMap[a.id] === blockId) : allAhus),
    [allAhus, blockId, ahuBlockMap],
  );

  const matches = useCallback(
    (row: ScopedRow) => {
      if (ahuId) return row.ahuId === ahuId;
      if (blockId) return row.blockId === blockId;
      return true;
    },
    [blockId, ahuId],
  );

  const scopeLabel = useMemo(() => {
    const parts: string[] = [];
    const block = blocks.find(b => b.id === blockId);
    if (block) parts.push(`Block ${block.name}`);
    const ahu = allAhus.find(a => a.id === ahuId);
    if (ahu) parts.push(ahu.name);
    return parts.join(' › ');
  }, [blocks, allAhus, blockId, ahuId]);

  return {
    blockId, ahuId, setBlockId, setAhuId,
    blocks, ahus,
    isActive: !!blockId || !!ahuId,
    matches, scopeLabel, reset,
  };
}

/** The two dropdowns. Pass the object returned by `useBlockAhuScope()`. */
export function BlockAhuFilter({ scope, onChange }: {
  scope: BlockAhuScope;
  /** Called after either dropdown changes — pages use it to reset pagination. */
  onChange?: () => void;
}) {
  return (
    <>
      <ScopeSelect
        label="Block"
        allLabel="All blocks"
        value={scope.blockId}
        options={scope.blocks}
        onChange={v => { scope.setBlockId(v); onChange?.(); }}
      />
      <ScopeSelect
        label="AHU"
        allLabel={scope.blockId ? 'All AHUs in block' : 'All AHUs'}
        value={scope.ahuId}
        options={scope.ahus}
        onChange={v => { scope.setAhuId(v); onChange?.(); }}
      />
    </>
  );
}

function ScopeSelect({ label, allLabel, value, options, onChange }: {
  label: string;
  allLabel: string;
  value: string;
  options: HierarchyNode[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-[160px]">
      <label className="text-xs font-semibold text-slate-500">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 focus:border-brand-600 focus:ring-3 focus:ring-brand-600/15 focus:bg-white outline-none transition-all"
      >
        <option value="">{allLabel}</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
}
