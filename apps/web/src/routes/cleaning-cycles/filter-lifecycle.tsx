import { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { useCan } from '../../hooks/use-can';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { api } from '../../lib/api-client';
import { createReport } from '../../lib/pdf-report';
import { CycleDetailView } from './cycle-detail-view';
import { appendCycleDetailToReport } from './cycle-detail-pdf';
import { exportToExcel } from '@/lib/excel-export';
import { ExportMenu } from '@/components/ExportMenu';
import { SendForReviewButton } from '@/components/SendForReviewButton';
import { cycleEndInfo, effectiveCycleStatus, performerLabel } from '../../lib/cleaning-cycle-report';
import { logReportExportOrWarn } from '@/lib/report-export-log';
import { startOfDayIso, endOfDayIso } from '@/lib/datetime-input';
import { useExportLimit } from '@/hooks/use-export-limit';
import { useToast } from '@/hooks/use-toast';
import { DateRangeFilter } from '@/components/ui/date-range-filter';
import { downloadName } from '@/lib/download-name';
import { PencilIcon, useIsSuperAdmin } from '@/components/super-admin-record-edit';
import { SuperAdminCycleEditDialog } from '@/components/super-admin-cycle-edit';

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

/** GET all manual status changes for one filter (cycleId=null STATE_TRANSITIONs).
 *  These don't belong to a cleaning cycle, so the report shows them in their own
 *  section — otherwise a manually-moved filter looks like it has no history. */
async function fetchManualChanges(filterId: string, fromIso: string, toIso: string): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  const limit = 100;
  while (page <= 100) {
    const u = new URLSearchParams({ filterId, page: String(page), limit: String(limit) });
    if (fromIso) u.set('from', fromIso);
    if (toIso) u.set('to', toIso);
    const res: any = await api.get(`/api/filters/manual-status-changes?${u.toString()}`);
    const batch: any[] = res?.data ?? [];
    all.push(...batch);
    const total: number = res?.total ?? all.length;
    if (batch.length === 0 || all.length >= total) break;
    page++;
  }
  return all;
}

const humanizeState = (s: string | null | undefined) =>
  s ? s.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ') : 'To Be Cleaned';

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
 * One item on a filter's timeline: a cleaning cycle or a manual status update.
 *
 * 2026-09-03 (operator request): manual updates used to be collected into a
 * trailing "Manual Status Updates" section — its own PAGE in the full-detail
 * PDF — so a filter's history read as "everything that was cleaned, then
 * separately everything that was overridden", and the reader had to merge the
 * two by eye. They belong in date order among the cycles, which is how the
 * Cleaning Record has always shown them.
 *
 * This also fixes an ordering contradiction: cycles were sorted ASCENDING and
 * manual updates DESCENDING, so the two lists ran in opposite directions on the
 * same screen.
 */
export type TimelineItem =
  | { kind: 'cycle'; at: number; cycle: any }
  | { kind: 'manual'; at: number; manual: any };

/**
 * Every filter in one replacement chain, oldest first.
 *
 * A replaced filter's history does not end — it continues in its successor, and
 * the report's own Lifecycle Events say so ("Created as replacement of X",
 * "Replaced by Y"). Reporting only the filter that was picked left those lines
 * pointing at records that were nowhere in the document: a reader of
 * `L2/AHU-011/SA/01-01` saw ZERO cleaning cycles and two references, with no way
 * to tell whether data was missing. Its predecessor holds all 5 cycles.
 * (2026-09-03 operator request.)
 *
 * `byOld` maps oldFilterId -> replacement, `byNew` maps newFilterId ->
 * replacement, so the chain walks backwards and forwards from any link.
 *
 * The `seen` set is not defensive padding: these maps come from audit rows, and
 * a malformed pair would otherwise spin forever.
 */
export function replacementChain(
  filterId: string,
  byOld: Map<string, any>,
  byNew: Map<string, any>,
): string[] {
  if (!filterId) return [];
  const seen = new Set<string>([filterId]);

  const older: string[] = [];
  for (let cur = byNew.get(filterId)?.oldFilterId; cur && !seen.has(cur); cur = byNew.get(cur)?.oldFilterId) {
    seen.add(cur);
    older.unshift(cur);
  }
  const newer: string[] = [];
  for (let cur = byOld.get(filterId)?.newFilterId; cur && !seen.has(cur); cur = byOld.get(cur)?.newFilterId) {
    seen.add(cur);
    newer.push(cur);
  }
  return [...older, filterId, ...newer];
}

/** Cycles + manual updates as one ascending timeline. */
export function mergeTimeline(cycles: any[], manual: any[]): TimelineItem[] {
  const ts = (v: any) => { const t = new Date(v).getTime(); return Number.isNaN(t) ? 0 : t; };
  return [
    ...(cycles ?? []).map((c): TimelineItem => ({ kind: 'cycle', at: ts(c.startedAt), cycle: c })),
    ...(manual ?? []).map((m): TimelineItem => ({ kind: 'manual', at: ts(m.performedAt), manual: m })),
  ].sort((a, b) => a.at - b.at);
}

/**
 * Split a timeline into BLOCKS for the full-detail PDF, which gives each cycle
 * its own page. One block = one cycle, or a contiguous run of manual updates —
 * so a run between two cycles is one page in its chronological slot rather than
 * a page per row.
 */
export function timelineBlocks(items: TimelineItem[]): ({ kind: 'cycle'; cycle: any } | { kind: 'manual'; manual: any[] })[] {
  const out: ({ kind: 'cycle'; cycle: any } | { kind: 'manual'; manual: any[] })[] = [];
  for (const it of items) {
    if (it.kind === 'cycle') { out.push({ kind: 'cycle', cycle: it.cycle }); continue; }
    const last = out[out.length - 1];
    if (last && last.kind === 'manual') last.manual.push(it.manual);
    else out.push({ kind: 'manual', manual: [it.manual] });
  }
  return out;
}

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
function CycleAccordionItem({ summary, index, formatDateTime, fallback }: {
  summary: any; index: number; formatDateTime: (s: string) => string;
  fallback?: { replacedBy?: string | null; retiredBy?: string | null };
}) {
  const [open, setOpen] = useState(false);
  const { data: detail } = useSWR(open ? `/api/filters/cycles/${summary.id}` : null);
  // SUPER_ADMIN edit (2026-09-05) of the expanded cycle + its stage events.
  const isSuperAdmin = useIsSuperAdmin();
  const [saEdit, setSaEdit] = useState(false);
  const eff = effectiveCycleStatus(summary);
  const sc = STATUS_CONFIG[eff];
  const title = summary.cycleCode ?? summary.cleaningReasonLabel ?? summary.cleaningReasonKey ?? 'Cycle';
  const info = cycleEndInfo(summary, formatDateTime, fallback);

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left">
        <span className="text-[13px] font-bold text-slate-400 tabular-nums w-8 shrink-0">#{index + 1}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-slate-800 truncate">{title}</div>
          <div className="text-[11px] text-slate-400 space-y-0.5 mt-0.5">
            <div><span className="text-slate-500 font-medium">Cycle Start time:</span> <span className="tabular-nums">{formatDateTime(summary.startedAt)}</span></div>
            <div><span className="text-slate-500 font-medium">{info.endLabel}:</span> <span className="tabular-nums">{info.endTimeText}</span></div>
            {info.by && <div><span className="text-slate-500 font-medium">{info.byLabel}:</span> {info.by}</div>}
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
            <>
              {isSuperAdmin && (
                <div className="flex justify-end mb-2">
                  <button type="button" onClick={() => setSaEdit(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-[12px] font-medium text-amber-700 hover:bg-amber-50 shadow-sm">
                    <PencilIcon className="w-4 h-4 text-amber-600" /> Edit record
                  </button>
                </div>
              )}
              <CycleDetailView cycle={detail} fallback={fallback} />
              {saEdit && (
                <SuperAdminCycleEditDialog cycle={detail} events={detail.events ?? []} title={`Edit cleaning record - ${detail.filterName ?? ''}`}
                  onClose={() => setSaEdit(false)} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact, non-expandable cycle row used for broad scopes (block / area / AHU).
 * Shows only the cycle's start → end time and status — no drill-down into the
 * full per-cycle detail (that's reserved for single-filter scope).
 */
function CompactCycleRow({ summary, index, formatDateTime, fallback }: {
  summary: any; index: number; formatDateTime: (s: string) => string;
  fallback?: { replacedBy?: string | null; retiredBy?: string | null };
}) {
  const eff = effectiveCycleStatus(summary);
  const sc = STATUS_CONFIG[eff];
  const title = summary.cycleCode ?? summary.cleaningReasonLabel ?? summary.cleaningReasonKey ?? 'Cycle';
  const info = cycleEndInfo(summary, formatDateTime, fallback);
  return (
    <div className="flex items-center gap-3 px-4 py-3 border border-slate-200 rounded-xl bg-white">
      <span className="text-[13px] font-bold text-slate-400 tabular-nums w-8 shrink-0">#{index + 1}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-slate-800 truncate">{title}</div>
        <div className="text-[11px] text-slate-400 space-y-0.5 mt-0.5">
          <div><span className="text-slate-500 font-medium">Cycle Start time:</span> <span className="tabular-nums">{formatDateTime(summary.startedAt)}</span></div>
          <div><span className="text-slate-500 font-medium">{info.endLabel}:</span> <span className="tabular-nums">{info.endTimeText}</span></div>
          {info.by && <div><span className="text-slate-500 font-medium">{info.byLabel}:</span> {info.by}</div>}
        </div>
      </div>
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full whitespace-nowrap ${sc?.bg ?? 'bg-slate-50'} ${sc?.text ?? 'text-slate-600'} border ${sc?.border ?? 'border-slate-200'}`}>
        {eff === 'IN_PROGRESS' && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
        {sc?.label ?? eff}
      </span>
    </div>
  );
}

/** A manual status update (operator override outside a cleaning cycle). */
function ManualUpdateRow({ m, formatDateTime }: { m: any; formatDateTime: (s: string) => string }) {
  return (
    <div className="rounded-xl border-l-4 border-orange-400 bg-orange-50 px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-orange-700">
          {humanizeState(m.fromState)} <span className="opacity-60">→</span> {humanizeState(m.toState)}
        </span>
        <span className="text-[11px] tabular-nums text-orange-600/80">{formatDateTime(m.performedAt)}</span>
      </div>
      <div className="text-[11px] text-orange-700/80 mt-0.5">
        Manual update by {performerLabel(m, 'unknown user')}{m.remarks ? ` · ${m.remarks}` : ''}
      </div>
    </div>
  );
}

/**
 * One filter's cycles + lifecycle events in the scope. Lazy: fetches the
 * filter's cycle summaries only when expanded (and refetches when the period
 * changes). For single-filter scope it's open by default.
 *
 * `compact` (broad block/area/AHU scope) renders each cycle as a non-expandable
 * start→end row; otherwise (single filter) each cycle expands to full detail.
 */
function FilterCyclesGroup({ filter, fromIso, toIso, defaultOpen, lifecycle, formatDateTime, compact, fallback }: {
  filter: FNode; fromIso: string; toIso: string; defaultOpen: boolean; lifecycle: LifecycleEvent[]; formatDateTime: (s: string) => string; compact: boolean;
  fallback?: { replacedBy?: string | null; retiredBy?: string | null };
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [cycles, setCycles] = useState<any[]>([]);
  const [manual, setManual] = useState<any[]>([]);
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
        const [all, manuals] = await Promise.all([
          fetchAllCycleSummaries(filter.id, fromIso, toIso),
          fetchManualChanges(filter.id, fromIso, toIso),
        ]);
        if (!cancelled) { setCycles(all); setManual(manuals); setLoaded(true); }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load cycles');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, filter.id, fromIso, toIso]);

  // Cycles and manual updates in ONE ascending sequence (2026-09-03). The
  // separate `ordered` / `orderedManual` lists went with the merge — they sorted
  // in OPPOSITE directions (cycles ascending, manual descending) and are now
  // only counted, not rendered.
  const timeline = useMemo(() => mergeTimeline(cycles, manual), [cycles, manual]);

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
        {loaded && <span className="text-[11px] text-slate-400">{cycles.length} cycle(s){manual.length ? ` · ${manual.length} manual` : ''}{lifecycle.length ? ` · ${lifecycle.length} event(s)` : ''}</span>}
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
          ) : (timeline.length === 0 && lifecycle.length === 0) ? (
            <div className="text-[13px] text-slate-400 py-4 text-center">No cleaning cycles, manual updates or lifecycle events in this period.</div>
          ) : (
            <>
              {/* Cycles and manual updates interleaved by date. The cycle index
                  counts CYCLES only, so "Cycle 3" still means the third cycle
                  even with manual updates sitting between them. */}
              {(() => { let n = 0; return timeline.map((it, i) => (
                it.kind === 'manual'
                  ? <ManualUpdateRow key={it.manual.id ?? `m-${i}`} m={it.manual} formatDateTime={formatDateTime} />
                  : (compact
                      ? <CompactCycleRow key={it.cycle.id} summary={it.cycle} index={n++} formatDateTime={formatDateTime} fallback={fallback} />
                      : <CycleAccordionItem key={it.cycle.id} summary={it.cycle} index={n++} formatDateTime={formatDateTime} fallback={fallback} />)
              )); })()}
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
  const { formatDateTime, formatDate, config: datetimeConfig } = useDatetimeFormat();
  const { toast } = useToast();
  const exportLimit = useExportLimit();
  // Phase 5C: lifecycle.export gate = ['REPORT_EXPORT','REPORT_GENERATE'] — SAME as old check.
  const can = useCan();
  const canExportPdf = can('lifecycle.export');

  // Hierarchy dropdown sources.
  const { data: blocksData } = useSWR<{ data: HNode[] }>('/api/hierarchy/blocks');
  const { data: areasData } = useSWR<{ data: HNode[] }>('/api/hierarchy/areas');
  const { data: ahusData } = useSWR<{ data: HNode[] }>('/api/hierarchy/ahus');
  const { data: filtersData } = useSWR<{ data: HNode[] }>('/api/hierarchy/filters');
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
  // An AHU sits EITHER directly under a block (blockId set, areaId null) or under
  // an area. Scoping by block used to test only the area path, so every
  // block-direct AHU silently vanished from the dropdown — and, via
  // allowedAhuIds below, so did all of its filters. The report then
  // under-reported with no warning, which is the worst failure mode for a §11
  // record. `blockId` is already on the payload (hierarchy/routes.ts ships it for
  // exactly this shape); it just wasn't being used here.
  const ahuOptions = useMemo(
    () => allAhus
      .filter((a) => (areaId
        ? a.areaId === areaId
        : (!blockId || a.blockId === blockId || (a.areaId != null && allowedAreaIds.has(a.areaId)))))
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
    if (filterId) {
      // The whole replacement chain, oldest first — not just the filter picked.
      // See replacementChain: its predecessor usually holds the cycles, and the
      // Lifecycle Events reference filters the reader would otherwise not find.
      const chain = replacementChain(filterId, replByOld, replByNew)
        .map((id) => allFilters.find((x) => x.id === id))
        .filter(Boolean) as FNode[];
      if (chain.length) return chain;
      const f = allFilters.find((x) => x.id === filterId);
      return f ? [f] : [];
    }
    if (ahuId || areaId || blockId) return filterOptions;
    return [];
  }, [filterId, ahuId, areaId, blockId, filterOptions, allFilters, replByOld, replByNew]);

  /** Names of the chain, for the report subtitle. Empty unless it has >1 link. */
  const chainNames = useMemo(() => {
    if (!filterId || filtersInScope.length < 2) return [];
    return filtersInScope.map((f) => f.name);
  }, [filterId, filtersInScope]);

  // Broad scope = block / area / AHU (no explicit Filter picked) → start/end-only
  // per cycle. An explicit Filter selection keeps the full per-cycle detail.
  const isSingleFilterScope = !!filterId;

  const scopeLabel = useMemo(() => {
    if (filterId) return allFilters.find((f) => f.id === filterId)?.name ?? 'Filter';
    if (ahuId) return `AHU ${allAhus.find((a) => a.id === ahuId)?.name ?? ''}`.trim();
    if (areaId) return `Area ${allAreas.find((a) => a.id === areaId)?.name ?? ''}`.trim();
    if (blockId) return `Block ${allBlocks.find((b) => b.id === blockId)?.name ?? ''}`.trim();
    return '';
  }, [filterId, ahuId, areaId, blockId, allFilters, allAhus, allAreas, allBlocks]);

  // `new Date('2026-07-15')` is UTC midnight, so the old bounds started the
  // range 05:30 into the operator's IST day and ended it 18.5h early — an
  // inspector-facing report silently omitting records. Bound the LOCAL day:
  // from = its first instant, to = its last (inclusive).
  const fromIso = startOfDayIso(fromDate, datetimeConfig.timezone);
  const toIso = endOfDayIso(toDate, datetimeConfig.timezone);
  const periodLine = fromDate || toDate
    ? `Period: ${fromDate ? formatDate(fromDate) : 'Start'} → ${toDate ? formatDate(toDate) : 'Now'}`
    : 'Period: All Time';

  const handleDownload = async (asSnapshot = false): Promise<import('@/lib/pdf-report').ReportSnapshot | null> => {
    if (!filtersInScope.length) return null;
    setDownloading(true);
    setProgress(null);
    setDownloadMsg(null);
    try {
      // 1. Cheap pass: cycle summaries + manual updates + lifecycle events per
      //    filter (period-bounded).
      const groups: { filter: FNode; summaries: any[]; manual: any[]; events: LifecycleEvent[] }[] = [];
      for (const f of filtersInScope) {
        const [sums, manual] = await Promise.all([
          fetchAllCycleSummaries(f.id, fromIso, toIso).then((s) => s.sort(asc)),
          fetchManualChanges(f.id, fromIso, toIso),
        ]);
        const events = buildLifecycle(f.id, retireMap, replByOld, replByNew, fromIso, toIso);
        if (sums.length || manual.length || events.length) groups.push({ filter: f, summaries: sums, manual, events });
      }
      const flat = groups.flatMap((g) => g.summaries.map((s) => s.id as string));
      const totalCycles = flat.length;
      const totalEvents = groups.reduce((n, g) => n + g.events.length, 0);
      const totalManual = groups.reduce((n, g) => n + g.manual.length, 0);
      if (totalCycles === 0 && totalEvents === 0 && totalManual === 0) { setDownloadMsg('No cleaning cycles, manual updates or lifecycle events found for this selection and period.'); return null; }

      // Shared manual-updates table renderer. Takes a LIST rather than the
      // group so the full-detail branch can render one contiguous run of manual
      // updates in its chronological slot between two cycles.
      const addManualTable = (rows: any[]) => {
        if (!rows.length) return;
        report.addSectionTitle('Manual Status Updates');
        report.addTable({
          head: ['From', 'To', 'Date & Time', 'By', 'Remarks'],
          body: rows.map((m: any) => [
            humanizeState(m.fromState), humanizeState(m.toState),
            m.performedAt ? formatDateTime(m.performedAt) : '-',
            performerLabel(m),
            m.remarks ?? '-',
          ]),
          columnStyles: { 4: { cellWidth: 55 } },
        });
      };

      // The full-detail (single-filter) path renders one heavy section per
      // cycle, so it's size-guarded. Broad block/area/AHU scope emits a compact
      // start→end table per filter — cheap, no per-cycle detail fetch, no cap.
      if (isSingleFilterScope) {
        if (totalCycles > MAX_CYCLES) {
          setDownloadMsg(`This filter has ${totalCycles} cycles — too many for a full-detail PDF (limit ${MAX_CYCLES}). Narrow the period.`);
          return null;
        }
        if (totalCycles > WARN_CYCLES && !window.confirm(`This will generate a full-detail report for ${totalCycles} cycles (one section each — a large PDF that may take a minute). Continue?`)) {
          return null;
        }
      }

      const report = await createReport({ reportKey: 'cleaning-lifecycle',
        title: `${scopeLabel} — Cleaning Lifecycle Report`,
        // Say the chain out loud. Without it a reader who picked ONE filter
        // finds several "Filter:" sections and cannot tell which was requested.
        subtitle: chainNames.length > 1
          ? `${periodLine}\nReplacement chain (${chainNames.length} filters, oldest first): ${chainNames.join(' -> ')}`
          : periodLine,
        orientation: 'portrait',
        formatDateTime,
        legend: [{ abbr: 'S.No', meaning: 'Serial Number' }],
      });

      if (isSingleFilterScope) {
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

        // 3. Build the grouped report. Each cycle on its own page, with manual
        //    updates in their CHRONOLOGICAL slot between them (2026-09-03) —
        //    they used to be collected onto a single trailing page, so the
        //    reader had to merge two lists by eye. A contiguous run of manual
        //    updates shares one page rather than taking a page per row. The
        //    filter's lifecycle events (retire/replace) still come last, which
        //    is also where they fall in time.
        let firstBlock = true;
        for (const g of groups) {
          let needFilterHeader = true;
          const header = () => {
            if (!needFilterHeader) return;
            report.addSectionTitle(
              `Filter: ${g.filter.name}${g.filter.retired ? ' (Retired)' : ''}`
              + (g.filter.id === filterId && chainNames.length > 1 ? '  [the filter selected]' : ''),
            );
            needFilterHeader = false;
          };
          // Retire/replace performer for THIS filter — a cycle ended that way
          // writes no CYCLE_TERMINATED event, so without this the per-cycle
          // section has no terminator to name. Same value the compact branch
          // and the on-screen accordion pass.
          const fb = { replacedBy: replByOld.get(g.filter.id)?.performedBy ?? null, retiredBy: retireMap.get(g.filter.id)?.retiredBy ?? null };
          // The cycle number counts CYCLES only, so "Cycle 3" still means the
          // third cycle however many manual updates sit between them.
          let cycleNo = 0;
          for (const block of timelineBlocks(mergeTimeline(g.summaries, g.manual))) {
            if (block.kind === 'cycle') {
              const detail = byId.get(block.cycle.id);
              if (!detail) continue;
              cycleNo++;
              if (!firstBlock) report.newPage();
              firstBlock = false;
              header();
              report.addSectionTitle(`Cycle ${cycleNo} — ${formatDateTime(block.cycle.startedAt)}`);
              appendCycleDetailToReport(report, detail, { formatDateTime, fallback: fb });
            } else {
              if (!firstBlock) report.newPage();
              firstBlock = false;
              header();
              addManualTable(block.manual);
            }
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
          // (manual updates are emitted inline above, in date order)
        }
      } else {
        // Broad scope: one compact start→end table per filter (+ lifecycle events).
        let firstBlock = true;
        for (const g of groups) {
          if (!firstBlock) report.newPage();
          firstBlock = false;
          report.addSectionTitle(
            `Filter: ${g.filter.name}${g.filter.retired ? ' (Retired)' : ''}`
            + (g.filter.id === filterId && chainNames.length > 1 ? '  [the filter selected]' : ''),
          );
          // ONE table, cycles and manual updates interleaved by date
          // (2026-09-03). They were two tables, so a filter's history read as
          // "everything cleaned, then separately everything overridden".
          const merged = mergeTimeline(g.summaries, g.manual);
          if (merged.length) {
            const fb = { replacedBy: replByOld.get(g.filter.id)?.performedBy ?? null, retiredBy: retireMap.get(g.filter.id)?.retiredBy ?? null };
            let n = 0;
            report.addTable({
              // Neutral "End Time" / "By" because a filter's table mixes
              // completed + terminated cycles; the Status column disambiguates,
              // and now also marks the manual rows.
              // "Details" exists so the CYCLE column only ever holds a cycle id
              // (2026-09-03): a manual update has no cycle id, and putting its
              // stage change there made the column mean two different things.
              head: ['S.No', 'Cycle', 'Start Time', 'End Time', 'By', 'Status', 'Details'],
              body: merged.map((it) => {
                if (it.kind === 'manual') {
                  const m = it.manual;
                  // "->" not "→": jsPDF's built-in helvetica is WinAnsi, which has
                  // no U+2192, so the arrow rendered as "!" plus a garbage glyph.
                  // Verified by rendering and reading the PDF back. (The Excel
                  // export below keeps the real arrow — xlsx is UTF-8.)
                  const move = `${humanizeState(m.fromState)} -> ${humanizeState(m.toState)}`;
                  return [
                    '-',
                    'Manual Update',
                    m.performedAt ? formatDateTime(m.performedAt) : '-',
                    '-',
                    performerLabel(m),
                    'Manual Update',
                    m.remarks ? `${move} · ${m.remarks}` : move,
                  ];
                }
                const s = it.cycle;
                const eff = effectiveCycleStatus(s);
                const info = cycleEndInfo(s, formatDateTime, fb);
                return [
                  String(++n),
                  s.cycleCode ?? s.cleaningReasonLabel ?? s.cleaningReasonKey ?? '-',
                  s.startedAt ? formatDateTime(s.startedAt) : '-',
                  info.endTimeText === '—' ? '-' : info.endTimeText,
                  info.by ?? '-',
                  STATUS_CONFIG[eff]?.label ?? eff,
                  '-',
                ];
              }),
              // Measured with jsPDF metrics against the live values, then
              // VERIFIED by rendering this table and reading the PDF back.
              //
              // Cycle gets 63mm because a cycle code is one unbreakable token and
              // the longest live one, "CC-CWH/F1/AHU-0B/SA/05/06-01-011-20260714-M",
              // measures 57.2mm at 7pt. It was 42mm, so codes broke mid-token —
              // visible in the operator's own report as "…-001-2026" / "0602".
              // Minimum need is 164mm of the 180mm portrait usable width; the
              // 16mm spare goes to Details, which holds free-text remarks.
              columnStyles: {
                0: { cellWidth: 12 },  // S.No
                1: { cellWidth: 63 },  // Cycle — one unbreakable token, see above
                2: { cellWidth: 18 },  // Start Time — date over time
                3: { cellWidth: 18 },  // End Time
                4: { cellWidth: 18 },  // By — username, or an 8-char id fragment for a deleted user
                5: { cellWidth: 18 },  // Status
                6: { cellWidth: 33 },  // Details — stage change + the operator's remark
              },
            });
          }
          if (g.events.length) {
            report.addSectionTitle('Lifecycle Events (Retirement / Replacement)');
            report.addTable({
              head: ['Event', 'Date', 'By', 'Remarks'],
              body: g.events.map((e) => [e.label, formatDateTime(e.at), e.by ?? '-', e.remarks ?? '-']),
              columnStyles: { 3: { cellWidth: 60 } },
            });
          }
          // (manual updates are rows in the table above, in date order)
        }
      }

      if (asSnapshot) return report.getSnapshot();
      await logReportExportOrWarn({ reportType: 'Cleaning Lifecycle', format: 'PDF', recordCount: totalCycles + totalEvents + totalManual }, toast.warning);
      const safeScope = scopeLabel.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'scope';
      report.save(`${downloadName('lifecycle', safeScope)}.pdf`);
      return null;
    } catch (e: any) {
      setDownloadMsg(e?.message ?? 'Report generation failed.');
      return null;
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  };

  const buildLifecycleSnapshot = () => handleDownload(true);

  // Excel = one flat sheet, one row per cleaning cycle across the scope (cheap
  // summaries pass — no per-cycle full-detail fetch).
  const exportExcel = async () => {
    if (!filtersInScope.length) return;
    setDownloading(true);
    setDownloadMsg(null);
    try {
      const head = ['Filter', 'S.No', 'Cycle', 'Start Time', 'End Time', 'By', 'Status', 'Reason'];
      const rows: string[][] = [];
      for (const f of filtersInScope) {
        const [sums, manual] = await Promise.all([
          fetchAllCycleSummaries(f.id, fromIso, toIso).then((s) => s.sort(asc)),
          fetchManualChanges(f.id, fromIso, toIso),
        ]);
        const fb = { replacedBy: replByOld.get(f.id)?.performedBy ?? null, retiredBy: retireMap.get(f.id)?.retiredBy ?? null };
        sums.forEach((s: any, i: number) => {
          const eff = effectiveCycleStatus(s);
          const info = cycleEndInfo(s, formatDateTime, fb);
          rows.push([
            f.name, String(i + 1), s.cycleCode ?? '-',
            s.startedAt ? formatDateTime(s.startedAt) : '-',
            info.endTimeText === '—' ? '-' : info.endTimeText,
            info.by ?? '-',
            STATUS_CONFIG[eff]?.label ?? eff,
            s.cleaningReasonLabel ?? s.cleaningReasonKey ?? '-',
          ]);
        });
        // Manual status updates mapped into the same columns (Cycle = the
        // From→To change, Start Time = when, Status = "Manual Update").
        manual.forEach((m: any) => {
          rows.push([
            f.name, '', `Manual: ${humanizeState(m.fromState)} → ${humanizeState(m.toState)}`,
            m.performedAt ? formatDateTime(m.performedAt) : '-', '',
            performerLabel(m),
            'Manual Update',
            m.remarks ?? '-',
          ]);
        });
      }
      if (rows.length === 0) { setDownloadMsg('No cleaning cycles or manual updates found for this selection and period.'); return; }
      if (rows.length > exportLimit.maxRecords) { setDownloadMsg(exportLimit.tooLargeMessage(rows.length)); return; }
      await logReportExportOrWarn({ reportType: 'Cleaning Lifecycle', format: 'Excel', recordCount: rows.length }, toast.warning);
      const safeScope = scopeLabel.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'scope';
      exportToExcel({ filename: `lifecycle-${safeScope}`, sheetName: 'Cleaning Cycles', head, rows });
    } catch (e: any) {
      setDownloadMsg(e?.message ?? 'Export failed.');
    } finally {
      setDownloading(false);
    }
  };

  // h-9, not py-2: DateRangeFilter's `md` size is h-9, and a padding-derived
  // ~38px next to a fixed 36px left the row's controls on different baselines.
  const selectCls = 'w-full px-3 h-9 text-[13px] rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400 disabled:bg-slate-50 disabled:text-slate-400';
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
            <>
              <ExportMenu surface="lifecycle" onExportPdf={() => handleDownload(false)} onExportExcel={exportExcel}
                busy={downloading}
                className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg text-[13px] font-semibold hover:bg-cyan-700 shadow-sm transition-all disabled:opacity-40 shrink-0" />
              <SendForReviewButton buildSnapshot={buildLifecycleSnapshot}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-[13px] font-semibold hover:bg-slate-50 shadow-sm transition-all shrink-0" />
            </>
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
          {/* Spans TWO of the six columns: it holds two date inputs plus the
              "to" separator and the clear button, and in a single 1/6 cell those
              wrapped onto their own lines and broke the row's alignment. Four
              selects + this = the full six.
              The caption is the page's own <label>, identical to its siblings —
              the component's built-in `label` renders text-slate-400 against the
              text-slate-500 used here, which read as a second misalignment. */}
          <div className="col-span-2">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Date Range</label>
            <DateRangeFilter
              from={fromDate}
              to={toDate}
              onFromChange={setFromDate}
              onToChange={setToDate}
              fromAriaLabel="Lifecycle from date"
              toAriaLabel="Lifecycle to date"
            />
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
              {chainNames.length > 1 && (
                <span className="ml-2 text-amber-600">
                  · replacement chain of {chainNames.length}, oldest first — the selected filter's history continues across all of them
                </span>
              )}
            </div>
            <div className="space-y-2">
              {filtersInScope.map((f) => (
                <FilterCyclesGroup
                  key={f.id}
                  filter={f}
                  fromIso={fromIso}
                  toIso={toIso}
                  defaultOpen={singleFilter}
                  compact={!isSingleFilterScope}
                  lifecycle={buildLifecycle(f.id, retireMap, replByOld, replByNew, fromIso, toIso)}
                  fallback={{ replacedBy: replByOld.get(f.id)?.performedBy ?? null, retiredBy: retireMap.get(f.id)?.retiredBy ?? null }}
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
