import { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { useAuth } from '../../hooks/use-auth';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { api } from '../../lib/api-client';
import { createReport } from '../../lib/pdf-report';
import { CycleDetailView } from './cycle-detail-view';
import { appendCycleDetailToReport } from './cycle-detail-pdf';
import { exportToExcel } from '@/lib/excel-export';
import { ExportMenu } from '@/components/ExportMenu';
import { effectiveCycleStatus } from '../../lib/cleaning-cycle-report';

// Lightweight shapes for the hierarchy dropdown rows (the /api/hierarchy/*
// endpoints carry the parent id on each child: area.blockId, ahu.areaId,
// filter.ahuId). `retired` + effective `ahuId` (pre-retire parent) are added
// locally so retired filters can be scoped and flagged.
interface FNode { id: string; name: string; status?: string; ahuId?: string | null; filterSet?: string | null; retired?: boolean; }
interface HNode { id: string; name: string; status?: string; blockId?: string; areaId?: string; ahuId?: string; attributes?: Record<string, any>; }

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  IN_PROGRESS: { label: 'In Progress', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  COMPLETED: { label: 'Completed', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  TERMINATED: { label: 'Terminated', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  RETIRED: { label: 'Retired', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  REPLACED: { label: 'Replaced', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
};

// Full-detail PDF guards (full detail = many round-trips + many pages).
const WARN_CYCLES = 100;   // confirm before generating beyond this
const MAX_CYCLES = 400;    // hard ceiling — steer to a smaller scope/period

interface LifecycleEvent { at: string; by: string | null; label: string; remarks: string | null; kind: 'created' | 'replaced' | 'retired'; }

/** Retirement / replacement lifecycle events for one filter, period-filtered,
 *  oldest first. A replaced OLD filter shows "Replaced by …" (which already
 *  implies retirement) instead of a separate "Retired" row. */
function buildLifecycle(
  filterId: string,
  retireMap: Map<string, any>,
  replByOld: Map<string, any>,
  replByNew: Map<string, any>,
  fromIso: string, toIso: string,
): LifecycleEvent[] {
  const out: LifecycleEvent[] = [];
  const born = replByNew.get(filterId);
  if (born) out.push({ at: born.replacedAt, by: born.performedBy ?? null, label: `Created as replacement of ${born.oldFilterName ?? 'a previous filter'}`, remarks: born.remarks ?? null, kind: 'created' });
  const repl = replByOld.get(filterId);
  if (repl) out.push({ at: repl.replacedAt, by: repl.performedBy ?? null, label: `Replaced by ${repl.newFilterName ?? 'a new filter'}`, remarks: repl.remarks ?? null, kind: 'replaced' });
  else { const ret = retireMap.get(filterId); if (ret) out.push({ at: ret.retiredAt, by: ret.retiredBy ?? null, label: 'Retired', remarks: ret.remarks ?? null, kind: 'retired' }); }
  return out
    .filter((e) => e.at && (!fromIso || new Date(e.at) >= new Date(fromIso)) && (!toIso || new Date(e.at) <= new Date(toIso)))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

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

const LIFECYCLE_STYLE: Record<string, string> = {
  created: 'border-indigo-400 bg-indigo-50 text-indigo-700',
  replaced: 'border-purple-400 bg-purple-50 text-purple-700',
  retired: 'border-amber-400 bg-amber-50 text-amber-700',
};

function LifecycleEventRow({ ev, formatDateTime }: { ev: LifecycleEvent; formatDateTime: (s: string) => string }) {
  return (
    <div className={`rounded-xl border-l-4 px-4 py-2.5 ${LIFECYCLE_STYLE[ev.kind] ?? 'border-slate-300 bg-slate-50 text-slate-700'}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold">{ev.label}</span>
        <span className="text-[11px] tabular-nums opacity-80">{formatDateTime(ev.at)}</span>
      </div>
      <div className="text-[11px] opacity-80 mt-0.5">
        {ev.by ? `by ${ev.by}` : ''}{ev.remarks ? `${ev.by ? ' · ' : ''}${ev.remarks}` : ''}
      </div>
    </div>
  );
}

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
  const eff = effectiveCycleStatus(summary);
  const sc = STATUS_CONFIG[eff];
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
          {eff === 'IN_PROGRESS' && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
          {sc?.label ?? eff}
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
 * One filter's cycles + lifecycle events in the scope. Lazy: fetches the
 * filter's cycle summaries only when expanded (and refetches when the period
 * changes). For single-filter scope it's open by default.
 */
function FilterCyclesGroup({ filter, fromIso, toIso, defaultOpen, lifecycle, formatDateTime }: {
  filter: FNode; fromIso: string; toIso: string; defaultOpen: boolean; lifecycle: LifecycleEvent[]; formatDateTime: (s: string) => string;
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
          <div className="text-[14px] font-bold text-slate-800 truncate">
            {filter.name}
            {filter.retired && <span className="ml-2 text-[10px] font-semibold text-amber-600">(Retired)</span>}
          </div>
          {filter.filterSet && <span className="text-[10px] font-semibold text-indigo-500">Set {filter.filterSet.replace('SET_', '')}</span>}
        </div>
        {loaded && <span className="text-[11px] text-slate-400">{ordered.length} cycle(s){lifecycle.length ? ` · ${lifecycle.length} event(s)` : ''}</span>}
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
          ) : (ordered.length === 0 && lifecycle.length === 0) ? (
            <div className="text-[13px] text-slate-400 py-4 text-center">No cleaning cycles or lifecycle events in this period.</div>
          ) : (
            <>
              {ordered.map((c, idx) => (
                <CycleAccordionItem key={c.id} summary={c} index={idx} formatDateTime={formatDateTime} />
              ))}
              {lifecycle.length > 0 && (
                <div className="pt-1 space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">Lifecycle Events</div>
                  {lifecycle.map((ev, i) => <LifecycleEventRow key={i} ev={ev} formatDateTime={formatDateTime} />)}
                </div>
              )}
            </>
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
  // Lifecycle sources (ASSET_READ, same as the dropdowns). Bare arrays.
  const { data: retirementsData } = useSWR<any[]>('/api/filters/retirements');
  const { data: replacementsData } = useSWR<any[]>('/api/filters/replacements');

  const allBlocks = blocksData?.data ?? [];
  const allAreas = areasData?.data ?? [];
  const allAhus = ahusData?.data ?? [];

  // Retire/replace lookups.
  const retireMap = useMemo(() => new Map<string, any>((retirementsData ?? []).map((r) => [r.id, r])), [retirementsData]);
  const replByOld = useMemo(() => new Map<string, any>((replacementsData ?? []).filter((r) => r.oldFilterId).map((r) => [r.oldFilterId, r])), [replacementsData]);
  const replByNew = useMemo(() => new Map<string, any>((replacementsData ?? []).filter((r) => r.newFilterId).map((r) => [r.newFilterId, r])), [replacementsData]);

  // Combined filter universe: active (from hierarchy) + retired (detached, so
  // their effective AHU = preRetireParentId for scoping; labeled retired).
  const allFilters = useMemo<FNode[]>(() => {
    const active: FNode[] = (filtersData?.data ?? [])
      .filter((f) => f.status !== 'Retired')
      .map((f) => ({ id: f.id, name: f.name, status: f.status, ahuId: f.ahuId ?? null, filterSet: (f as any).filterSet ?? null, retired: false }));
    const retired: FNode[] = (retirementsData ?? []).map((r) => ({
      id: r.id, name: r.name, status: 'Retired', ahuId: r.preRetireParentId ?? null, filterSet: r.filterSet ?? null, retired: true,
    }));
    return [...active, ...retired];
  }, [filtersData, retirementsData]);

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
  const filtersInScope = useMemo<FNode[]>(() => {
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
      // 1. Cheap pass: cycle summaries + lifecycle events per filter (period-bounded).
      const groups: { filter: FNode; summaries: any[]; events: LifecycleEvent[] }[] = [];
      for (const f of filtersInScope) {
        const sums = (await fetchAllCycleSummaries(f.id, fromIso, toIso)).sort(asc);
        const events = buildLifecycle(f.id, retireMap, replByOld, replByNew, fromIso, toIso);
        if (sums.length || events.length) groups.push({ filter: f, summaries: sums, events });
      }
      const flat = groups.flatMap((g) => g.summaries.map((s) => s.id as string));
      const totalCycles = flat.length;
      const totalEvents = groups.reduce((n, g) => n + g.events.length, 0);
      if (totalCycles === 0 && totalEvents === 0) { setDownloadMsg('No cleaning cycles or lifecycle events found for this selection and period.'); return; }
      if (totalCycles > MAX_CYCLES) {
        setDownloadMsg(`This selection has ${totalCycles} cycles — too many for a full-detail PDF (limit ${MAX_CYCLES}). Narrow the period or pick a smaller scope (a single AHU or filter).`);
        return;
      }
      if (totalCycles > WARN_CYCLES && !window.confirm(`This will generate a full-detail report for ${totalCycles} cycles (one section each — a large PDF that may take a minute). Continue?`)) {
        return;
      }

      // 2. Fetch full detail for every cycle with bounded concurrency.
      let details: any[] = [];
      if (totalCycles > 0) {
        setProgress({ done: 0, total: totalCycles });
        details = await mapWithConcurrency(
          flat, 6,
          (cycleId) => api.get<any>(`/api/filters/cycles/${cycleId}`),
          (done) => setProgress({ done, total: totalCycles }),
        );
      }
      const byId = new Map<string, any>();
      flat.forEach((id, idx) => byId.set(id, details[idx]));

      // 3. Build the grouped report. Each cycle on its own page; the filter's
      //    lifecycle events (retire/replace) get their own page after its cycles.
      const report = await createReport({
        title: `${scopeLabel} — Cleaning Lifecycle Report`,
        subtitle: periodLine,
        orientation: 'portrait',
        formatDateTime,
        legend: [{ abbr: 'S.No', meaning: 'Serial Number' }],
      });
      let firstBlock = true;
      for (const g of groups) {
        let needFilterHeader = true;
        for (let i = 0; i < g.summaries.length; i++) {
          const s = g.summaries[i];
          const detail = byId.get(s.id);
          if (!detail) continue;
          if (!firstBlock) report.newPage();
          firstBlock = false;
          if (needFilterHeader) { report.addSectionTitle(`Filter: ${g.filter.name}${g.filter.retired ? ' (Retired)' : ''}`); needFilterHeader = false; }
          report.addSectionTitle(`Cycle ${i + 1} — ${formatDateTime(s.startedAt)}`);
          appendCycleDetailToReport(report, detail, { formatDateTime });
        }
        if (g.events.length) {
          if (!firstBlock) report.newPage();
          firstBlock = false;
          if (needFilterHeader) { report.addSectionTitle(`Filter: ${g.filter.name}${g.filter.retired ? ' (Retired)' : ''}`); needFilterHeader = false; }
          report.addSectionTitle('Lifecycle Events (Retirement / Replacement)');
          report.addTable({
            head: ['Event', 'Date', 'By', 'Remarks'],
            body: g.events.map((e) => [e.label, formatDateTime(e.at), e.by ?? '-', e.remarks ?? '-']),
            columnStyles: { 3: { cellWidth: 60 } },
          });
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

  // Excel = one flat sheet, one row per cleaning cycle across the scope (cheap
  // summaries pass — no per-cycle full-detail fetch).
  const exportExcel = async () => {
    if (!filtersInScope.length) return;
    setDownloading(true);
    setDownloadMsg(null);
    try {
      const head = ['Filter', 'S.No', 'Cycle', 'Started', 'Completed', 'Status', 'Reason'];
      const rows: string[][] = [];
      for (const f of filtersInScope) {
        const sums = (await fetchAllCycleSummaries(f.id, fromIso, toIso)).sort(asc);
        sums.forEach((s: any, i: number) => {
          const eff = effectiveCycleStatus(s);
          rows.push([
            f.name, String(i + 1), s.cycleCode ?? '-',
            s.startedAt ? formatDateTime(s.startedAt) : '-',
            s.completedAt ? formatDateTime(s.completedAt) : '-',
            STATUS_CONFIG[eff]?.label ?? eff,
            s.cleaningReasonLabel ?? s.cleaningReasonKey ?? '-',
          ]);
        });
      }
      if (rows.length === 0) { setDownloadMsg('No cleaning cycles found for this selection and period.'); return; }
      const safeScope = scopeLabel.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'scope';
      exportToExcel({ filename: `lifecycle-${safeScope}`, sheetName: 'Cleaning Cycles', head, rows });
    } catch (e: any) {
      setDownloadMsg(e?.message ?? 'Export failed.');
    } finally {
      setDownloading(false);
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
              <p className="text-[13px] text-slate-400">Pick a Block, Area, AHU or Filter — cleaning cycles + retirement / replacement, cycle by cycle.</p>
            </div>
          </div>
          {canExportPdf && filtersInScope.length > 0 && (
            <ExportMenu surface="lifecycle" onExportPdf={handleDownload} onExportExcel={exportExcel}
              busy={downloading}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg text-[13px] font-semibold hover:bg-cyan-700 shadow-sm transition-all disabled:opacity-40 shrink-0" />
          )}
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
              {filterOptions.map((f) => (<option key={f.id} value={f.id}>{f.name}{f.retired ? ' (Retired)' : ''}</option>))}
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
            <span className="text-[13px] text-slate-300">The report covers whatever scope you pick — block-wide down to a single filter. Retired filters are selectable too.</span>
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
                  lifecycle={buildLifecycle(f.id, retireMap, replByOld, replByNew, fromIso, toIso)}
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
