import { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { useAuth } from '../../hooks/use-auth';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { api } from '../../lib/api-client';
import { createReport } from '../../lib/pdf-report';
import { CycleDetailView } from './cycle-detail-view';
import { appendCycleDetailToReport } from './cycle-detail-pdf';

// Lightweight shapes for the hierarchy dropdown rows (the /api/hierarchy/*
// endpoints carry the parent id on each child: area.blockId, ahu.areaId,
// filter.ahuId).
interface HNode { id: string; name: string; status?: string; blockId?: string; areaId?: string; ahuId?: string; filterSet?: string | null; attributes?: Record<string, any>; }

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  IN_PROGRESS: { label: 'In Progress', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  COMPLETED: { label: 'Completed', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  TERMINATED: { label: 'Terminated', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
};

// Full-detail PDF guards (full detail = many round-trips + many pages).
const WARN_CYCLES = 100;   // confirm before generating beyond this
const MAX_CYCLES = 400;    // hard ceiling — steer to a smaller scope/period

/** GET all cycle summaries for one filter, paginated to exhaustion (the cycles
 *  endpoint caps limit at 100). Period-bounded when from/to provided. */
async function fetchAllCycleSummaries(filterId: string, fromIso: string, toIso: string): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  const limit = 100;
  while (page <= 100) {
    const u = new URLSearchParams({ filterId, page: String(page), limit: String(limit) });
    if (fromIso) u.set('from', fromIso);
    if (toIso) u.set('to', toIso);
    const res: any = await api.get(`/api/filters/cycles?${u.toString()}`);
    const batch: any[] = res?.data ?? [];
    all.push(...batch);
    const total: number = res?.total ?? all.length;
    if (batch.length === 0 || all.length >= total) break;
    page++;
  }
  return all;
}

/** Bounded-concurrency map that preserves input order in the output. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>, onProgress?: (done: number) => void): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
      done++;
      onProgress?.(done);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

const asc = (a: any, b: any) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();

/**
 * One cycle in the lifecycle accordion. Collapsed by default; on expand it
 * lazy-fetches the FULL detail (GET /api/filters/cycles/:id resolves checklist
 * Q&A text, AHU name, pinned versions — the list endpoint does not) and renders
 * it with the same <CycleDetailView> used by the View detail page.
 */
function CycleAccordionItem({ summary, index, formatDateTime }: {
  summary: any; index: number; formatDateTime: (s: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const { data: detail } = useSWR(open ? `/api/filters/cycles/${summary.id}` : null);
  const sc = STATUS_CONFIG[summary.status];
  const title = summary.cycleCode ?? summary.cleaningReasonLabel ?? summary.cleaningReasonKey ?? 'Cycle';

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left">
        <span className="text-[13px] font-bold text-slate-400 tabular-nums w-8 shrink-0">#{index + 1}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-slate-800 truncate">{title}</div>
          <div className="text-[11px] text-slate-400 tabular-nums">
            {formatDateTime(summary.startedAt)}{summary.completedAt ? ` → ${formatDateTime(summary.completedAt)}` : ''}
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full whitespace-nowrap ${sc?.bg ?? 'bg-slate-50'} ${sc?.text ?? 'text-slate-600'} border ${sc?.border ?? 'border-slate-200'}`}>
          {summary.status === 'IN_PROGRESS' && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
          {sc?.label ?? summary.status}
        </span>
        <svg className={`w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-slate-100 bg-slate-50/30 p-4">
          {!detail ? (
            <div className="flex items-center gap-2 text-[13px] text-slate-400 py-6 justify-center">
              <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /> Loading detail…
            </div>
          ) : (
            <CycleDetailView cycle={detail} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One filter's cycles in the scope. Lazy: fetches the filter's cycle summaries
 * only when expanded (and refetches when the period changes). For single-filter
 * scope it's open by default.
 */
function FilterCyclesGroup({ filter, fromIso, toIso, defaultOpen, formatDateTime }: {
  filter: HNode; fromIso: string; toIso: string; defaultOpen: boolean; formatDateTime: (s: string) => string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [cycles, setCycles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const all = await fetchAllCycleSummaries(filter.id, fromIso, toIso);
        if (!cancelled) { setCycles(all); setLoaded(true); }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load cycles');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, filter.id, fromIso, toIso]);

  const ordered = useMemo(() => [...cycles].sort(asc), [cycles]);

  return (
    <div className="border border-slate-200 rounded-xl bg-white">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left">
        <svg className="w-5 h-5 text-cyan-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-bold text-slate-800 truncate">{filter.name}</div>
          {filter.filterSet && <span className="text-[10px] font-semibold text-indigo-500">Set {filter.filterSet.replace('SET_', '')}</span>}
        </div>
        {loaded && <span className="text-[11px] text-slate-400">{ordered.length} cycle(s)</span>}
        <svg className={`w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-slate-100 p-3 space-y-2 bg-slate-50/30">
          {loading ? (
            <div className="flex items-center gap-2 text-[13px] text-slate-400 py-6 justify-center">
              <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /> Loading cycles…
            </div>
          ) : error ? (
            <div className="text-[13px] text-red-500 py-4 text-center">{error}</div>
          ) : ordered.length === 0 ? (
            <div className="text-[13px] text-slate-400 py-4 text-center">No cleaning cycles in this period.</div>
          ) : (
            ordered.map((c, idx) => (
              <CycleAccordionItem key={c.id} summary={c} index={idx} formatDateTime={formatDateTime} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function FilterLifecycleReportPage() {
  const { formatDateTime, formatDate } = useDatetimeFormat();
  const { user } = useAuth();
  const perms = (user?.permissions as string[] | undefined) ?? [];
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canExportPdf = isSuperAdmin || perms.includes('REPORT_EXPORT') || perms.includes('REPORT_GENERATE');

  // Hierarchy dropdown sources.
  const { data: blocksData } = useSWR<{ data: HNode[] }>('/api/hierarchy/blocks?limit=500');
  const { data: areasData } = useSWR<{ data: HNode[] }>('/api/hierarchy/areas?limit=500');
  const { data: ahusData } = useSWR<{ data: HNode[] }>('/api/hierarchy/ahus?limit=500');
  const { data: filtersData } = useSWR<{ data: HNode[] }>('/api/hierarchy/filters?limit=500');
  const allBlocks = blocksData?.data ?? [];
  const allAreas = areasData?.data ?? [];
  const allAhus = ahusData?.data ?? [];
  const allFilters = (filtersData?.data ?? []).filter((f) => f.status !== 'Retired');

  const [blockId, setBlockId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [ahuId, setAhuId] = useState('');
  const [filterId, setFilterId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);

  // Cascade option lists.
  const areaOptions = useMemo(
    () => allAreas.filter((a) => !blockId || a.blockId === blockId).sort((a, b) => a.name.localeCompare(b.name)),
    [allAreas, blockId],
  );
  const allowedAreaIds = useMemo(() => new Set(areaOptions.map((a) => a.id)), [areaOptions]);
  const ahuOptions = useMemo(
    () => allAhus
      .filter((a) => (areaId ? a.areaId === areaId : (!blockId || (a.areaId != null && allowedAreaIds.has(a.areaId)))))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [allAhus, areaId, blockId, allowedAreaIds],
  );
  const allowedAhuIds = useMemo(() => new Set(ahuOptions.map((a) => a.id)), [ahuOptions]);
  const filterOptions = useMemo(
    () => allFilters
      .filter((f) => (ahuId ? f.ahuId === ahuId : ((!blockId && !areaId) || (f.ahuId != null && allowedAhuIds.has(f.ahuId)))))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [allFilters, ahuId, blockId, areaId, allowedAhuIds],
  );

  const onBlock = (v: string) => { setBlockId(v); setAreaId(''); setAhuId(''); setFilterId(''); };
  const onArea = (v: string) => { setAreaId(v); setAhuId(''); setFilterId(''); };
  const onAhu = (v: string) => { setAhuId(v); setFilterId(''); };

  // Scope = deepest selection. The set of filters the report covers.
  const filtersInScope = useMemo<HNode[]>(() => {
    if (filterId) { const f = allFilters.find((x) => x.id === filterId); return f ? [f] : []; }
    if (ahuId || areaId || blockId) return filterOptions;
    return [];
  }, [filterId, ahuId, areaId, blockId, filterOptions, allFilters]);

  const scopeLabel = useMemo(() => {
    if (filterId) return allFilters.find((f) => f.id === filterId)?.name ?? 'Filter';
    if (ahuId) return `AHU ${allAhus.find((a) => a.id === ahuId)?.name ?? ''}`.trim();
    if (areaId) return `Area ${allAreas.find((a) => a.id === areaId)?.name ?? ''}`.trim();
    if (blockId) return `Block ${allBlocks.find((b) => b.id === blockId)?.name ?? ''}`.trim();
    return '';
  }, [filterId, ahuId, areaId, blockId, allFilters, allAhus, allAreas, allBlocks]);

  const fromIso = fromDate ? new Date(fromDate).toISOString() : '';
  const toIso = toDate ? new Date(toDate).toISOString() : '';
  const periodLine = fromDate || toDate
    ? `Period: ${fromDate ? formatDate(fromDate) : 'Start'} → ${toDate ? formatDate(toDate) : 'Now'}`
    : 'Period: All Time';

  const handleDownload = async () => {
    if (!filtersInScope.length) return;
    setDownloading(true);
    setProgress(null);
    setDownloadMsg(null);
    try {
      // 1. Cheap pass: gather cycle summaries per filter (period-bounded).
      const groups: { filter: HNode; summaries: any[] }[] = [];
      for (const f of filtersInScope) {
        const sums = (await fetchAllCycleSummaries(f.id, fromIso, toIso)).sort(asc);
        if (sums.length) groups.push({ filter: f, summaries: sums });
      }
      const flat = groups.flatMap((g) => g.summaries.map((s) => s.id as string));
      const total = flat.length;
      if (total === 0) { setDownloadMsg('No cleaning cycles found for this selection and period.'); return; }
      if (total > MAX_CYCLES) {
        setDownloadMsg(`This selection has ${total} cycles — too many for a full-detail PDF (limit ${MAX_CYCLES}). Narrow the period or pick a smaller scope (a single AHU or filter).`);
        return;
      }
      if (total > WARN_CYCLES && !window.confirm(`This will generate a full-detail report for ${total} cycles (one section each — a large PDF that may take a minute). Continue?`)) {
        return;
      }

      // 2. Fetch full detail for every cycle with bounded concurrency.
      setProgress({ done: 0, total });
      const details = await mapWithConcurrency(
        flat, 6,
        (cycleId) => api.get<any>(`/api/filters/cycles/${cycleId}`),
        (done) => setProgress({ done, total }),
      );
      const byId = new Map<string, any>();
      flat.forEach((id, idx) => byId.set(id, details[idx]));

      // 3. Build the grouped full-detail PDF.
      const report = await createReport({
        title: `${scopeLabel} — Cleaning Lifecycle Report`,
        subtitle: periodLine,
        orientation: 'portrait',
        formatDateTime,
      });
      // Each cycle starts on its own page (overflow flows to the next page;
      // a new cycle never shares a page with the previous one). The first cycle
      // uses page 1 below the report header; the filter header sits at the top
      // of that filter's first cycle page.
      let firstCycle = true;
      for (const g of groups) {
        let needFilterHeader = true;
        for (let i = 0; i < g.summaries.length; i++) {
          const s = g.summaries[i];
          const detail = byId.get(s.id);
          if (!detail) continue;
          if (!firstCycle) report.newPage();
          firstCycle = false;
          if (needFilterHeader) { report.addSectionTitle(`Filter: ${g.filter.name}`); needFilterHeader = false; }
          report.addSectionTitle(`Cycle ${i + 1} — ${formatDateTime(s.startedAt)}`);
          appendCycleDetailToReport(report, detail, { formatDateTime });
        }
      }
      const safeScope = scopeLabel.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'scope';
      report.save(`lifecycle-${safeScope}.pdf`);
    } catch (e: any) {
      setDownloadMsg(e?.message ?? 'Report generation failed.');
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  };

  const selectCls = 'w-full px-3 py-2 text-[13px] rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400 disabled:bg-slate-50 disabled:text-slate-400';
  const singleFilter = filtersInScope.length === 1;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-slate-100 bg-white shrink-0">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyan-600 to-cyan-700 shadow-lg shadow-cyan-600/10">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-6m4 6V7m4 10v-3M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800 tracking-tight">Filter Lifecycle Report</h1>
              <p className="text-[13px] text-slate-400">Pick a Block, Area, AHU or Filter — the report covers that scope, cycle by cycle.</p>
            </div>
          </div>
          <button
            onClick={handleDownload}
            disabled={!filtersInScope.length || downloading || !canExportPdf}
            title={!canExportPdf ? 'REPORT_EXPORT permission required' : !filtersInScope.length ? 'Select a scope first' : undefined}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg text-[13px] font-semibold hover:bg-cyan-700 shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {downloading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
                {progress ? `Generating ${progress.done}/${progress.total}…` : 'Preparing…'}
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                Download Report
              </>
            )}
          </button>
        </div>

        {/* Cascade selectors + period */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Block</label>
            <select className={selectCls} value={blockId} onChange={(e) => onBlock(e.target.value)}>
              <option value="">All Blocks</option>
              {[...allBlocks].sort((a, b) => a.name.localeCompare(b.name)).map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Area</label>
            <select className={selectCls} value={areaId} onChange={(e) => onArea(e.target.value)}>
              <option value="">All Areas</option>
              {areaOptions.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">AHU</label>
            <select className={selectCls} value={ahuId} onChange={(e) => onAhu(e.target.value)}>
              <option value="">All AHUs</option>
              {ahuOptions.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Filter</label>
            <select className={selectCls} value={filterId} onChange={(e) => setFilterId(e.target.value)}>
              <option value="">All in scope</option>
              {filterOptions.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">From</label>
            <input type="date" className={selectCls} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">To</label>
            <input type="date" className={selectCls} value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
        </div>
        {downloadMsg && (
          <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-[13px] text-amber-700">{downloadMsg}</div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {!filtersInScope.length ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <svg className="w-14 h-14 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            <span className="text-slate-400 font-medium text-[14px]">Select a Block, Area, AHU or Filter</span>
            <span className="text-[13px] text-slate-300">The report covers whatever scope you pick — block-wide down to a single filter.</span>
          </div>
        ) : (
          <>
            <div className="mb-3 text-[13px] text-slate-500">
              <span className="font-semibold text-slate-700">{scopeLabel}</span>
              <span className="ml-2">— {filtersInScope.length} filter(s) in scope · {periodLine.replace('Period: ', '')}</span>
            </div>
            <div className="space-y-2">
              {filtersInScope.map((f) => (
                <FilterCyclesGroup
                  key={f.id}
                  filter={f}
                  fromIso={fromIso}
                  toIso={toIso}
                  defaultOpen={singleFilter}
                  formatDateTime={formatDateTime}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
