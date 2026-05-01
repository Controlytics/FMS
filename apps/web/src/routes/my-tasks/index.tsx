import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';

interface FilterRow {
  filterId: string;
  filterName: string;
  status: 'pending' | 'cleaned_in_window' | 'in_progress';
  lastCycleCompletedAt: string | null;
}

interface TaskRow {
  entryId: string;
  ahuId: string;
  ahuName: string;
  plannedDate: string;
  toleranceDays: number;
  windowStart: string;
  windowEnd: string;
  totalFilters: number;
  cleanedCount: number;
  overallStatus: 'pending' | 'in_progress' | 'complete' | 'overdue';
  filters: FilterRow[];
}

interface DueResponse {
  tasks: TaskRow[];
  overdue: TaskRow[];
  settings: { showOverdueSeparately: boolean };
}

const STATUS_META: Record<TaskRow['overallStatus'], { label: string; bg: string; text: string; dot: string; border: string }> = {
  pending:     { label: 'Pending',     bg: 'bg-amber-50',    text: 'text-amber-700',    dot: 'bg-amber-500',    border: 'border-amber-200' },
  in_progress: { label: 'In Progress', bg: 'bg-cyan-50',     text: 'text-cyan-700',     dot: 'bg-cyan-500',     border: 'border-cyan-200' },
  complete:    { label: 'Complete',    bg: 'bg-emerald-50',  text: 'text-emerald-700',  dot: 'bg-emerald-500',  border: 'border-emerald-200' },
  overdue:     { label: 'Overdue',     bg: 'bg-rose-50',     text: 'text-rose-700',     dot: 'bg-rose-500',     border: 'border-rose-200' },
};

const FILTER_STATUS_META: Record<FilterRow['status'], { label: string; cls: string; dot: string }> = {
  pending:           { label: 'Pending',  cls: 'bg-amber-50 text-amber-700 border-amber-100',   dot: 'bg-amber-500' },
  in_progress:       { label: 'Cleaning', cls: 'bg-cyan-50 text-cyan-700 border-cyan-100',       dot: 'bg-cyan-500' },
  cleaned_in_window: { label: 'Done',     cls: 'bg-emerald-50 text-emerald-700 border-emerald-100', dot: 'bg-emerald-500' },
};

export function MyTasksPage() {
  const navigate = useNavigate();
  const { formatDate } = useDatetimeFormat();
  const { data, error, isLoading } = useSWR<DueResponse>('/api/pm-schedules/due', { refreshInterval: 30000 });

  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const tasks = data?.tasks ?? [];
  const overdueTasks = data?.overdue ?? [];

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(t => t.ahuName.toLowerCase().includes(q));
  }, [tasks, search]);

  const filteredOverdue = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return overdueTasks;
    return overdueTasks.filter(t => t.ahuName.toLowerCase().includes(q));
  }, [overdueTasks, search]);

  // Stats are computed from the full dataset (not the search-filtered view)
  const stats = useMemo(() => {
    const now = Date.now();
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;
    let dueToday = 0, dueThisWeek = 0, completed = 0;
    for (const t of tasks) {
      const planned = new Date(t.plannedDate).getTime();
      if (planned >= startOfToday && planned < startOfToday + 24 * 60 * 60 * 1000) dueToday++;
      if (planned >= startOfWeek && planned <= now + 3 * 24 * 60 * 60 * 1000) dueThisWeek++;
      if (t.overallStatus === 'complete') completed++;
    }
    return { dueToday, dueThisWeek, completed, overdue: overdueTasks.length };
  }, [tasks, overdueTasks]);

  const toggleExpand = (entryId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const onPerform = (task: TaskRow) => {
    navigate(`/filters?ahuId=${encodeURIComponent(task.ahuId)}`);
  };

  return (
    <div className="p-6 space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl shadow-lg" style={{ backgroundImage: 'linear-gradient(to bottom right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">My Tasks</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            AHUs currently due for cleaning based on PM schedules and tolerance windows
          </p>
        </div>
      </div>

      {/* ─── Stat Cards ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl p-4 text-white shadow-lg" style={{ backgroundImage: 'linear-gradient(to bottom right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
          <div className="text-2xl font-bold">{tasks.length}</div>
          <div className="text-white/80 text-sm font-medium mt-0.5">Due Now</div>
        </div>
        <StatCard label="Due Today" value={stats.dueToday} iconBg="bg-amber-50" iconColor="text-amber-600" icon={
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        } />
        <StatCard label="Completed" value={stats.completed} iconBg="bg-emerald-50" iconColor="text-emerald-600" icon={
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        } />
        <StatCard label="Overdue" value={stats.overdue} iconBg="bg-rose-50" iconColor="text-rose-600" icon={
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        } />
      </div>

      {/* ─── Search ─── */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search AHU name..."
            className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 outline-none transition-all"
          />
        </div>
      </div>

      {/* ─── Error ─── */}
      {error && (() => {
        const code = (error as any).code ?? (error as any).response?.data?.error;
        const msg = (error as any).message ?? 'unknown error';
        if (code === 'PM_DISABLED' || /pm scheduling module is not enabled/i.test(msg)) {
          return (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">
              Preventive Maintenance scheduling is disabled. Enable it in Configuration → PM Schedule Settings to start receiving tasks.
            </div>
          );
        }
        return (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">
            Failed to load tasks: {msg}
          </div>
        );
      })()}

      {/* ─── Loading skeleton ─── */}
      {isLoading && !data && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-2xl h-28 animate-pulse" />
          ))}
        </div>
      )}

      {/* ─── Main tasks list ─── */}
      {!isLoading && filteredTasks.length === 0 && filteredOverdue.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="h-1.5 bg-gradient-to-r from-teal-400 to-cyan-500" />
          <div className="p-16 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-teal-50 to-cyan-50 flex items-center justify-center">
              <svg className="w-8 h-8 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-slate-700 font-semibold">{search ? 'No matching tasks' : 'Nothing due right now'}</p>
            <p className="text-sm text-slate-400 mt-1">
              {search
                ? 'Try a different search term'
                : 'Tasks will appear here when today falls inside a scheduled tolerance window'}
            </p>
          </div>
        </div>
      )}

      {filteredTasks.length > 0 && (
        <div className="space-y-3">
          {filteredTasks.map(task => (
            <TaskCard
              key={task.entryId}
              task={task}
              expanded={expanded.has(task.entryId)}
              onToggle={() => toggleExpand(task.entryId)}
              onPerform={() => onPerform(task)}
              formatDate={formatDate}
            />
          ))}
        </div>
      )}

      {/* ─── Overdue section ─── */}
      {filteredOverdue.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 mt-8">
            <svg className="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h2 className="text-base font-bold text-slate-800">Overdue</h2>
            <span className="text-xs text-slate-500">
              ({filteredOverdue.length} AHU{filteredOverdue.length === 1 ? '' : 's'} past window without completion)
            </span>
          </div>
          {filteredOverdue.map(task => (
            <TaskCard
              key={task.entryId}
              task={task}
              expanded={expanded.has(task.entryId)}
              onToggle={() => toggleExpand(task.entryId)}
              onPerform={() => onPerform(task)}
              formatDate={formatDate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Task Card ───────────────────────────────────────────

function TaskCard({ task, expanded, onToggle, onPerform, formatDate }: {
  task: TaskRow;
  expanded: boolean;
  onToggle: () => void;
  onPerform: () => void;
  formatDate: (d: string | Date) => string;
}) {
  const meta = STATUS_META[task.overallStatus];
  const progressPct = task.totalFilters > 0 ? Math.round((task.cleanedCount / task.totalFilters) * 100) : 0;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <div className={`h-1.5 bg-gradient-to-r ${
        task.overallStatus === 'overdue' ? 'from-rose-400 to-rose-500'
        : task.overallStatus === 'complete' ? 'from-emerald-400 to-emerald-500'
        : 'from-teal-400 to-cyan-500'
      }`} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h16m-7 5h7" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-slate-800 truncate">{task.ahuName}</h3>
                <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full font-semibold ${meta.bg} ${meta.text} border ${meta.border}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                  {meta.label}
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>Scheduled: <strong className="text-slate-700">{formatDate(task.plannedDate)}</strong></span>
                <span>·</span>
                <span>Window: {formatDate(task.windowStart)} → {formatDate(task.windowEnd)}</span>
                <span>·</span>
                <span>{task.cleanedCount}/{task.totalFilters} cleaned</span>
              </div>
              {task.totalFilters > 0 && (
                <div className="mt-2.5 h-1.5 bg-slate-100 rounded-full overflow-hidden max-w-md">
                  <div
                    className="h-full transition-all"
                    style={{ width: `${progressPct}%`, backgroundImage: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}
                  />
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onToggle}
              className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-colors"
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {task.overallStatus === 'complete' ? (
              <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-sm font-semibold">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Completed
              </div>
            ) : (
              <button
                onClick={onPerform}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-white rounded-xl text-sm font-semibold shadow-lg hover:opacity-90 transition-all"
                style={{ backgroundImage: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}
              >
                Perform
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {expanded && (
          <div className="mt-5 pt-5 border-t border-slate-100">
            {task.filters.length === 0 ? (
              <p className="text-xs text-slate-400 italic">This AHU has no active child filters.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {task.filters.map(f => {
                  const fMeta = FILTER_STATUS_META[f.status];
                  return (
                    <span
                      key={f.filterId}
                      className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-semibold ${fMeta.cls}`}
                      title={f.lastCycleCompletedAt ? `Last cycle: ${new Date(f.lastCycleCompletedAt).toLocaleString()}` : 'No cycles yet'}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${fMeta.dot}`} />
                      {f.filterName}
                      <span className="text-[10px] opacity-70">· {fMeta.label}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── StatCard helper ─────────────────────────────────────

function StatCard({ label, value, iconBg, iconColor, icon }: {
  label: string; value: number; iconBg: string; iconColor: string; icon: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
          <svg className={`w-5 h-5 ${iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {icon}
          </svg>
        </div>
        <div className="min-w-0">
          <div className="text-xl font-bold text-slate-800 leading-tight">{value}</div>
          <div className="text-xs text-slate-400 font-medium truncate">{label}</div>
        </div>
      </div>
    </div>
  );
}
